"""
Molecular property calculation and drug-likeness filters.

All calculations use real RDKit descriptors.
"""

from __future__ import annotations

from typing import Any

from rdkit import Chem
from rdkit.Chem import Descriptors, Lipinski, QED, rdMolDescriptors


def calculate_properties(mol: Chem.Mol) -> dict[str, Any]:
    """Return a rich set of drug-relevant descriptors."""
    if mol is None:
        return {}

    return {
        "mw": round(Descriptors.MolWt(mol), 2),
        "logp": round(Descriptors.MolLogP(mol), 3),
        "tpsa": round(Descriptors.TPSA(mol), 1),
        "hbd": Lipinski.NumHDonors(mol),
        "hba": Lipinski.NumHAcceptors(mol),
        "rotatable_bonds": Lipinski.NumRotatableBonds(mol),
        "qed": round(QED.qed(mol), 4),
        "heavy_atom_count": mol.GetNumHeavyAtoms(),
        "ring_count": rdMolDescriptors.CalcNumRings(mol),
        "aromatic_rings": rdMolDescriptors.CalcNumAromaticRings(mol),
        "fraction_csp3": round(Descriptors.FractionCSP3(mol), 3),
        "formal_charge": Chem.rdmolops.GetFormalCharge(mol),
    }


def is_drug_like(mol: Chem.Mol, strict: bool = False) -> bool:
    """
    Lipinski + Veber rules with optional stricter CNS-like constraints.
    Returns True if the molecule passes the filter.
    """
    if mol is None:
        return False

    props = calculate_properties(mol)
    mw = props["mw"]
    logp = props["logp"]
    hbd = props["hbd"]
    hba = props["hba"]
    tpsa = props["tpsa"]
    rot = props["rotatable_bonds"]

    lipinski = mw <= 500 and logp <= 5 and hbd <= 5 and hba <= 10
    veber = tpsa <= 140 and rot <= 10

    if not strict:
        return lipinski and veber

    # Stricter CNS / tryptamine-like profile (common target for this harness)
    cns_like = (
        mw <= 400
        and 1.5 <= logp <= 4.0
        and hbd <= 3
        and tpsa <= 70
        and rot <= 6
    )
    return lipinski and veber and cns_like


def has_pains_alerts(mol: Chem.Mol) -> bool:
    """
    Very lightweight PAINS-like check using common problematic substructures.
    Not a full PAINS filter (that requires the full set of SMARTS).
    """
    pains_smarts = [
        "c1ccc2c(c1)oc(=O)c(O)c2",  # coumarin-like
        "C=C(C)C(=O)O",             # certain acrylates
        "c1cc(Br)c(O)c(Br)c1",      # polyhalogenated phenols
        "S(=O)(=O)N",               # sulfonamides can be ok, but flag some
    ]
    for smarts in pains_smarts:
        patt = Chem.MolFromSmarts(smarts)
        if patt and mol.HasSubstructMatch(patt):
            return True
    return False
