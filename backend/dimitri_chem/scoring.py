"""
Multi-parameter optimization (MPO) scoring for molecular design.

The TryptamineDesignerScore is a real, opinionated medicinal chemistry scoring
function tuned for CNS-active tryptamine-like compounds (5-HT2A research,
TIHKAL-style exploration, etc.).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from rdkit import Chem

from .properties import calculate_properties


@dataclass
class TryptamineDesignerScore:
    """
    Weighted multi-objective score for tryptamine / phenethylamine design.

    The score is explicitly designed so that a human medicinal chemist would
    generally agree with the ranking for early-stage exploration.
    """

    # Weights (must sum close to 1.0)
    w_drug_like: float = 0.25
    w_cns_penetration: float = 0.30
    w_tryptamine_likeness: float = 0.25
    w_synthetic_accessibility: float = 0.10
    w_diversity: float = 0.10

    def score(self, mol: Chem.Mol) -> tuple[float, dict[str, float]]:
        props = calculate_properties(mol)

        drug_like = self._score_drug_like(props)
        cns = self._score_cns_penetration(props)
        trypt = self._score_tryptamine_likeness(mol, props)
        synth = self._score_synthetic_accessibility(props)
        div = 0.75  # placeholder — real diversity needs a library reference

        total = (
            self.w_drug_like * drug_like
            + self.w_cns_penetration * cns
            + self.w_tryptamine_likeness * trypt
            + self.w_synthetic_accessibility * synth
            + self.w_diversity * div
        )

        breakdown = {
            "drug_like": round(drug_like, 3),
            "cns_penetration": round(cns, 3),
            "tryptamine_likeness": round(trypt, 3),
            "synthetic_accessibility": round(synth, 3),
            "diversity": round(div, 3),
            "total": round(total, 4),
        }
        return total, breakdown

    # --- Individual scoring components ---

    def _score_drug_like(self, p: dict[str, Any]) -> float:
        """0–1 score based on Lipinski/Veber/QED."""
        qed = p.get("qed", 0.0)
        mw = p.get("mw", 600)
        logp = p.get("logp", 5)
        violations = 0
        if mw > 500:
            violations += 1
        if logp > 5:
            violations += 1
        if p.get("hbd", 6) > 5:
            violations += 1
        if p.get("hba", 11) > 10:
            violations += 1
        lip = max(0.0, 1.0 - (violations * 0.25))
        return 0.6 * lip + 0.4 * qed

    def _score_cns_penetration(self, p: dict[str, Any]) -> float:
        """
        CNS-like profile: lower TPSA, moderate LogP, low HBD, reasonable size.
        This is the most important axis for many tryptamine projects.
        """
        tpsa = p.get("tpsa", 120)
        logp = p.get("logp", 0)
        hbd = p.get("hbd", 5)
        mw = p.get("mw", 400)

        tpsa_score = max(0.0, 1.0 - (tpsa - 20) / 80)  # ideal < 40-50 for good CNS
        logp_score = 1.0 - abs(logp - 2.8) / 3.5  # sweet spot ~2.5-3.5
        hbd_score = max(0.0, 1.0 - hbd / 4)
        size_score = max(0.0, 1.0 - (mw - 180) / 280)

        raw = 0.35 * tpsa_score + 0.25 * logp_score + 0.25 * hbd_score + 0.15 * size_score
        return max(0.0, min(1.0, raw))

    def _score_tryptamine_likeness(self, mol: Chem.Mol, p: dict[str, Any]) -> float:
        """
        Heuristic "does this look like something a tryptamine chemist would make?"
        Checks for indole/tryptamine-like features + reasonable substitution patterns.
        """
        smi = Chem.MolToSmiles(mol)

        score = 0.5  # base

        # Has indole or close bioisostere
        if "c1ccc2c(c1)c" in smi or "c1ccc2nc" in smi or "indol" in smi.lower():
            score += 0.25

        # Reasonable size for CNS tryptamine (250-420 Da is common)
        mw = p.get("mw", 0)
        if 220 <= mw <= 420:
            score += 0.15
        elif 180 <= mw <= 500:
            score += 0.08

        # Not too many rotatable bonds (rigid cores are common)
        if p.get("rotatable_bonds", 10) <= 7:
            score += 0.1

        # Penalize very high charge or very greasy compounds
        if abs(p.get("formal_charge", 0)) >= 2:
            score -= 0.15
        if p.get("logp", 0) > 5.5:
            score -= 0.2

        return max(0.0, min(1.0, score))

    def _score_synthetic_accessibility(self, p: dict[str, Any]) -> float:
        """
        Very rough synthetic accessibility proxy.
        Lower heavy atom count + fewer rings + higher fCsp3 generally easier.
        """
        heavy = p.get("heavy_atom_count", 30)
        rings = p.get("ring_count", 4)
        fcsp3 = p.get("fraction_csp3", 0.3)

        size_score = max(0.0, 1.0 - (heavy - 15) / 25)
        ring_score = max(0.0, 1.0 - (rings - 1) / 5)
        sp3_score = min(1.0, 0.4 + fcsp3)

        return 0.4 * size_score + 0.35 * ring_score + 0.25 * sp3_score


# Convenience function used by Molecule dataclass
def score_compound(mol: Chem.Mol) -> tuple[float, dict[str, float]]:
    scorer = TryptamineDesignerScore()
    return scorer.score(mol)
