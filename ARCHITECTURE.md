# Dimitri — Architecture

> Canonical build plan. Supersedes the topology discussion in SPEC.md.
> Reflects the locked goal: a downloadable **Tauri Mac app** that bundles the
> Python chemistry backend and embeds **pi** as the assistant, so a user installs
> it, connects their AI account, and gets the full molecular-science harness from
> the demo (design molecules, visualize proteins/chemicals) with zero setup.

## 0. Goal & acceptance criteria

See `/goal` (session). DoD: a non-technical chemist completes install → design →
protein viz → end-to-end docking workflow, unaided, in <10 min from download.

## 1. Shape

One double-clickable `Dimitri.app`. Three things inside it, all on localhost:

```
Dimitri.app  (Tauri: Rust core + WKWebView)
│
├─ WKWebView ── React web UI (panels: Project Data, Molecule Editor,
│               Protein Editor, Assistant, + analysis modules)
│
├─ sidecar: dimitri-engine ── python-build-standalone interpreter + uv-locked
│               venv (RDKit, OpenBabel, DeepChem, Vina, FastAPI). Serves a local
│               REST + WebSocket API. Owns the project store (SQLite).
│
└─ assistant: pi embedded via SDK (createAgentSession) in a Node sidecar.
              Chemistry tools injected. Streams events to the UI. Calls the
              engine's REST API to do work.
```

Single source of truth = the **project store** (SQLite in
`~/Library/Application Support/Dimitri/`). GUI panels, the pi assistant, and the
CLI are all clients that mutate the store and react to its event bus. That is how
a result triggered by a human, the CLI, or the agent shows up live everywhere
(e.g. a new docking-score column appears in the table).

## 2. The pi embedding pattern (from openclaw)

pi is embedded as a **library**, not run as a separate CLI. Pattern:

```ts
const model = getModel("anthropic", "claude-opus-4-5");
const sessionManager = SessionManager.open(sessionPath);
const { session } = await createAgentSession({
  model, thinkingLevel: "off", sessionManager,
  customTools: chemistryTools,   // generate_analogs, dock, find_protein, open_module, ...
});
session.agent.streamFn = streamSimple;
session.subscribe(event => forwardToUI(event));   // drives Assistant panel
await session.prompt(userText);
```

- Custom tools (`AgentTool<typeof params>`, TypeBox schemas) call the engine's
  REST API and write results to the store.
- `session.subscribe` events (`message_update`, `tool_execution_start/end`,
  `agent_end`) stream to the WebUI's Assistant panel.
- Package scope TBD: `@earendil-works/pi-*` (docs) vs `@mariozechner/pi-*` (gist).
  Confirm at install time.

## 3. Connecting an AI account (acceptance criterion #3) — reality

A ChatGPT Plus / Claude Pro **subscription cannot pay for API calls in our own
app** (verified, 2026). "Sign in with ChatGPT" is identity-only. The Apps SDK /
MCP route uses the subscription only when the chat originates from the user's
ChatGPT/Claude client. So criterion #3 is met by supporting **both**:

- **BYO key / OAuth (standalone app):** user signs in (OAuth identity) and
  provides an API key, or we proxy. The in-app Assistant runs on this. This is
  what makes the standalone `.app` self-contained.
- **Apps SDK / MCP (subscription path):** Dimitri also ships as an **MCP server**
  exposing the same chemistry tools, so users can drive it from their
  subscription-backed ChatGPT/Claude. The WebUI is then the visualization +
  manual-control surface; the engine + store stay shared.

Both reuse the identical tool layer and store. Pick BYO-key for v1; MCP server is
an additive surface, not a rewrite.

## 4. Modules (the unit of "a window/feature")

A module bundles four facets that travel together under one id:

| Facet | What | Where |
|---|---|---|
| Kernel | Python that does the work | `backend/dimitri_chem/` |
| CLI | terminal entrypoint | `backend/.../cli.py` |
| Tool | pi `AgentTool` so the agent can call it | `extensions/` / assistant |
| Panel | the React window | `web/modules/<id>/` |

Module manifest (`module.json`) declares id, label, category
(`data|editor|analysis|assistant`), panel, kernel, cli, tools, `consumes`,
`produces`, and a `runtime` hint: `wasm` (browser), `engine` (needs Python),
`gpu` (CUDA-only, unavailable on Mac → graceful degrade). The engine scans
manifests into a **registry**; the UI's Panels menu and the agent's
`list_modules`/`open_module` tools are generated from it.

Start with a **manifest registry in-repo** (simple, one process). Keep the
manifest stable so "one installable package per module" is a later additive
option, not a rewrite.

### v1 module set (maps to the demo)
- `project-data` (data) — spreadsheet, TIHKAL/ADMET/analogs/Proteins tabs
- `molecule-editor` (editor) — 2D draw (Ketcher), SMILES in/out
- `protein-editor` (editor) — 3D viewer (Mol*/NGL), docking-box definition
- `docking` (analysis) — Vina (CPU) + DiffDock (MPS); UniDock = Linux/GPU only
- `admet` (analysis) — toxicity/property metrics

## 5. File layout

```
dimitri/
├── backend/dimitri_chem/        # EXISTS — kernels; add server.py + store.py
├── web/                         # NEW — Vite + React UI (reused by Tauri & any web build)
│   ├── shell/                   # menu bar, dockable panel layout, Panels menu
│   ├── runtime/                 # module loader, store client, WS event bus
│   ├── modules/<id>/panel.tsx
│   └── assistant/               # Assistant panel ↔ pi event stream
├── assistant/                   # NEW — Node: pi createAgentSession + chemistry tools
├── src-tauri/                   # NEW — Tauri Rust core: spawns sidecars, opens UI
├── modules/<id>/module.json     # NEW — manifests
├── extensions/chemistry.ts      # EXISTS — kept for pi-package/CLI use of same tools
└── ARCHITECTURE.md / SPEC.md
```

## 6. Build order (each step independently runnable)

1. **Engine API** — `store.py` (SQLite + event bus) + `server.py` (FastAPI REST/WS);
   load TIHKAL dataset. *Test: curl analogs table.*
2. **Web shell + Project Data panel** reading the store. *Test: left half of screenshot.*
3. **pi assistant sidecar** — embed via `createAgentSession`, inject existing tools
   (generate_analogs, score_molecule), stream to Assistant panel. *Test: chat designs molecules.*
4. **Tauri wrapper** — bundle web + spawn engine & assistant sidecars; auto health-check.
   *Test: criteria #1, #2.*
5. **Account connect** — OAuth identity + API-key entry. *Test: criterion #3 (BYO key).*
6. **Molecule Editor (Ketcher) + Protein Editor (Mol*)** panels. *Test: #4, #5.*
7. **Docking module end-to-end** (Vina) — analogs → dock 7WC5 → live score column. *Test: #6.*
8. **Packaging** — python-build-standalone sidecar, code-sign + notarize. *Test: clean-Mac install.*

## 7. Packaging notes (the hard part)

- Python env: **python-build-standalone + uv-locked venv** in `Resources/`,
  launched as a Tauri sidecar. (Not PyInstaller — chokes on RDKit.)
- OpenBabel: no reliable wheel; defer to RDKit equivalents for MVP or vendor a binary.
- DiffDock/PyTorch: don't bundle; download weights on first docking use (MPS backend).
- UniDock (CUDA): Mac shows "unavailable", falls back to Vina.
- Signing: Developer ID + hardened runtime + entitlements for the bundled
  interpreter + notarization. Budget real time.
- Ship TIHKAL preloaded so first launch shows a populated app.

## 8. Open decisions

- Heavy-compute ownership for big campaigns: local engine (default) vs paid cloud tier vs BYO cloud.
- Cross-platform: Mac v1; engine stays container-ready so Linux/GPU can follow from same code.
