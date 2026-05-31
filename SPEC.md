# Dimitri Chemistry Harness - Complete Specification

**Project**: Dimitri  
**Version**: 0.1.0 (MVP)  
**Type**: Pi Agent Package  
**License**: MIT  
**Organization**: lintware  
**Repo**: https://github.com/lintware/dimitri

---

## 1. Vision & Goals

**Dimitri** is an open-source **Pi Agent Package** that turns Pi into a full-featured **AI Chemistry Harness**, delivering feature parity with the Entropy Labs "Chemistry" demo (YouTube: https://m.youtube.com/watch?v=3RaKdn519H4).

### Core Goals
- One unified, natural-language-driven environment for molecular science
- 100% local execution (Python chemistry backend + Pi agent)
- One-command install + auto-provisioning
- Agentic multi-step workflows (Claude + tool calling)
- TUI-first with optional WebUI path
- Fully extensible and self-improving

Named after **Dmitri Mendeleev** (creator of the periodic table).

---

## 2. Full Feature List (from original demo + extensions)

### 2.1 Chemistry Engine (Python Backend)
- **Core libraries**: RDKit, OpenBabel, DeepChem
- **Modular analysis kernels** with clean APIs
- **Docking**:
  - AutoDock Vina (CPU)
  - DiffDock (AI-based pose prediction)
  - UniDock (GPU-accelerated)
  - Custom binding box definition + visual feedback
- **ADMET Analysis**: Full absorption, distribution, metabolism, excretion, toxicity
- **Analog Generation**: Scaffold-based R-group exploration (e.g. 1,600 tryptamine analogs)
- **Protein handling**: PDB import, basic editing/viewing
- **Molecular Dynamics** (planned)
- **Retrosynthesis** (planned)
- **Parameter space visualization**

### 2.2 Data & Dataset Features
- Easy import of real datasets (e.g. TIHKAL tryptamines)
- AI enrichment: predicted affinities, ADMET, custom scores ("Shulgin Index")
- Live-linked data tables for libraries/results/rankings

### 2.3 External Integrations
- **PDB search & import** (by name or ligand)
- Database-backed storage for large-scale campaigns

### 2.4 Pi Agent Integration (the "Harness")
- Natural language tool calling
- Agentic workflows example: "Generate analogs from MET scaffold → dock to 7WC5 → rank by 5-HT2A + ADMET"
- Step-by-step reasoning transparency
- Custom skills for every chemistry operation
- Self-documenting & self-extensible

### 2.5 Provisioning & Usability
- `pi install dimitri`
- **Auto-provisioning** (idempotent):
  - Detect/install Miniconda if missing
  - Create dedicated `dimitri` conda environment
  - Install RDKit + OpenBabel + DeepChem + vina + PyTorch + DiffDock + models
  - Register all tools/skills
- First run: 5–15 min (one-time downloads)
- Subsequent use: instant

---

## 3. Target User Flow

1. User has Pi installed + Claude access
2. `pi install dimitri`
3. First use triggers auto-provisioning
4. User types natural language commands:
   - `/chem generate 1600 tryptamine analogs from MET scaffold`
   - `/chem dock this SMILES to PDB 7WC5 using DiffDock`
   - `/chem enrich library with ADMET + 5-HT2A scores`
5. Dimitri reasons, calls tools, returns results + explanations
6. Optional: Launch lightweight WebUI for molecule drawing / 3D viewing

---

## 4. Technical Requirements

### 4.1 Pi Side
- Pi Agent compatible (skills + extensions)
- TypeScript for extensions
- Markdown-based skills

### 4.2 Python Chemistry Backend
- Conda environment (recommended)
- RDKit, OpenBabel, DeepChem
- Docking: vina, DiffDock, UniDock
- FastAPI (optional, for WebUI mode)
- Pandas, RDKit for data handling

### 4.3 LLM
- Works with Claude (via Pi) + other providers
- Strong tool-calling / agentic capabilities

### 4.4 Hardware
- CPU sufficient for basic use
- GPU recommended for DiffDock / large campaigns

---

## 5. Package Structure

```
dimitri/
├── README.md
├── SPEC.md                 # This file
├── package.json            # Pi package manifest
├── skills/
│   └── chem.md               # Main skill definition
├── extensions/
│   └── chemistry.ts          # Tool registration + APIs
├── provision/
│   ├── setup.sh              # Auto-provisioning script
│   └── environment.yml       # Conda env spec
├── backend/
│   └── fastapi_app.py        # Optional local API server
├── docs/
├── examples/
└── .github/
    └── workflows/            # CI (future)
```

---

## 6. Implementation Roadmap

**MVP (v0.1)**
- Core skills + provisioning
- Basic docking + analog generation
- TUI experience

**Phase 2**
- Optional lightweight WebUI (Ketcher + NGL)
- More analysis modules

**Future**
- Retrosynthesis, MD
- Desktop app (Tauri)
- Community extensions

---

## 7. Contributing

Fork → add new skills/extensions → PR
Chemistry logic in Python
Prompts & skills in markdown

**Let's build the future of agentic chemistry.**
