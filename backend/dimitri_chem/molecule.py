"""
Core molecule data models for Dimitri Chemistry Engine.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr
from rdkit import Chem


class Molecule(BaseModel):
    """A single designed molecule with computed properties and scores."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    smiles: str
    name: str | None = None
    source: str = "generated"

    # Private cached objects (never serialized, never validated by Pydantic)
    _mol: Chem.Mol | None = PrivateAttr(default=None)
    _properties: dict[str, Any] | None = PrivateAttr(default=None)
    _score: float | None = PrivateAttr(default=None)
    _score_breakdown: dict[str, float] | None = PrivateAttr(default=None)

    def model_post_init(self, __context: Any) -> None:
        if not self.smiles or not isinstance(self.smiles, str):
            raise ValueError("SMILES must be a non-empty string")

    @property
    def mol(self) -> Chem.Mol:
        if self._mol is None:
            self._mol = Chem.MolFromSmiles(self.smiles)
            if self._mol is None:
                raise ValueError(f"Invalid SMILES: {self.smiles}")
        return self._mol

    @property
    def is_valid(self) -> bool:
        try:
            return self.mol is not None
        except Exception:
            return False

    @property
    def properties(self) -> dict[str, Any]:
        if self._properties is None:
            from .properties import calculate_properties

            self._properties = calculate_properties(self.mol)
        return self._properties

    @property
    def score(self) -> float:
        if self._score is None:
            from .scoring import score_compound

            self._score, self._score_breakdown = score_compound(self.mol)
        return self._score

    @property
    def score_breakdown(self) -> dict[str, float]:
        if self._score_breakdown is None:
            _ = self.score  # triggers computation
        return self._score_breakdown or {}

    @property
    def mw(self) -> float:
        return self.properties.get("mw", 0.0)

    @property
    def logp(self) -> float:
        return self.properties.get("logp", 0.0)

    def to_dict(self) -> dict[str, Any]:
        return {
            "smiles": self.smiles,
            "name": self.name,
            "source": self.source,
            "properties": self.properties,
            "score": round(self.score, 4),
            "score_breakdown": {k: round(v, 4) for k, v in self.score_breakdown.items()},
        }

    def __repr__(self) -> str:
        return f"Molecule(smiles={self.smiles!r}, score={self.score:.3f})"


class MoleculeLibrary(BaseModel):
    """A collection of molecules for a design campaign."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    name: str
    compounds: list[Molecule] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

    def add(self, mol: Molecule | str, **kwargs: Any) -> Molecule:
        if isinstance(mol, str):
            mol = Molecule(smiles=mol, **kwargs)
        self.compounds.append(mol)
        return mol

    def sort_by_score(self, descending: bool = True) -> list[Molecule]:
        return sorted(self.compounds, key=lambda m: m.score, reverse=descending)

    def top_n(self, n: int = 50) -> list[Molecule]:
        return self.sort_by_score()[:n]

    def filter_by(self, predicate: Any) -> "MoleculeLibrary":
        filtered = [m for m in self.compounds if predicate(m)]
        return MoleculeLibrary(name=f"{self.name}_filtered", compounds=filtered, metadata=self.metadata)

    def to_dataframe(self) -> Any:
        import pandas as pd

        records = [c.to_dict() for c in self.compounds]
        return pd.DataFrame(records)

    def export_csv(self, path: str) -> None:
        self.to_dataframe().to_csv(path, index=False)

    def __len__(self) -> int:
        return len(self.compounds)

    def __repr__(self) -> str:
        return f"MoleculeLibrary(name={self.name!r}, n={len(self)}, top_score={max((c.score for c in self.compounds), default=0):.3f})"
