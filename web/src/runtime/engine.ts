// Client for the Dimitri engine (FastAPI on :7842, proxied at /api and /events).

export type Dataset = { id: string; label: string; kind: string; rows: number; meta: any };
export type Module = { id: string; label: string; category: string; runtime: string; description?: string };
export type EngineEvent = { type: string; ts: number; [k: string]: any };

// In the Vite dev server we go through the proxy (/api, /events). In the packaged
// Tauri webview there is no proxy, so talk to the engine sidecar directly. The
// engine sets CORS `*`, so direct calls work in both. Detect dev by the 5173 port.
const DEV = typeof location !== "undefined" && location.port === "5173";
const API = DEV ? "/api" : "http://127.0.0.1:7842";
const EVENTS_URL = DEV
  ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events`
  : "ws://127.0.0.1:7842/events";

export async function getHealth() {
  return (await fetch(`${API}/health`)).json();
}

export async function listDatasets(): Promise<Dataset[]> {
  return (await fetch(`${API}/datasets`)).json();
}

export async function getRows(datasetId: string, limit = 2000): Promise<Record<string, any>[]> {
  const r = await fetch(`${API}/datasets/${datasetId}/rows?limit=${limit}`);
  return (await r.json()).rows ?? [];
}

export async function listModules(): Promise<Module[]> {
  return (await fetch(`${API}/modules`)).json();
}

export async function generateAnalogs(scaffold: string, count = 200, name = "design_session") {
  const r = await fetch(`${API}/kernel/generate_analogs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scaffold, count, name }),
  });
  return r.json();
}

export async function scoreMolecule(smiles: string) {
  const r = await fetch(`${API}/kernel/score_molecule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ smiles }),
  });
  return r.json();
}

export async function defineDockingBox(
  pdbId: string,
  box: { cx: number; cy: number; cz: number; size: number }
) {
  const r = await fetch(`${API}/kernel/define_docking_box`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdb_id: pdbId, ...box }),
  });
  return r.json();
}

// Fetch a PDB structure via the engine (avoids the webview's cross-origin block
// on files.rcsb.org from the tauri:// origin; also caches for offline reuse).
export async function getProteinPdb(pdbId: string): Promise<string> {
  const r = await fetch(`${API}/protein/${encodeURIComponent(pdbId)}`);
  if (!r.ok) throw new Error(`protein ${pdbId} -> ${r.status}`);
  return r.text();
}

// 3D conformer (MOL block) for a SMILES, generated server-side by RDKit — for
// viewing small molecules in the 3D (Chimera-style) viewer.
export async function getMolecule3d(smiles: string): Promise<string> {
  const r = await fetch(`${API}/molecule3d?smiles=${encodeURIComponent(smiles)}`);
  if (!r.ok) throw new Error(`molecule3d -> ${r.status}`);
  return r.text();
}

// Dock every ligand in a dataset against a protein's box (or explicit coords);
// merges a live docking_score column back into the table.
export async function dockDataset(opts: {
  datasetId?: string;
  pdbId?: string;
  cx?: number;
  cy?: number;
  cz?: number;
  size?: number;
}) {
  const r = await fetch(`${API}/kernel/dock_dataset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dataset_id: opts.datasetId ?? "analogs",
      pdb_id: opts.pdbId,
      cx: opts.cx,
      cy: opts.cy,
      cz: opts.cz,
      size: opts.size,
    }),
  });
  return r.json();
}

// Live event bus from the engine. Reconnects automatically.
export function subscribeEvents(onEvent: (e: EngineEvent) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  const connect = () => {
    ws = new WebSocket(EVENTS_URL);
    ws.onmessage = (m) => onEvent(JSON.parse(m.data));
    ws.onclose = () => {
      if (!closed) setTimeout(connect, 1500);
    };
  };
  connect();
  return () => {
    closed = true;
    ws?.close();
  };
}
