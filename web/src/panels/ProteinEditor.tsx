import { useEffect, useRef, useState } from "react";
import * as $3Dmol from "3dmol";
import { defineDockingBox, getProteinPdb } from "../runtime/engine";

// 3D protein viewer (the lightweight Chimera). Uses 3Dmol.js — a real, fully
// interactive WebGL viewer (drag to rotate, scroll to zoom) that composites
// correctly in the Tauri/WKWebView. Import by PDB ID, choose a style, focus the
// ligand/pocket, and define a docking box stored on the project.
type Style = "cartoon" | "surface" | "stick";

export function ProteinEditor() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [pdbId, setPdbId] = useState("7WC5");
  const [loaded, setLoaded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState<Style>("cartoon");
  const [box, setBox] = useState({ cx: 0, cy: 0, cz: 0, size: 20 });
  const [boxSaved, setBoxSaved] = useState(false);

  useEffect(() => {
    if (!hostRef.current) return;
    const viewer = $3Dmol.createViewer(hostRef.current, { backgroundColor: "#0d0f1a" });
    viewerRef.current = viewer;
    (window as any).__dimitriViewer = viewer; // debug hook
    const ro = new ResizeObserver(() => {
      try {
        viewer.resize();
        viewer.render();
      } catch {
        /* not ready */
      }
    });
    ro.observe(hostRef.current);
    return () => {
      ro.disconnect();
      try {
        viewer.clear();
      } catch {
        /* noop */
      }
      if (hostRef.current) hostRef.current.innerHTML = "";
      viewerRef.current = null;
    };
  }, []);

  // (re)apply the selected representation; ligands always shown as stick+sphere
  const applyStyle = (v: any, s: Style) => {
    v.removeAllSurfaces?.();
    if (s === "stick") {
      v.setStyle({}, { stick: { radius: 0.15 } });
    } else {
      v.setStyle({}, { cartoon: { color: "spectrum" } });
      if (s === "surface") {
        v.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.65, color: "white" }, { hetflag: false });
      }
    }
    // ligands (hetero, non-water) as CPK sticks + light spheres
    v.setStyle({ hetflag: true, not: { resn: "HOH" } }, { stick: { colorscheme: "default" }, sphere: { scale: 0.3 } });
    v.render();
  };

  const load = async (idOverride?: string) => {
    const v = viewerRef.current;
    if (!v) return;
    const id = (idOverride ?? pdbId).trim();
    if (!id) return;
    setBusy(true);
    setBoxSaved(false);
    try {
      const pdbText = await getProteinPdb(id);
      v.clear();
      v.addModel(pdbText, "pdb");
      applyStyle(v, style);
      v.zoomTo();
      v.render();
      v.resize();
      setLoaded(id.toUpperCase());
    } catch (e: any) {
      setLoaded(`error loading ${id}: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  // The assistant's load_protein tool drives the viewer via this event.
  useEffect(() => {
    const onSetPdb = (e: Event) => {
      const id = (e as CustomEvent).detail as string;
      if (typeof id === "string" && id) {
        setPdbId(id);
        load(id);
      }
    };
    window.addEventListener("dimitri:set-pdb", onSetPdb);
    return () => window.removeEventListener("dimitri:set-pdb", onSetPdb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onStyle = (s: Style) => {
    setStyle(s);
    const v = viewerRef.current;
    if (v && loaded && !loaded.startsWith("error")) applyStyle(v, s);
  };

  const focusLigand = () => {
    const v = viewerRef.current;
    if (!v) return;
    v.zoomTo({ hetflag: true, not: { resn: "HOH" } });
    v.render();
  };

  const saveBox = async () => {
    if (!loaded || loaded.startsWith("error")) return;
    await defineDockingBox(loaded, box);
    setBoxSaved(true);
  };

  return (
    <div className="panel">
      <div className="panel-toolbar" style={{ flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)" }}>PDB ID</span>
        <input value={pdbId} onChange={(e) => setPdbId(e.target.value)} style={{ width: 80 }} />
        <button onClick={() => load()} disabled={busy}>
          {busy ? "loading…" : "Import"}
        </button>
        {loaded && !loaded.startsWith("error") && (
          <>
            <select value={style} onChange={(e) => onStyle(e.target.value as Style)} title="Representation">
              <option value="cartoon">Cartoon</option>
              <option value="surface">Surface</option>
              <option value="stick">Sticks</option>
            </select>
            <button onClick={focusLigand} title="Zoom to the bound ligand / pocket">Focus ligand</button>
          </>
        )}
        {loaded && <span style={{ color: loaded.startsWith("error") ? "var(--danger,#e57373)" : "var(--muted)" }}>{loaded}</span>}
      </div>
      <div className="panel-body" style={{ display: "flex", flexDirection: "column" }}>
        <div ref={hostRef} style={{ position: "relative", flex: 1, minHeight: 280 }} />
        <div className="panel-toolbar" style={{ borderTop: "1px solid var(--border)", borderBottom: "none", flexWrap: "wrap" }}>
          <span style={{ color: "var(--muted)" }}>Docking box</span>
          {(["cx", "cy", "cz", "size"] as const).map((k) => (
            <label key={k} style={{ color: "var(--muted)" }}>
              {k}
              <input
                type="number"
                value={box[k]}
                onChange={(e) => setBox({ ...box, [k]: Number(e.target.value) })}
                style={{ width: 56, marginLeft: 4 }}
              />
            </label>
          ))}
          <button onClick={saveBox} disabled={!loaded || loaded.startsWith("error")}>
            Define box
          </button>
          {boxSaved && <span style={{ color: "var(--success)" }}>✓ saved</span>}
        </div>
      </div>
    </div>
  );
}
