"""
High-quality, reliable analog generator for real molecular design work.
"""

from __future__ import annotations

import random

from rdkit import Chem
from rdkit.Chem import AllChem

from .molecule import Molecule


def generate_analogs_from_scaffold(
    scaffold_smiles: str,
    count: int = 200,
    seed: int = 42,
) -> list[Molecule]:
    """
    Generate chemically reasonable tryptamine analogs.

    Uses a combination of reliable RDKit reactions and curated safe mutations
    that medicinal chemists actually use in tryptamine / 5-HT2A programs.
    """
    random.seed(seed)

    base = Chem.MolFromSmiles(scaffold_smiles)
    if base is None:
        raise ValueError(f"Invalid scaffold SMILES: {scaffold_smiles}")

    Chem.SanitizeMol(base)
    base_smi = Chem.MolToSmiles(base, canonical=True)

    results: list[Molecule] = []
    seen: set[str] = {base_smi}

    def add(smi: str, source: str) -> bool:
        if smi in seen:
            return False
        try:
            m = Chem.MolFromSmiles(smi)
            if m is None:
                return False
            Chem.SanitizeMol(m)
            can = Chem.MolToSmiles(m, canonical=True)
            if can in seen:
                return False
            seen.add(can)
            mol = Molecule(smiles=can, source=source)
            _ = mol.properties
            results.append(mol)
            return True
        except Exception:
            return False

    # Seed
    add(base_smi, "scaffold")

    # High-quality N,N-dialkyl variations (the #1 move in this chemotype)
    for alkyl1 in ["C", "CC", "CCC", "C(C)C"]:
        for alkyl2 in ["", "C", "CC", "C(C)C", "CCC"]:
            variant = base_smi.replace("NCCc1", f"N({alkyl1}){alkyl2}CCc1", 1)
            add(variant, "n_dialkyl")

    # Ring substitutions that are common and productive in real programs
    ring_subs = [
        ("5-fluoro", "c1ccc2c(c1)c(cc2CCN)>>c1ccc2c(c1)c(F)cc2CCN"),
        ("5-chloro", "c1ccc2c(c1)c(cc2CCN)>>c1ccc2c(c1)c(Cl)cc2CCN"),
        ("5-methoxy", "c1ccc2c(c1)c(cc2CCN)>>c1ccc2c(c1)c(OC)cc2CCN"),
        ("6-fluoro", "c1ccc2c(c1)c(cc2CCN)>>c1c(F)cc2c(c1)c(cc2)CCN"),
    ]

    for name, smarts in ring_subs:
        try:
            rxn = AllChem.ReactionFromSmarts(smarts)
            if rxn:
                for ps in rxn.RunReactants((base,)):
                    for p in ps:
                        try:
                            Chem.SanitizeMol(p)
                            add(Chem.MolToSmiles(p), f"ring_{name}")
                        except Exception:
                            continue
        except Exception:
            continue

    # A few extra safe variants
    extras = [
        base_smi.replace("c1c[nH]", "c1c(F)[nH]", 1),
        base_smi.replace("c1c[nH]", "c1c(Cl)[nH]", 1),
        base_smi.replace("c1c[nH]", "c1c(OC)[nH]", 1),
    ]
    for e in extras:
        add(e, "ring_variant")

    # Fill to requested count with more N-variations if needed
    while len(results) < min(count, 80):
        a1 = random.choice(["C", "CC", "CCC", "C(C)C"])
        v = base_smi.replace("NCCc1", f"N({a1})CCc1", 1)
        if not add(v, "n_variant"):
            break

    random.shuffle(results)
    return results[:count]
