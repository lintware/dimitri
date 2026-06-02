// CommonJS interop shim for the packaged webview.
//
// A few Ketcher dependencies call `require(...)` at module-eval time (notably
// `require("raphael")`). The Vite dev server papers over this, but the packaged
// Tauri build has no bundler runtime, so those calls throw ReferenceError and
// blank the whole app. We import the real modules here and expose a synchronous
// `require` that hands them back. This module MUST be the first import in
// main.tsx so it fully evaluates before any Ketcher code runs.
import Raphael from "raphael";

const MODULES: Record<string, unknown> = {
  raphael: Raphael,
};

(window as any).global = window;
(window as any).require = (name: string) => MODULES[name] ?? {};

export {};
