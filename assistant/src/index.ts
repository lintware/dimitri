// Dimitri assistant sidecar.
//
// Embeds the pi agent (createAgentSession) with chemistry tools and exposes a
// WebSocket on :7843. The UI's Assistant panel connects, sends {type:"prompt"},
// and receives streamed {type:"token"|"tool"|"end"|"error"} events.
//
// Run: npm run dev   (needs ANTHROPIC_API_KEY or OPENAI_API_KEY in the env)

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

// Load API keys from .env files so they persist for the sidecar without being
// committed or echoed. KEY=value per line. Two sources, first-wins per key:
//   1. the dev repo's assistant/.env (gitignored)
//   2. the packaged app's user config: ~/Library/Application Support/Dimitri/.env
// The second is where the bundled app stores a connected subscription's key, so
// nothing secret ships inside the .app.
(() => {
  const loadEnv = (envPath: string) => {
    if (!existsSync(envPath)) return;
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  };
  loadEnv(join(dirname(dirname(fileURLToPath(import.meta.url))), ".env"));
  const support = join(process.env.HOME ?? "", "Library", "Application Support", "Dimitri", ".env");
  loadEnv(support);
})();
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { getModel, streamSimple } from "@earendil-works/pi-ai";
import { chemistryTools } from "./tools.ts";

// Accept GROK_API_KEY as an alias for the XAI key pi-ai expects.
if (process.env.GROK_API_KEY && !process.env.XAI_API_KEY) {
  process.env.XAI_API_KEY = process.env.GROK_API_KEY;
}

// Exit if the launching app goes away (crash/force-kill), so we never orphan.
if (process.env.DIMITRI_PARENT_PID) {
  const ppid = Number(process.env.DIMITRI_PARENT_PID);
  setInterval(() => {
    try {
      process.kill(ppid, 0); // liveness check
    } catch {
      process.exit(0);
    }
  }, 2000).unref();
}

const PORT = Number(process.env.DIMITRI_ASSISTANT_PORT ?? 7843);

// Pick a model from whatever account is connected. Credentials are resolved by
// pi's AuthStorage (~/.pi/agent/auth.json) — including the Anthropic OAuth login
// (Claude Pro/Max), which auto-refreshes. Env keys and an explicit override win.
function pickModel() {
  const override = process.env.DIMITRI_MODEL; // e.g. "anthropic/claude-opus-4-8"
  if (override) {
    const [provider, id] = override.split("/");
    return getModel(provider, id);
  }
  if (process.env.DEEPSEEK_API_KEY) return getModel("deepseek", process.env.DIMITRI_DEEPSEEK_MODEL ?? "deepseek-v4-pro");
  if (process.env.OPENAI_API_KEY) return getModel("openai", process.env.DIMITRI_OPENAI_MODEL ?? "gpt-5");
  if (process.env.XAI_API_KEY || process.env.GROK_API_KEY) return getModel("xai", process.env.DIMITRI_XAI_MODEL ?? "grok-4.3");
  // Default: Claude via the pi OAuth login (subscription) or ANTHROPIC_API_KEY.
  return getModel("anthropic", "claude-opus-4-5");
}

const SYSTEM = `You are Dimitri, an AI assistant inside a molecular-design harness.
You help chemists design molecules and analyze proteins. You ACT ON THE PLATFORM
— you do not just describe what the user could do; you do it for them with tools:
- lookup_molecule(name): resolve a named compound to its REAL SMILES from PubChem.
  You MUST call this first for ANY named molecule (corannulene, caffeine, aspirin,
  …) before load_molecule or score_molecule. NEVER invent/guess a SMILES from
  memory — hallucinated SMILES produce garbage structures. Use the returned SMILES
  verbatim. Only skip lookup if the user gave you an explicit SMILES.
- load_molecule(smiles): when the user asks you to build/draw/show a specific
  molecule (e.g. "build acetaminophen"), ALWAYS call this to render it in the
  Molecule Editor (pass the SMILES from lookup_molecule). NEVER reply with only a
  SMILES string and tell them to paste it.
- load_protein(pdb_id): when the user asks to view/import/bring in a protein (e.g.
  "load 7WC5", "bring in another protein"), ALWAYS call this — it imports and
  renders the structure in 3D. NEVER just ask them to type the ID themselves; if
  they didn't give an id, pick a sensible one and load it.
- generate_analogs: build/score an analog library from a scaffold.
- score_molecule: score a single compound.
- dock_dataset: dock a library against a protein box and add a docking-score column.
- open_module: surface a panel (project-data, molecule-editor, protein-editor,
  docking, admet, assistant) in the UI when the user asks to open a window/panel.
Results land in the shared Project Data table / editors automatically, so the user
sees them on screen. After acting, give a brief one-or-two-line summary. Be concise.`;

// The Dimitri package root holds package.json's `pi` manifest plus extensions/
// and skills/. In dev that's the repo root (parent of assistant/); in the bundled
// app it's the vendored dir those folders are copied into next to assistant/.
const ASSISTANT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG_ROOT = dirname(ASSISTANT_DIR);

// Load the chemistry extension (/chem slash command) and the chem skill declared
// in the package.json `pi` manifest, so the embedded agent resolves them natively
// (session.prompt handles registered slash commands + skill expansion). Returns
// undefined if the package isn't present, so the assistant still starts.
async function buildResourceLoader(): Promise<any> {
  if (!existsSync(join(PKG_ROOT, "package.json"))) return undefined;
  try {
    // Isolated agentDir so only Dimitri's own extension + skill load — never the
    // user's global ~/.pi/agent skills/extensions. (getAgentDir is the default we
    // deliberately avoid here; auth/creds use AuthStorage's own default dir.)
    const isolatedAgentDir = join(
      process.env.HOME ?? PKG_ROOT,
      "Library",
      "Application Support",
      "Dimitri",
      "pi-agent",
    );
    const loader = new DefaultResourceLoader({
      cwd: PKG_ROOT,
      agentDir: isolatedAgentDir,
      additionalExtensionPaths: [PKG_ROOT],
      // Suppress auto-discovery of the user's global ~/.agents skills/extensions;
      // only Dimitri's manifest-declared chem skill + extension load.
      noSkills: true,
      noContextFiles: true,
      noThemes: true,
      noPromptTemplates: true,
    });
    await loader.reload();
    const { errors } = loader.getExtensions();
    if (errors?.length) console.error("[assistant] extension load errors:", errors);
    return loader;
  } catch (err: any) {
    console.error("[assistant] failed to load /chem extension + skill:", err?.message ?? err);
    return undefined;
  }
}

const wss = new WebSocketServer({ port: PORT, host: "127.0.0.1" });
console.log(`[assistant] listening on ws://127.0.0.1:${PORT}`);

wss.on("connection", async (ws: WebSocket) => {
  const model = pickModel();
  if (!model) {
    ws.send(JSON.stringify({ type: "error", message: "No AI account connected. Add an API key in settings." }));
    return;
  }

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  // Resolve the connected credential and expose it the way pi-ai's provider
  // expects. AuthStorage.getApiKey() auto-refreshes expired OAuth tokens.
  // For Anthropic OAuth (Claude Pro/Max via pi /login) the token is an
  // sk-ant-oat… access token that must go in ANTHROPIC_OAUTH_TOKEN (which
  // pi-ai prefers and treats with OAuth headers).
  try {
    const provider = (model as any).provider;
    const token = await authStorage.getApiKey(provider);
    if (token) {
      if (provider === "anthropic" && token.startsWith("sk-ant-oat")) {
        process.env.ANTHROPIC_OAUTH_TOKEN = token;
      } else if (provider === "anthropic") {
        process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? token;
      }
    }
  } catch (e: any) {
    if (process.env.DIMITRI_DEBUG) console.log("[auth] resolve failed:", e?.message);
  }

  // Let open_module / load_molecule reach this client.
  (globalThis as any).__dimitriOpenModule = (id: string) =>
    ws.send(JSON.stringify({ type: "open_module", id }));
  (globalThis as any).__dimitriLoadMolecule = (smiles: string, name?: string) =>
    ws.send(JSON.stringify({ type: "load_molecule", smiles, name }));
  (globalThis as any).__dimitriLoadProtein = (pdb_id: string) =>
    ws.send(JSON.stringify({ type: "load_protein", pdb_id }));

  const resourceLoader = await buildResourceLoader();

  let session: any;
  try {
    const created = await createAgentSession({
      model,
      cwd: PKG_ROOT,
      resourceLoader,
      modelRegistry,
      authStorage,
      thinkingLevel: "off",
      sessionManager: SessionManager.inMemory(),
      customTools: chemistryTools,
      tools: ["read", "generate_analogs", "score_molecule", "dock_dataset", "lookup_molecule", "load_molecule", "load_protein", "open_module"],
      appendSystemPrompt: SYSTEM,
    });
    session = created.session;
    if (session.agent) session.agent.streamFn = streamSimple;
  } catch (err: any) {
    ws.send(JSON.stringify({ type: "error", message: `Failed to start assistant: ${err.message}` }));
    return;
  }

  let streamedThisMsg = false;
  session.subscribe((event: any) => {
    if (process.env.DIMITRI_DEBUG) {
      const extra = event.type === "message_update" ? event.assistantMessageEvent?.type : "";
      console.log(`[evt] ${event.type} ${extra}`);
      if (event.type === "message_end") {
        console.log("  [message]", JSON.stringify(event.message)?.slice(0, 800));
      }
      if (event.type === "agent_end" || event.type === "turn_end") {
        console.log("  [keys]", JSON.stringify(Object.keys(event)));
      }
    }
    switch (event.type) {
      case "message_start":
        streamedThisMsg = false;
        break;
      case "message_update":
        if (event.assistantMessageEvent?.type === "text_delta") {
          streamedThisMsg = true;
          ws.send(JSON.stringify({ type: "token", delta: event.assistantMessageEvent.delta }));
        }
        break;
      case "message_end": {
        // Fallback: if nothing streamed, emit the final assistant text in one shot.
        const m = event.message;
        if (!streamedThisMsg && m?.role === "assistant") {
          const text = (m.content ?? [])
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("");
          if (text) ws.send(JSON.stringify({ type: "token", delta: text }));
        }
        break;
      }
      case "tool_execution_start":
        ws.send(JSON.stringify({ type: "tool", name: event.toolName, args: event.args }));
        break;
      case "agent_end":
        ws.send(JSON.stringify({ type: "end" }));
        break;
    }
  });

  ws.on("message", async (data) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === "prompt" && typeof msg.text === "string") {
      try {
        await session.prompt(msg.text);
      } catch (err: any) {
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
    }
  });
});
