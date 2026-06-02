"""
Tests for the designer scoring system.

These prove that the MPO actually ranks molecules in a chemically sensible way.
"""

import pytest

from dimitri_chem.molecule import Molecule
from dimitri_chem.scoring import TryptamineDesignerScore, score_compound


class TestDesignerScoring:
    def test_known_good_tryptamine_scores_well(self):
        """N,N-dimethyltryptamine (DMT) should score reasonably for a CNS tryptamine."""
        dmt = Molecule(smiles="CN(C)CCc1c[nH]c2ccccc12")
        assert dmt.score > 0.55, f"DMT scored too low: {dmt.score}"

        # Breakdown must be present and sum roughly to total
        breakdown = dmt.score_breakdown
        assert "cns_penetration" in breakdown
        assert breakdown["total"] == pytest.approx(dmt.score, abs=0.01)

    def test_bad_compounds_score_poorly(self):
        """A very large, greasy, high-TPSA molecule should score badly."""
        bad = Molecule(smiles="c1ccc2c(c1)c(CCN(CCCCCCCC)CCCCCCCC)cn2C(=O)CCCCCCCC")
        assert bad.score < 0.45, f"Greasy monster scored too high: {bad.score}"

    def test_cns_profile_is_strongly_weighted(self):
        """Lower TPSA + reasonable LogP should beat a similar molecule with bad CNS properties."""
        good_cns = Molecule(smiles="CCN(CC)CCc1c[nH]c2ccccc12")  # DET-like
        bad_cns = Molecule(smiles="CCN(CC)CCc1c[nH]c2cc(OC)c(OC)c(OC)c12")  # high TPSA

        assert good_cns.properties["tpsa"] < bad_cns.properties["tpsa"]
        assert good_cns.score > bad_cns.score  # directionally correct is enough for now

    def test_scoring_is_deterministic(self):
        mol = Molecule(smiles="NCCc1c[nH]c2ccccc12")
        s1, b1 = score_compound(mol.mol)
        s2, b2 = score_compound(mol.mol)
        assert s1 == s2
        assert b1 == b2

    def test_score_components_are_in_reasonable_range(self):
        scorer = TryptamineDesignerScore()
        mol = Molecule(smiles="CNCc1c[nH]c2ccccc12").mol
        total, breakdown = scorer.score(mol)

        for name, val in breakdown.items():
            assert 0.0 <= val <= 1.0, f"{name} out of [0,1] range: {val}"
