import { useEffect, useRef, useState } from "react";
import { Editor } from "ketcher-react";
import { StandaloneStructServiceProvider } from "ketcher-standalone";
import type { Ketcher } from "ketcher-core";
import "ketcher-react/dist/index.css";
import * as $3Dmol from "3dmol";
import { analyzeSmiles, type MolInfo } from "../runtime/rdkit";
import { scoreMolecule, getMolecule3d } from "../runtime/engine";

// Interactive molecule editor: draw/edit structures in Ketcher (full 2D sketcher
// — add atoms, bonds, rings, templates) with live two-way SMILES sync, RDKit
// descriptors, and an engine-backed designer score. Edits in the canvas update
// the SMILES + descriptors; typing a SMILES redraws the canvas.
const KEY_DESCRIPTORS = ["amw", "CrippenClogP", "tpsa", "NumHBD", "NumHBA", "NumRotatableBonds", "qed"];
const LABELS: Record<string, string> = {
  amw: "MW",
  CrippenClogP: "LogP",
  tpsa: "TPSA",
  NumHBD: "HBD",
  NumHBA: "HBA",
  NumRotatableBonds: "RotB",
  qed: "QED",
};

const structServiceProvider = new StandaloneStructServiceProvider();
const INITIAL_SMILES = "CC(C)NCCc1c[nH]c2ccccc12";

export function MoleculeEditor() {
  const [smiles, setSmiles] = useState(INITIAL_SMILES);
  const [info, setInfo] = useState<MolInfo | null>(null);
  const [score, setScore] = useState<{ score: number; breakdown: Record<string, number> } | null>(null);
  const [scoring, setScoring] = useState(false);
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [view3dErr, setView3dErr] = useState<string | null>(null);
  const ketcherRef = useRef<Ketcher | null>(null);
  const mol3dHostRef = useRef<HTMLDivElement>(null);
  const mol3dViewerRef = useRef<any>(null);
  // guards to avoid feedback loops between the canvas and the SMILES field
  const lastFromCanvas = useRef<string | null>(null);
  const lastPushed = useRef<string | null>(null);
  // latest SMILES, so a late Ketcher init draws the current molecule (not the
  // default) — e.g. when the assistant opens the editor and loads a molecule.
  const smilesRef = useRef(INITIAL_SMILES);
  smilesRef.current = smiles;

  // The assistant's load_molecule tool drives the editor via this event.
  useEffect(() => {
    const onSet = (e: Event) => {
      const smi = (e as CustomEvent).detail as string;
      if (typeof smi === "string" && smi) setSmiles(smi);
    };
    window.addEventListener("dimitri:set-smiles", onSet);
    return () => window.removeEventListener("dimitri:set-smiles", onSet);
  }, []);

  // recompute descriptors whenever SMILES changes
  useEffect(() => {
    let alive = true;
    analyzeSmiles(smiles).then((i) => alive && setInfo(i));
    setScore(null);
    return () => {
      alive = false;
    };
  }, [smiles]);

  // tidy up the 3D viewer when the panel unmounts
  useEffect(() => {
    return () => {
      try {
        mol3dViewerRef.current?.clear?.();
      } catch {
        /* noop */
      }
      mol3dViewerRef.current = null;
    };
  }, []);

  // 3D view: generate a conformer server-side (RDKit) and render in 3Dmol
  // (the same Chimera-style WebGL viewer used for proteins).
  useEffect(() => {
    if (mode !== "3d" || !mol3dHostRef.current || !info?.valid) return;
    let alive = true;
    setView3dErr(null);
    if (!mol3dViewerRef.current) {
      mol3dViewerRef.current = $3Dmol.createViewer(mol3dHostRef.current, { backgroundColor: "#0d0f1a" });
    }
    const v = mol3dViewerRef.current;
    getMolecule3d(smiles)
      .then((mol) => {
        if (!alive) return;
        v.clear();
        v.addModel(mol, "mol");
        v.setStyle({}, { stick: { radius: 0.18 }, sphere: { scale: 0.28 } });
        v.zoomTo();
        v.render();
        v.resize();
      })
      .catch((e) => alive && setView3dErr(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [mode, smiles, info?.valid]);

  // push SMILES typed in the field down into the canvas (skip echoes from canvas)
  useEffect(() => {
    const k = ketcherRef.current;
    if (!k || !info?.valid) return;
    if (smiles === lastFromCanvas.current) return; // came from the canvas; don't re-push
    if (smiles === lastPushed.current) return;
    lastPushed.current = smiles;
    k.setMolecule(smiles).catch(() => {});
  }, [smiles, info?.valid]);

  const onKetcherInit = (ketcher: Ketcher) => {
    ketcherRef.current = ketcher;
    (window as any).__dimitriKetcher = ketcher; // debug hook
    // draw whatever SMILES is current at init time (may have been set by the
    // assistant's load_molecule before Ketcher finished loading)
    lastPushed.current = smilesRef.current;
    ketcher.setMolecule(smilesRef.current).catch(() => {});
    ketcher.editor.subscribe("change", async () => {
      try {
        const smi = await ketcher.getSmiles();
        if (!smi) return;
        lastFromCanvas.current = smi;
        setSmiles(smi);
      } catch {
        /* transient parse states while drawing */
      }
    });
  };

  const onScore = async () => {
    setScoring(true);
    try {
      const r = await scoreMolecule(smiles);
      setScore({ score: r.score, breakdown: r.breakdown });
    } finally {
      setScoring(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <span style={{ color: "var(--muted)" }}>SMILES</span>
        <input value={smiles} onChange={(e) => setSmiles(e.target.value)} style={{ flex: 1 }} />
        <div className="seg">
          <button className={mode === "2d" ? "on" : ""} onClick={() => setMode("2d")}>2D</button>
          <button className={mode === "3d" ? "on" : ""} onClick={() => setMode("3d")} disabled={!info?.valid}>3D</button>
        </div>
        <button onClick={onScore} disabled={scoring || !info?.valid}>
          {scoring ? "scoring…" : "Score"}
        </button>
      </div>
      <div className="panel-body" style={{ display: "flex", gap: 12, padding: 12, minHeight: 0 }}>
        <div style={{ flex: 2, background: mode === "2d" ? "#fff" : "#0d0f1a", borderRadius: 6, minWidth: 420, position: "relative", overflow: "hidden" }}>
          {/* 2D Ketcher stays mounted (kept hidden in 3D mode so it doesn't re-init) */}
          <div style={{ position: "absolute", inset: 0, visibility: mode === "2d" ? "visible" : "hidden" }}>
            <Editor
              staticResourcesUrl=""
              structServiceProvider={structServiceProvider}
              onInit={onKetcherInit}
              errorHandler={(m: string) => console.warn("ketcher:", m)}
            />
          </div>
          {/* 3D host stays mounted (hidden in 2D) so the 3Dmol canvas/context
              survives toggling — unmounting it left a dead viewer ("bitmap.close"). */}
          <div
            ref={mol3dHostRef}
            style={{ position: "absolute", inset: 0, visibility: mode === "3d" ? "visible" : "hidden" }}
          >
            {view3dErr && (
              <div style={{ color: "var(--danger,#e57373)", padding: 12, fontSize: 12 }}>3D error: {view3dErr}</div>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <table className="grid">
            <tbody>
              {info && !info.valid && (
                <tr>
                  <td colSpan={2} style={{ color: "var(--danger, #e57373)" }}>Invalid SMILES</td>
                </tr>
              )}
              {info?.descriptors &&
                KEY_DESCRIPTORS.filter((k) => k in info.descriptors!).map((k) => (
                  <tr key={k}>
                    <td style={{ color: "var(--muted)" }}>{LABELS[k] ?? k}</td>
                    <td>{fmt(info.descriptors![k])}</td>
                  </tr>
                ))}
              {score && (
                <>
                  <tr>
                    <td colSpan={2} style={{ paddingTop: 10, color: "var(--accent)" }}>
                      Designer score: <b>{score.score?.toFixed(4)}</b>
                    </td>
                  </tr>
                  {Object.entries(score.breakdown ?? {})
                    .filter(([k]) => k !== "total")
                    .map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ color: "var(--muted)" }}>{k}</td>
                        <td>{typeof v === "number" ? v.toFixed(3) : String(v)}</td>
                      </tr>
                    ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(3);
}
