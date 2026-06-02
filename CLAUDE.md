# Dimitri — AI Molecular-Science Harness

Dimitri (org: **lintware**) is a downloadable **Tauri desktop app** that bundles a Python
chemistry backend and uses **pi** (`@earendil-works/pi-*`) as its embedded assistant. A user
installs the `.app`, connects their own AI subscription, and gets a full molecular-science
harness — design molecules, visualize proteins, dock, rank — with **zero manual setup**
(no terminal, conda, or Docker). It is an open-source recreation of Entropy Labs' "Chemistry".

## Architecture (3 processes, one project store)

```
┌─ Tauri shell (src-tauri/, Rust) ── spawns + supervises both sidecars, loads the web UI
│
├─ Engine sidecar    backend/  (Python, FastAPI)  :7842  — RDKit chemistry + SQLite store
├─ Assistant sidecar assistant/ (Node, pi agent)  :7843  — LLM + chemistry tools over WS
└─ Web UI            web/      (Vite + React, dockview panels) — talks to both
```

- **Single source of truth:** the engine's SQLite **ProjectStore** (`backend/dimitri_chem/store.py`).
  GUI panels, the assistant, and the CLI all read/write it; an async **EventBus** fans changes
  out over `WS /events` so the UI updates live (`dataset_changed`, `column_added`).
- **Triad control:** every capability is reachable three ways — a GUI panel, a CLI, and an LLM
  tool — all hitting the same engine REST surface.
- **Modules:** `modules/<id>/module.json` (id, label, category, runtime, tools) is a registry
  scanned by the engine at `GET /modules`. Current: project-data, molecule-editor,
  protein-editor, docking, admet.

See `ARCHITECTURE.md` for the canonical design and `SPEC.md` for scope.

## Run it

### Dev (fast iteration — UI hot-reloads)
```bash
# 1. dev server (serves the latest web UI)
cd web && npx vite --port 5173            # keep running

# 2. build + launch the debug app (spawns its own engine+assistant sidecars via uv/tsx)
cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo build
PATH="$HOME/.cargo/bin:$PATH" ./target/debug/dimitri
```
**The debug binary loads `build.devUrl` (http://localhost:5173), NOT the embedded UI — so vite
MUST be running on :5173 or the window is blank white.** The webview loads once at startup and
won't retry, so start vite *before* launching.

### Bundled `.app` (the real downloadable product)
```bash
cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo tauri build
# → target/release/bundle/macos/Dimitri.app  (self-contained, ~880 MB)
```
The release build uses the **embedded UI** + **vendored runtimes** — no dev server, no system
Python/Node. Launches with a double-click. After editing backend or assistant source, re-sync
into `src-tauri/vendor/` before rebuilding (see Vendoring).

## Key conventions & gotchas

- **dev vs bundled mode** (`src-tauri/src/lib.rs`): `bundled_vendor()` returns the vendored
  runtime dir ONLY when `resource_dir` is inside a `.app`; otherwise dev mode (uv/tsx from the
  repo). A GUI-launched `.app` gets a minimal `PATH`, so dev mode augments it
  (`~/.local/bin`, `/opt/homebrew/bin`, …) to find `uv`/`node`.
- **Web API base** (`web/src/runtime/engine.ts`): detects dev via `location.port === "5173"`.
  Dev → vite proxy (`/api`, `/events`, `/assistant`). Packaged → direct `http://127.0.0.1:7842`
  / `ws://127.0.0.1:7843` (engine sets CORS `*`). The same logic is in `Assistant.tsx`.
- **WKWebView (Tauri/Safari webview) quirks:**
  - **3D viewers use 3Dmol.js, NOT NGL or Mol\*.** NGL renders into the WebGL buffer but
    WKWebView never composites its live canvas (shows black); Mol* fails to init under Vite.
    3Dmol composites correctly and is natively interactive. Used in `ProteinEditor.tsx` and the
    Molecule Editor 3D toggle.
  - Keep WebGL/Ketcher hosts **mounted and toggle `visibility`** instead of unmounting — a
    removed canvas leaves a dead context (`bitmap.close` errors on return).
  - **Ketcher needs a CJS shim** (`web/src/cjs-shim.ts`, imported first in `main.tsx`): some
    deps call `require("raphael")` at module-eval, which blanks WKWebView. Vite also needs
    `define: { "process.env": {}, global: "globalThis" }`.
- **External fetches go through the engine, not the webview.** The `tauri://` origin can't
  fetch `files.rcsb.org` / PubChem cross-origin, so the engine proxies them:
  `GET /protein/{id}` (RCSB PDB, cached in `~/Library/Application Support/Dimitri/pdb_cache/`),
  `GET /lookup?name=` (PubChem → authoritative SMILES), `GET /molecule3d?smiles=` (RDKit 3D).
- **Assistant must ACT, not describe.** Tools are defined in `assistant/src/tools.ts` and the
  system prompt (`assistant/src/index.ts`) requires the agent to call them rather than telling
  the user what to do. Crucially: **always `lookup_molecule` (PubChem) before drawing any named
  compound — never invent a SMILES.** Tools relay UI actions to the web client over WS
  (`open_module`, `load_molecule`, `load_protein`) → `window` CustomEvents the panels listen for.
- **Chat (`web/src/panels/Assistant.tsx`):** token deltas arrive as `{type:"token", delta}`
  (field is `delta`, not `text`). State updates must be **pure** (replace the message object) —
  mutating it doubles tokens under React StrictMode. Assistant text renders as markdown
  (react-markdown). History persists in a module-level array across panel open/close.
- **Model selection** (`pickModel()` in `assistant/src/index.ts`): `DIMITRI_MODEL` override →
  DeepSeek (`deepseek-v4-pro`) → OpenAI (`gpt-5`) → xAI (`grok-4.3`) → Anthropic OAuth
  (`claude-opus-4-5`). Keys load from `assistant/.env` (dev, gitignored) and
  `~/Library/Application Support/Dimitri/.env` (packaged). **Never commit or echo API keys.**
- **Process hygiene:** `pgrep -f target/debug/dimitri` returns 2 pids (main + WebKit helper) —
  use `pkill -f`. Always kill stale sidecars before relaunching or ports 7842/7843 conflict and
  the new app's sidecars fail to bind silently:
  `pkill -f dimitri-engine; pkill -f "tsx.*assistant"`. Sidecars self-exit when the app dies
  (watchdog on `DIMITRI_PARENT_PID`).

## Vendoring (self-contained bundle)

`src-tauri/vendor/` holds the bundled runtime, copied into `Contents/Resources` via
`bundle.resources: ["vendor/**/*"]`:
- `python/` — python-build-standalone CPython 3.12 with rdkit/fastapi/uvicorn + the backend
  pip-installed into site-packages. Bundled engine runs `python/bin/python3 -m dimitri_chem.server`
  (not the console script — its shebang is a build-time absolute path).
- `node/` — Node LTS arm64. Bundled assistant runs
  `node/bin/node assistant/node_modules/tsx/dist/cli.mjs assistant/src/index.ts`.
- `assistant/`, `modules/` — copies. Engine finds the registry via `DIMITRI_MODULES`.
- `extensions/`, `skills/`, `package.json` — copies. The assistant resolves its package root as
  the parent of `assistant/` (so `vendor/` in the bundle) and loads the `/chem` extension + `chem`
  skill from the `pi` manifest in that `package.json` (`buildResourceLoader()` in
  `assistant/src/index.ts`). Without these three, `/chem` and the skill silently don't load.

After editing `backend/` or `assistant/src/`: re-sync into `vendor/` and
`python/bin/python3 -m pip install --force-reinstall --no-deps backend/` before `cargo tauri build`.

## Engine REST surface (`backend/dimitri_chem/server.py`, :7842)
`GET /health` · `GET /modules` · `GET /datasets` · `GET /datasets/{id}/rows` ·
`POST /kernel/generate_analogs` · `POST /kernel/score_molecule` · `POST /kernel/dock_dataset` ·
`POST /kernel/define_docking_box` · `GET /lookup?name=` · `GET /molecule3d?smiles=` ·
`GET /protein/{pdb_id}` · `WS /events`.

## Stack
Tauri v2 · React 18 + Vite 6 · dockview · Ketcher (2D) · RDKit-WASM + 3Dmol.js · react-markdown ·
FastAPI + RDKit + SQLite · pi (`@earendil-works/pi-coding-agent` / `pi-ai`) + `typebox` (1.x).
Docking: pluggable AutoDock Vina binary (`DIMITRI_VINA`) else a deterministic RDKit affinity
estimate. All science libs are OSS (Ketcher Apache-2.0, RDKit BSD, 3Dmol BSD, Vina Apache-2.0);
only the LLM is bring-your-own-key.

## Conventions
- Don't commit/push unless asked. Branch off `main` first.
- Don't commit secrets, `node_modules/`, `dist/`, `.venv/`, `src-tauri/target/`, or
  `src-tauri/vendor/` (all gitignored).
- Verify UI/3D changes visually (Playwright with `--use-gl=angle --use-angle=swiftshader`, or
  `screencapture` of the live window) — WebGL behaves differently across engines.
