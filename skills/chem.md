# chem

Main chemistry skill for Dimitri.

## Description

Provides natural language access to the full chemistry harness: molecule manipulation, docking, ADMET, analog generation, PDB handling, and more.

## Usage Examples

- Generate analogs: "generate 1600 tryptamine analogs from MET scaffold and optimize for 5-HT2A"
- Docking: "dock this SMILES to PDB 7WC5 using DiffDock"
- ADMET: "run ADMET on this library"
- Full workflow: "generate analogs, dock them, rank by potency and ADMET"

## Tools Exposed

- generate_analogs
- run_docking
- calculate_admet
- search_pdb
- enrich_dataset
- get_element_properties

## Notes

All heavy computation happens in the local Python backend (conda environment).