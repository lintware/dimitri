# Dimitri 🧬

**Open-source Pi Agent Chemistry Harness**

Turn Pi into a powerful, local AI chemistry workbench.

Named after Dmitri Mendeleev.

## What is Dimitri?

Dimitri is a Pi Package that gives you a full chemistry harness through natural language.

It handles:
- Molecule manipulation (RDKit)
- Molecular docking (Vina, DiffDock, UniDock)
- ADMET prediction
- Analog generation
- PDB search & protein handling
- Dataset enrichment

All running locally with your own Python backend.

## Quick Start

```bash
pi install dimitri
```

Then just use it:

```bash
/chem generate 1600 tryptamine analogs from MET scaffold
/chem dock this SMILES to 7WC5 using DiffDock
/chem run ADMET on this library
```

## Documentation

Full specification, features, user flows, and technical details are in [SPEC.md](./SPEC.md).

## Project Structure

```
dimitri/
├── SPEC.md
├── package.json
├── skills/chem.md
├── extensions/chemistry.ts
├── provision/setup.sh
└── backend/
```

## Contributing

Pull requests welcome. Especially new skills and analysis modules.

## License

MIT
