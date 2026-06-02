# Tauri shell (`src-tauri/`) — Rust

Spawns + supervises both sidecars (engine :7842, assistant :7843) and loads the web UI.

## Layout
- `src/lib.rs` — sidecar spawn/supervise + dev-vs-bundled mode logic.
- `src/main.rs` — entry point. `tauri.conf.json` — build config. `vendor/` — bundled runtimes.

## dev vs bundled mode (`lib.rs`)
- `bundled_vendor()` returns the vendored runtime dir ONLY when `resource_dir` is inside a
  `.app`; otherwise **dev mode** (uv/tsx from the repo).
- A GUI-launched `.app` gets a minimal `PATH`, so dev mode augments it (`~/.local/bin`,
  `/opt/homebrew/bin`, …) to find `uv`/`node`.
- **Debug binary loads `build.devUrl` (http://localhost:5173), NOT the embedded UI** — vite
  MUST be running on :5173 before launch or the window is blank white (loads once, no retry).

## Vendoring (`vendor/`, → `Contents/Resources` via `bundle.resources`)
- `python/` — CPython 3.12 + rdkit/fastapi/uvicorn + pip-installed backend.
- `node/` — Node LTS arm64. `assistant/`, `modules/` — copies.
- `extensions/`, `skills/`, `package.json` — copies; the assistant loads the `/chem` extension +
  `chem` skill from the `pi` manifest in `vendor/package.json` (its resolved package root).
- After editing `backend/` or `assistant/src/`: re-sync into `vendor/` +
  `pip install --force-reinstall --no-deps backend/` before `cargo tauri build`.

## Process hygiene
- `pgrep -f target/debug/dimitri` → 2 pids (main + WebKit helper); use `pkill -f`.
- Kill stale sidecars before relaunch or :7842/:7843 conflict silently:
  `pkill -f dimitri-engine; pkill -f "tsx.*assistant"`.
- `vendor/` and `target/` are gitignored.
