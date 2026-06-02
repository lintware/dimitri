"""
DesignLibrary — manages a live molecular design campaign.

Supports generation, scoring, filtering, ranking, and export.
This is the central object an agent interacts with during design sessions.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd
from pydantic import Field

from .molecule import Molecule, MoleculeLibrary
from .analogs import generate_analogs_from_scaffold


class DesignLibrary(MoleculeLibrary):
    """
    A design session / campaign.

    Example usage (standalone or from Pi tool):
        lib = DesignLibrary(name="5HT2A_tryptamine_round1")
        lib.generate_from_scaffold("c1ccc2c(c1)c(CCN)cn2", count=800)
        lib.rank_and_filter(top_n=100, min_score=0.65)
        lib.export_csv("round1_top.csv")
    """

    scaffold: str | None = None
    history: list[dict[str, Any]] = Field(default_factory=list)

    def __init__(self, name: str, scaffold: str | None = None, **kwargs: Any) -> None:
        super().__init__(name=name, scaffold=scaffold, **kwargs)

    def generate_from_scaffold(
        self,
        scaffold_smiles: str,
        count: int = 400,
        **gen_kwargs: Any,
    ) -> int:
        """Generate and add real analogs. Returns number added."""
        self.scaffold = scaffold_smiles
        analogs = generate_analogs_from_scaffold(scaffold_smiles, count=count, **gen_kwargs)

        added = 0
        for mol in analogs:
            if not any(c.smiles == mol.smiles for c in self.compounds):
                self.compounds.append(mol)
                added += 1

        self.history.append(
            {"action": "generate", "scaffold": scaffold_smiles, "requested": count, "added": added}
        )
        return added

    def rank_and_filter(
        self,
        min_score: float = 0.55,
        max_mw: float = 480,
        top_n: int | None = None,
    ) -> None:
        """In-place filter + sort by the designer score."""
        before = len(self.compounds)

        filtered = [
            m
            for m in self.compounds
            if m.score >= min_score and m.mw <= max_mw and m.is_valid
        ]
        filtered.sort(key=lambda m: m.score, reverse=True)

        if top_n is not None:
            filtered = filtered[:top_n]

        self.compounds = filtered
        self.history.append(
            {
                "action": "rank_filter",
                "before": before,
                "after": len(self.compounds),
                "min_score": min_score,
            }
        )

    def get_top_compounds(self, n: int = 30) -> list[dict[str, Any]]:
        return [c.to_dict() for c in self.top_n(n)]

    def summary(self) -> dict[str, Any]:
        if not self.compounds:
            return {"name": self.name, "count": 0}

        scores = [c.score for c in self.compounds]
        return {
            "name": self.name,
            "count": len(self.compounds),
            "scaffold": self.scaffold,
            "score_range": [round(min(scores), 3), round(max(scores), 3)],
            "mean_score": round(sum(scores) / len(scores), 3),
            "top_5_smiles": [c.smiles for c in self.top_n(5)],
        }

    def to_json(self, path: str | Path) -> None:
        data = {
            "name": self.name,
            "scaffold": self.scaffold,
            "compounds": [c.to_dict() for c in self.compounds],
            "history": self.history,
        }
        Path(path).write_text(json.dumps(data, indent=2))

    @classmethod
    def from_json(cls, path: str | Path) -> "DesignLibrary":
        data = json.loads(Path(path).read_text())
        lib = cls(name=data["name"], scaffold=data.get("scaffold"))
        for rec in data.get("compounds", []):
            lib.add(rec["smiles"], name=rec.get("name"), source=rec.get("source", "loaded"))
        lib.history = data.get("history", [])
        return lib
