"""
Tests for DesignLibrary behavior and integration.
"""

import tempfile
from pathlib import Path

from dimitri_chem.library import DesignLibrary
from dimitri_chem.molecule import Molecule


def test_library_generate_rank_filter_roundtrip():
    lib = DesignLibrary(name="test_round")

    added = lib.generate_from_scaffold("NCCc1c[nH]c2ccccc12", count=60)
    assert added >= 8

    before = len(lib.compounds)
    lib.rank_and_filter(min_score=0.48, top_n=30)

    assert len(lib.compounds) <= before
    assert len(lib.compounds) <= 30

    # Must be sorted descending by score
    scores = [c.score for c in lib.compounds]
    assert scores == sorted(scores, reverse=True)

    # Top compound must be reasonably good
    assert lib.compounds[0].score >= 0.48


def test_library_export_and_reload():
    lib = DesignLibrary(name="export_test")
    lib.generate_from_scaffold("NCCc1c[nH]c2ccccc12", count=25)
    lib.rank_and_filter(min_score=0.4)

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "lib.json"
        lib.to_json(path)

        reloaded = DesignLibrary.from_json(path)
        assert len(reloaded.compounds) == len(lib.compounds)
        assert reloaded.name == lib.name
        assert reloaded.scaffold == lib.scaffold


def test_molecule_computed_properties_are_real():
    """Sanity check that we're using real RDKit, not fake numbers."""
    mol = Molecule(smiles="CN(C)CCc1c[nH]c2ccccc12")  # DMT

    p = mol.properties
    assert p["mw"] > 180
    assert 1.5 < p["logp"] < 3.5
    assert p["tpsa"] < 25  # tryptamines have low TPSA
    assert p["qed"] > 0.6
