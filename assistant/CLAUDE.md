# Assistant sidecar (`assistant/`) — Node + pi agent

The embedded LLM agent (pi: `@earendil-works/pi-*`) exposing chemistry tools over WS.
Runs on **:7843**.

## Layout (`src/`)
- `index.ts` — agent session, system prompt, `pickModel()`, WS server.
- `tools.ts` — tool definitions (typebox 1.x schemas).

## Conventions
- **The assistant must ACT, not describe.** The system prompt requires calling tools
  rather than telling the user what to do.
- **Always `lookup_molecule` (PubChem) before drawing any named compound — never invent
  a SMILES.**
- UI-action tools relay over WS (`open_module`, `load_molecule`, `load_protein`) → the
  web client turns them into `window` CustomEvents the panels listen for.
- `pickModel()` precedence: `DIMITRI_MODEL` override → DeepSeek (`deepseek-v4-pro`) →
  OpenAI (`gpt-5`) → xAI (`grok-4.3`) → Anthropic OAuth (`claude-opus-4-5`).
- Keys: `assistant/.env` (dev, gitignored) + `~/Library/Application Support/Dimitri/.env`
  (packaged). **Never commit or echo API keys.**
- Bundled runs `node/bin/node node_modules/tsx/dist/cli.mjs src/index.ts`.
- Self-exits when the app dies (watchdog on `DIMITRI_PARENT_PID`).
