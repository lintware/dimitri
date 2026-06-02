import { useEffect, useState, useCallback } from "react";
import {
  listDatasets,
  getRows,
  generateAnalogs,
  dockDataset,
  subscribeEvents,
  type Dataset,
} from "../runtime/engine";

// Columns that lead the table; everything else follows in insertion order.
const LEAD = ["smiles", "score", "mw", "logp", "tpsa", "qed", "docking_score"];

export function ProjectData() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [active, setActive] = useState<string>("analogs");
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [scaffold, setScaffold] = useState("NCCc1c[nH]c2ccccc12");
  const [busy, setBusy] = useState(false);
  const [docking, setDocking] = useState(false);
  const [dockNote, setDockNote] = useState<string | null>(null);
  const [sortByDock, setSortByDock] = useState(false);

  const refresh = useCallback(async () => {
    const ds = await listDatasets();
    setDatasets(ds);
    if (ds.length && !ds.find((d) => d.id === active)) setActive(ds[0].id);
    if (ds.find((d) => d.id === active)) setRows(await getRows(active));
  }, [active]);

  useEffect(() => {
    refresh();
    return subscribeEvents((e) => {
      if (e.type === "dataset_changed" || e.type === "column_added") refresh();
    });
  }, [refresh]);

  const onGenerate = async () => {
    setBusy(true);
    try {
      await generateAnalogs(scaffold, 200, "analogs");
    } finally {
      setBusy(false);
    }
  };

  const onDock = async () => {
    setDocking(true);
    setDockNote(null);
    try {
      const res = await dockDataset({ datasetId: active });
      if (res?.error) setDockNote(res.error);
      else {
        setDockNote(`docked ${res.docked} ligands · ${res.method}`);
        setSortByDock(true);
      }
    } finally {
      setDocking(false);
    }
  };

  const cols = orderColumns(rows);
  const hasDock = rows.some((r) => r.docking_score != null);
  const view = sortByDock && hasDock
    ? [...rows].sort((a, b) => (a.docking_score ?? 1e9) - (b.docking_score ?? 1e9)) // best (most negative) first
    : rows;

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <select value={active} onChange={(e) => setActive(e.target.value)}>
          {datasets.length === 0 && <option>analogs</option>}
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label} ({d.rows})
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <input
          value={scaffold}
          onChange={(e) => setScaffold(e.target.value)}
          placeholder="scaffold SMILES"
          style={{ width: 220 }}
        />
        <button onClick={onGenerate} disabled={busy}>
          {busy ? "generating…" : "Generate analogs"}
        </button>
        <button onClick={onDock} disabled={docking || rows.length === 0} title="Dock all ligands against the defined protein box">
          {docking ? "docking…" : "Dock"}
        </button>
        {hasDock && (
          <label style={{ color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={sortByDock} onChange={(e) => setSortByDock(e.target.checked)} />
            rank by binding
          </label>
        )}
        {dockNote && <span style={{ color: "var(--muted)" }}>{dockNote}</span>}
      </div>
      <div className="panel-body">
        {rows.length === 0 ? (
          <div className="empty">
            No data yet. Enter a scaffold and click “Generate analogs”, or ask the assistant.
          </div>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c} className={c === "score" || c === "docking_score" ? "score" : ""}>
                      {fmt(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function orderColumns(rows: Record<string, any>[]): string[] {
  if (!rows.length) return [];
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (typeof r[k] !== "object") keys.add(k);
  const lead = LEAD.filter((k) => keys.has(k));
  const rest = [...keys].filter((k) => !lead.includes(k));
  return [...lead, ...rest];
}

function fmt(v: any): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  return String(v);
}
