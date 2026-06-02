"""
Dimitri Chemistry Engine
Real molecular design harness powered by RDKit.

Enables agentic, iterative design of chemical compounds with:
- Scaffold-based analog generation (R-group enumeration)
- Multi-parameter optimization (MPO) scoring
- Drug-likeness filtering
- Library management and ranking
"""

__version__ = "0.2.0"

from .molecule import Molecule, MoleculeLibrary
from .analogs import generate_analogs_from_scaffold
from .properties import calculate_properties, is_drug_like
from .scoring import score_compound, TryptamineDesignerScore
from .library import DesignLibrary

__all__ = [
    "Molecule",
    "MoleculeLibrary",
    "generate_analogs_from_scaffold",
    "calculate_properties",
    "is_drug_like",
    "score_compound",
    "TryptamineDesignerScore",
    "DesignLibrary",
]
