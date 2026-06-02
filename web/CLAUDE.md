# Web UI (`web/`) — Vite + React + dockview

The panel UI. Talks to the engine (:7842 REST + `WS /events`) and the assistant (:7843 WS).

## Layout (`src/`)
- `App.tsx` — dockview panel shell. `panels/` — Assistant, ProteinEditor, MoleculeEditor, etc.
- `runtime/engine.ts` — API base detection. `cjs-shim.ts` — Ketcher CJS shim (imported
  first in `main.tsx`).

## WKWebView (Tauri/Safari webview) gotchas
- **3D viewers use 3Dmol.js, NOT NGL or Mol\*** — NGL/Mol* render black or fail to init
  under WKWebView. Used in `ProteinEditor.tsx` + Molecule Editor 3D toggle.
- Keep WebGL/Ketcher hosts **mounted, toggle `visibility`** — unmounting kills the GL
  context (`bitmap.close` errors on return).
- Ketcher needs `cjs-shim.ts` + Vite `define: { "process.env": {}, global: "globalThis" }`.

## API base (`runtime/engine.ts`, also in `Assistant.tsx`)
Dev detected via `location.port === "5173"` → vite proxy (`/api`, `/events`, `/assistant`).
Packaged → direct `http://127.0.0.1:7842` / `ws://127.0.0.1:7843`.

## Assistant chat (`panels/Assistant.tsx`)
- Token deltas arrive as `{type:"token", delta}` (field is `delta`, not `text`).
- State updates must be **pure** (replace the message object) — mutating doubles tokens
  under React StrictMode.
- Assistant text renders as markdown (react-markdown). History persists in a module-level
  array across panel open/close.

## Verify visually
WebGL behaves differently across engines — verify UI/3D changes with Playwright
(`--use-gl=angle --use-angle=swiftshader`) or `screencapture` of the live window.
