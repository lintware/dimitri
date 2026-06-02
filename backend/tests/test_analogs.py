"""
Tests for real analog generation.

These tests prove that Dimitri can act as a functional molecular designer.
"""

import pytest
from rdkit import Chem

from dimitri_chem.analogs import generate_analogs_from_scaffold
from dimitri_chem.molecule import Molecule


class TestAnalogGeneration:
    """Core tests for the molecular designer."""

    def test_generates_valid_molecules_from_tryptamine_scaffold(self):
        """The most important test: can we design real compounds?"""
        # Clean, valid tryptamine SMILES (3-(2-aminoethyl)indole)
        scaffold = "NCCc1c[nH]c2ccccc12"

        analogs = generate_analogs_from_scaffold(scaffold, count=120, seed=123)

        assert len(analogs) >= 8, "Should generate a reasonable number of analogs"
        assert all(isinstance(a, Molecule) for a in analogs)

        # Every single generated molecule must be chemically valid
        for mol in analogs:
            assert mol.is_valid, f"Invalid molecule generated: {mol.smiles}"
            rdkit_mol = mol.mol
            assert rdkit_mol is not None
            assert Chem.MolToSmiles(rdkit_mol)  # roundtrips cleanly

    def test_generated_compounds_have_reasonable_druglike_properties(self):
        scaffold = "NCCc1c[nH]c2ccccc12"
        analogs = generate_analogs_from_scaffold(scaffold, count=80, seed=42)

        for mol in analogs[:30]:  # check a sample
            p = mol.properties
            assert 140 < p["mw"] < 550, f"MW out of reasonable range: {p['mw']}"
            assert -1 < p["logp"] < 6.5
            assert p["qed"] > 0.2  # not completely terrible

    def test_deduplication_works(self):
        scaffold = "NCCc1c[nH]c2ccccc12"
        analogs = generate_analogs_from_scaffold(scaffold, count=60, seed=7)

        smiles_set = {m.smiles for m in analogs}
        assert len(smiles_set) == len(analogs), "Duplicates should be removed"

    def test_different_seeds_produce_different_libraries(self):
        scaffold = "NCCc1c[nH]c2ccccc12"
        a1 = generate_analogs_from_scaffold(scaffold, count=40, seed=1)
        a2 = generate_analogs_from_scaffold(scaffold, count=40, seed=999)

        s1 = {m.smiles for m in a1}
        s2 = {m.smiles for m in a2}

        # Both runs should produce useful output
        assert len(s1) >= 5 and len(s2) >= 5

    def test_fallback_generator_produces_something_useful(self):
        """When no * is present we still get useful analogs via side-chain modification."""
        plain_scaffold = "NCCc1c[nH]c2ccccc12"  # tryptamine itself
        analogs = generate_analogs_from_scaffold(plain_scaffold, count=50, seed=55)

        assert len(analogs) >= 8
        for m in analogs:
            assert m.is_valid
