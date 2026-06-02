import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Engine (FastAPI) runs on :7842; assistant sidecar on :7843.
export default defineConfig({
  plugins: [react()],
  // Ketcher (and some of its deps) reference `process.env` / `global` at runtime;
  // shim them for the browser build.
  define: {
    "process.env": {},
    global: "globalThis",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:7842", rewrite: (p) => p.replace(/^\/api/, "") },
      "/events": { target: "ws://127.0.0.1:7842", ws: true },
      "/assistant": { target: "ws://127.0.0.1:7843", ws: true },
    },
  },
});
