"""
Dimitri engine HTTP API.

Local REST + WebSocket service that the web UI, the pi assistant, and the CLI
all talk to. Wraps the existing DesignLibrary kernels and the ProjectStore.

Run:
    uv run --project backend uvicorn dimitri_chem.server:app --port 7842
or:
    uv run --project backend dimitri-engine        # (script entrypoint, see pyproject)
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import __version__
from .docking import DockBox, dock_ligand
from .library import DesignLibrary
from .molecule import Molecule
from .store import ProjectStore

app = FastAPI(title="Dimitri Engine", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # localhost-only service; UI is same machine
    allow_methods=["*"],
    allow_headers=["*"],
)

store = ProjectStore()

# In the dev repo this resolves to <repo>/modules. In the packaged app the
# backend is installed into the vendored Python's site-packages (so the relative
# path no longer points at the repo), and the .app sets DIMITRI_MODULES to the
# bundled registry dir.
import os as _os

MODULES_DIR = Path(
    _os.environ.get("DIMITRI_MODULES") or (Path(__file__).resolve().parents[2] / "modules")
)


# --- health & registry --------------------------------------------------
@app.get("/health")
def health() -> dict[str, Any]:
    checks = {"engine": True, "version": __version__}
    try:
        from rdkit import Chem  # noqa: F401

        checks["rdkit"] = True
    except Exception:
        checks["rdkit"] = False
    try:
        import vina  # noqa: F401

        checks["vina"] = True
    except Exception:
        checks["vina"] = False
    checks["ok"] = checks["rdkit"]  # rdkit is the minimum bar
    return checks


@app.get("/modules")
def modules() -> list[dict[str, Any]]:
    """Module registry, scanned from modules/<id>/module.json."""
    found = []
    if MODULES_DIR.is_dir():
        for manifest in sorted(MODULES_DIR.glob("*/module.json")):
            try:
                found.append(json.loads(manifest.read_text()))
            except Exception:
                continue
    return found


# --- datasets -----------------------------------------------------------
@app.get("/datasets")
def datasets() -> list[dict[str, Any]]:
    return store.list_datasets()


@app.get("/datasets/{dataset_id}/rows")
def dataset_rows(dataset_id: str, limit: int = 2000, offset: int = 0) -> dict[str, Any]:
    return {"dataset_id": dataset_id, "rows": store.get_rows(dataset_id, limit, offset)}


# --- kernels ------------------------------------------------------------
class GenerateReq(BaseModel):
    scaffold: str
    count: int = 200
    name: str = "design_session"
    dataset_id: str = "analogs"


@app.post("/kernel/generate_analogs")
def generate_analogs(req: GenerateReq) -> dict[str, Any]:
    lib = DesignLibrary(name=req.name)
    lib.generate_from_scaffold(req.scaffold, count=req.count)
    lib.rank_and_filter(min_score=0.0)  # keep all; UI sorts/filters
    rows = lib.get_top_compounds(n=req.count)
    flat = [_flatten_compound(r) for r in rows]
    store.upsert_dataset(
        req.dataset_id,
        label=req.name,
        kind="molecules",
        rows=flat,
        meta={"scaffold": req.scaffold},
    )
    return {"dataset_id": req.dataset_id, **lib.summary()}


class ScoreReq(BaseModel):
    smiles: str


@app.post("/kernel/score_molecule")
def score_molecule(req: ScoreReq) -> dict[str, Any]:
    m = Molecule(smiles=req.smiles)
    return {"smiles": req.smiles, "score": m.score, "breakdown": m.score_breakdown}


class DockingBoxReq(BaseModel):
    pdb_id: str
    cx: float
    cy: float
    cz: float
    size: float


@app.get("/lookup")
def lookup(name: str) -> dict[str, Any]:
    """Resolve a compound NAME to its authoritative SMILES via PubChem (so the
    assistant grounds structures in a real database instead of inventing them).
    Returns the canonical RDKit SMILES + formula + PubChem CID."""
    import json as _json
    import urllib.parse
    import urllib.request

    from rdkit import Chem

    q = urllib.parse.quote(name.strip())
    # PubChem renamed the SMILES properties in 2025 (IsomericSMILES/CanonicalSMILES
    # → SMILES/ConnectivitySMILES); request all so we work across versions.
    url = (
        f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{q}"
        "/property/SMILES,ConnectivitySMILES,IsomericSMILES,CanonicalSMILES,MolecularFormula/JSON"
    )
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            data = _json.loads(r.read().decode("utf-8"))
        props = data["PropertyTable"]["Properties"][0]
    except Exception:
        # retry with just the modern property name (older list may 400 on a server)
        try:
            url2 = (
                f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{q}"
                "/property/SMILES,MolecularFormula/JSON"
            )
            with urllib.request.urlopen(url2, timeout=20) as r:
                data = _json.loads(r.read().decode("utf-8"))
            props = data["PropertyTable"]["Properties"][0]
        except Exception as e:
            return {"name": name, "found": False, "error": str(e)}

    smiles = (
        props.get("IsomericSMILES")
        or props.get("SMILES")
        or props.get("CanonicalSMILES")
        or props.get("ConnectivitySMILES")
    )
    # canonicalize through RDKit so it's clean + validated before the UI uses it
    canonical = smiles
    if smiles:
        m = Chem.MolFromSmiles(smiles)
        if m is not None:
            canonical = Chem.MolToSmiles(m)
    return {
        "name": name,
        "found": bool(canonical),
        "smiles": canonical,
        "formula": props.get("MolecularFormula"),
        "cid": props.get("CID"),
        "source": "PubChem",
    }


@app.get("/molecule3d")
def molecule3d(smiles: str) -> Any:
    """Generate a 3D conformer for a SMILES and return an MDL MOL block (with 3D
    coordinates) that the viewer renders as ball-and-stick. RDKit ETKDG embed +
    MMFF optimize — same path the docking kernel uses."""
    from fastapi.responses import PlainTextResponse
    from rdkit import Chem
    from rdkit.Chem import AllChem

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return PlainTextResponse("invalid smiles", status_code=400)
    mol = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = 0xD1
    if AllChem.EmbedMolecule(mol, params) != 0:
        params.useRandomCoords = True
        if AllChem.EmbedMolecule(mol, params) != 0:
            return PlainTextResponse("embed failed", status_code=422)
    try:
        AllChem.MMFFOptimizeMolecule(mol, maxIters=400)
    except Exception:
        pass
    return PlainTextResponse(Chem.MolToMolBlock(mol), media_type="chemical/x-mdl-molfile")


@app.get("/protein/{pdb_id}")
def fetch_protein(pdb_id: str) -> Any:
    """Download a structure from RCSB server-side and return the PDB text.

    The webview is served from a custom scheme (tauri://) in the packaged app, so
    a direct cross-origin fetch to files.rcsb.org is blocked. Proxying through the
    engine (which has plain network access) makes the 3D viewer work in the .app,
    and lets us cache structures for offline reuse.
    """
    import re
    import urllib.request
    from fastapi.responses import PlainTextResponse

    pid = re.sub(r"[^A-Za-z0-9]", "", pdb_id).lower()
    if not pid:
        return PlainTextResponse("invalid pdb id", status_code=400)

    cache_dir = store.path.parent / "pdb_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cached = cache_dir / f"{pid}.pdb"
    if cached.exists():
        return PlainTextResponse(cached.read_text(), media_type="chemical/x-pdb")

    url = f"https://files.rcsb.org/download/{pid}.pdb"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            text = r.read().decode("utf-8", "replace")
    except Exception as e:
        return PlainTextResponse(f"fetch failed: {e}", status_code=502)
    cached.write_text(text)
    return PlainTextResponse(text, media_type="chemical/x-pdb")


@app.post("/kernel/define_docking_box")
def define_docking_box(req: DockingBoxReq) -> dict[str, Any]:
    """Import/record a protein with its docking box into the 'proteins' dataset."""
    existing = {r.get("pdb_id"): r for r in store.get_rows("proteins")}
    existing[req.pdb_id] = {
        "pdb_id": req.pdb_id,
        "status": "box_defined",
        "box_center": [req.cx, req.cy, req.cz],
        "box_size": req.size,
    }
    store.upsert_dataset("proteins", label="Proteins", kind="proteins", rows=list(existing.values()))
    return {"pdb_id": req.pdb_id, "box": [req.cx, req.cy, req.cz, req.size]}


class DockReq(BaseModel):
    dataset_id: str = "analogs"
    pdb_id: str | None = None  # if set, use that protein's saved box
    cx: float | None = None
    cy: float | None = None
    cz: float | None = None
    size: float | None = None
    column: str = "docking_score"
    smiles_field: str = "smiles"


@app.post("/kernel/dock_dataset")
def dock_dataset(req: DockReq) -> dict[str, Any]:
    """Dock every ligand in a dataset against a box and merge the affinities back
    as a live column (criterion: generate analogs → dock → rank). Emits a
    column_added event so the table updates in place."""
    # Resolve the docking box: explicit coords win, else the protein's saved box.
    box = _resolve_box(req)
    if box is None:
        return {"error": "no docking box — define one in the Protein Editor or pass coords"}

    rows = store.get_rows(req.dataset_id)
    if not rows:
        return {"error": f"dataset '{req.dataset_id}' is empty"}

    receptor = None  # a prepared receptor PDBQT path enables the Vina binary path
    values: dict[int, Any] = {}
    method = "rdkit_estimate"
    for i, row in enumerate(rows):
        smi = row.get(req.smiles_field)
        if not smi:
            continue
        result = dock_ligand(smi, box, receptor_pdbqt=receptor)
        if result.get("score") is not None:
            values[i] = result["score"]
            method = result.get("method", method)

    store.add_column(req.dataset_id, req.column, values)
    return {
        "dataset_id": req.dataset_id,
        "column": req.column,
        "docked": len(values),
        "method": method,
        "box": [box.cx, box.cy, box.cz, box.size],
    }


def _resolve_box(req: DockReq) -> DockBox | None:
    if None not in (req.cx, req.cy, req.cz, req.size):
        return DockBox(req.cx, req.cy, req.cz, req.size)  # type: ignore[arg-type]
    if req.pdb_id:
        for r in store.get_rows("proteins"):
            if r.get("pdb_id") == req.pdb_id and r.get("box_center"):
                c = r["box_center"]
                return DockBox(c[0], c[1], c[2], float(r.get("box_size", 20)))
    # fall back to the most recently box-defined protein
    proteins = [r for r in store.get_rows("proteins") if r.get("box_center")]
    if proteins:
        r = proteins[-1]
        c = r["box_center"]
        return DockBox(c[0], c[1], c[2], float(r.get("box_size", 20)))
    return None


def _flatten_compound(c: dict[str, Any]) -> dict[str, Any]:
    """Flatten {smiles, score, properties:{...}} into one wide row for the table."""
    row = {k: v for k, v in c.items() if k != "properties"}
    row.update(c.get("properties", {}))
    return row


# --- event stream -------------------------------------------------------
@app.websocket("/events")
async def events(ws: WebSocket) -> None:
    await ws.accept()
    q = store.bus.subscribe()
    try:
        while True:
            event = await q.get()
            await ws.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        store.bus.unsubscribe(q)


def _watch_parent() -> None:
    """Exit if the launching app (DIMITRI_PARENT_PID) goes away, so we never
    orphan when the desktop app crashes or is force-killed."""
    import os
    import threading
    import time

    ppid_env = os.environ.get("DIMITRI_PARENT_PID")
    if not ppid_env:
        return
    ppid = int(ppid_env)

    def loop() -> None:
        while True:
            time.sleep(2)
            try:
                os.kill(ppid, 0)  # signal 0 = liveness check
            except OSError:
                os._exit(0)

    threading.Thread(target=loop, daemon=True).start()


def main() -> None:
    import uvicorn

    _watch_parent()
    uvicorn.run(app, host="127.0.0.1", port=7842)


if __name__ == "__main__":
    main()
