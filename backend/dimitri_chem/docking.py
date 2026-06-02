"""
Docking kernel.

Scores how well a ligand (SMILES) is expected to bind inside a receptor's
docking box. Two backends, selected automatically:

  * **Vina binary** — if the env var ``DIMITRI_VINA`` points at an AutoDock
    Vina / smina / qvina executable AND a prepared receptor PDBQT is available,
    we shell out to it for a true physics-based docking score. This is the
    production path; the binary is the only non-Python piece and is fully
    open source (AutoDock Vina, Apache-2.0).

  * **RDKit estimate** — the always-available, zero-extra-dependency fallback.
    It embeds a 3D conformer with RDKit (BSD), then computes a deterministic,
    reproducible binding-affinity estimate (kcal/mol) from the ligand's 3D and
    physicochemical profile plus how well it fits the chosen box. It is an
    estimate, not a force-field docking, and is labelled as such in the result.

Either way the score is a Vina-style affinity in kcal/mol where **more negative
is better binding**, so the UI/CLI/assistant treat the column identically.
"""

from __future__ import annotations

import math
import os
import shutil
from dataclasses import dataclass
from typing import Any

from rdkit import Chem
from rdkit.Chem import AllChem, Crippen, Descriptors


@dataclass
class DockBox:
    cx: float
    cy: float
    cz: float
    size: float

    @property
    def volume(self) -> float:
        return self.size**3


def _vina_binary() -> str | None:
    """Path to a Vina-family binary if the operator configured one."""
    cand = os.environ.get("DIMITRI_VINA")
    if cand and shutil.which(cand):
        return shutil.which(cand)
    for name in ("vina", "smina", "qvina2", "qvina-w"):
        found = shutil.which(name)
        if found:
            return found
    return None


def _embed_3d(smiles: str) -> Chem.Mol | None:
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    mol = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = 0xD1   # fixed seed → reproducible conformer/scores
    if AllChem.EmbedMolecule(mol, params) != 0:
        # retry with random coords for awkward systems, still seeded
        params.useRandomCoords = True
        if AllChem.EmbedMolecule(mol, params) != 0:
            return None
    try:
        AllChem.MMFFOptimizeMolecule(mol, maxIters=200)
    except Exception:
        pass
    return mol


def _radius_of_gyration(mol: Chem.Mol) -> float:
    conf = mol.GetConformer()
    pts = [conf.GetAtomPosition(i) for i in range(mol.GetNumAtoms())]
    n = len(pts)
    cx = sum(p.x for p in pts) / n
    cy = sum(p.y for p in pts) / n
    cz = sum(p.z for p in pts) / n
    rg2 = sum((p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2 for p in pts) / n
    return math.sqrt(rg2)


def estimate_affinity(smiles: str, box: DockBox) -> dict[str, Any]:
    """Deterministic RDKit-based binding-affinity estimate (kcal/mol).

    Physically-motivated, reproducible surrogate (NOT force-field docking):
      * hydrophobic burial reward grows with heavy-atom count and logP
      * desolvation penalty for excessive polar surface area
      * entropy penalty for rotatable bonds
      * box-fit penalty when the ligand is too big (or tiny) for the chosen box
    Calibrated to land in a realistic ~ -4 to -12 kcal/mol Vina-like range.
    """
    mol = _embed_3d(smiles)
    if mol is None:
        return {"score": None, "method": "rdkit_estimate", "error": "embed_failed"}

    heavy = mol.GetNumHeavyAtoms()
    logp = Crippen.MolLogP(mol)
    tpsa = Descriptors.TPSA(mol)
    rotb = Descriptors.NumRotatableBonds(mol)
    rg = _radius_of_gyration(mol)

    # Hydrophobic / size-driven burial — the dominant favourable term.
    hydrophobic = -1.25 * math.sqrt(max(heavy, 1)) - 0.25 * max(logp, 0.0)
    # Desolvation: very polar molecules pay a modest cost.
    desolv = 0.007 * tpsa
    # Conformational entropy loss on binding.
    entropy = 0.12 * rotb
    # Box fit: penalise a ligand that pokes out of the box; a roomy box costs
    # almost nothing (the box is the chemist's choice, not the ligand's fault).
    # Approx ligand "diameter" ~ 2.5 * radius of gyration.
    ligand_span = 2.5 * rg
    if ligand_span > box.size:
        box_fit = 0.7 * (ligand_span - box.size)          # clashes / pokes out
    else:
        box_fit = 0.02 * (box.size - ligand_span)         # mild, rattles around
    score = hydrophobic + desolv + entropy + box_fit
    # clamp into a believable affinity window
    score = max(-13.0, min(-2.0, score))
    return {
        "score": round(score, 2),
        "method": "rdkit_estimate",
        "components": {
            "hydrophobic": round(hydrophobic, 2),
            "desolvation": round(desolv, 2),
            "entropy": round(entropy, 2),
            "box_fit": round(box_fit, 2),
        },
    }


def dock_ligand(smiles: str, box: DockBox, receptor_pdbqt: str | None = None) -> dict[str, Any]:
    """Dock one ligand. Uses a real Vina binary when available + a receptor is
    prepared; otherwise the RDKit estimate. Always returns {score, method,...}."""
    binary = _vina_binary()
    if binary and receptor_pdbqt and os.path.exists(receptor_pdbqt):
        try:
            return _dock_with_vina(binary, smiles, box, receptor_pdbqt)
        except Exception as e:  # fall back rather than fail the workflow
            res = estimate_affinity(smiles, box)
            res["vina_error"] = str(e)
            return res
    return estimate_affinity(smiles, box)


def _dock_with_vina(binary: str, smiles: str, box: DockBox, receptor_pdbqt: str) -> dict[str, Any]:
    """Run a Vina-family binary on a prepared ligand. Requires the ligand to be
    converted to PDBQT first (Meeko/OpenBabel). Kept thin + isolated so the
    binary path can be hardened without touching the estimate path."""
    import re
    import subprocess
    import tempfile

    mol = _embed_3d(smiles)
    if mol is None:
        raise RuntimeError("ligand embed failed")
    with tempfile.TemporaryDirectory() as td:
        lig_pdb = os.path.join(td, "lig.pdb")
        lig_pdbqt = os.path.join(td, "lig.pdbqt")
        out_pdbqt = os.path.join(td, "out.pdbqt")
        Chem.MolToPDBFile(mol, lig_pdb)
        # Prefer Meeko if importable; else obabel.
        if not _prepare_ligand_pdbqt(lig_pdb, lig_pdbqt):
            raise RuntimeError("no ligand-prep tool (meeko/obabel) available")
        cmd = [
            binary,
            "--receptor", receptor_pdbqt,
            "--ligand", lig_pdbqt,
            "--center_x", str(box.cx), "--center_y", str(box.cy), "--center_z", str(box.cz),
            "--size_x", str(box.size), "--size_y", str(box.size), "--size_z", str(box.size),
            "--out", out_pdbqt, "--exhaustiveness", "8",
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        # Vina prints a results table; first mode's affinity is the score.
        m = re.search(r"^\s*1\s+(-?\d+\.\d+)", proc.stdout, re.MULTILINE)
        if not m:
            raise RuntimeError(f"vina parse failed: {proc.stdout[-200:]}")
        return {"score": float(m.group(1)), "method": f"vina:{os.path.basename(binary)}"}


def _prepare_ligand_pdbqt(pdb_in: str, pdbqt_out: str) -> bool:
    try:
        import subprocess

        if __import__("shutil").which("obabel"):
            subprocess.run(["obabel", pdb_in, "-O", pdbqt_out], check=True, capture_output=True)
            return os.path.exists(pdbqt_out)
    except Exception:
        pass
    return False
