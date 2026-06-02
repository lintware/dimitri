# Dimitri Modules

Dimitri is built from **modules** — self-contained capabilities, each registered by a
`modules/<id>/module.json` manifest and surfaced as a dockable panel in the UI. Every module
follows the **triad-control** principle: it can be driven from the **GUI**, the **CLI**, and
the **AI assistant**, all sharing one project store.

## The module contract

Each `modules/<id>/module.json`:

| Field | Meaning |
|---|---|
| `id` | unique module id (also the panel/component id) |
| `label` | display name in the UI |
| `category` | `data` · `editor` · `analysis` |
| `runtime` | `engine` (Python/FastAPI), `wasm` (in-browser), or `gpu` |
| `consumes` / `produces` | data kinds: `molecules`, `proteins`, `results` |
| `tools` | tool names the assistant/CLI can call |
| `description` | one-line summary (shown in the registry / `GET /modules`) |

The engine scans these at `GET /modules`. Data flows through the shared **project store**
(SQLite); when a module writes results, an event (`dataset_changed` / `column_added`) is
pushed over `WS /events` and the relevant panels refresh live.

---

## 📊 Project Data  (`project-data`)

**The live spreadsheet — the hub every other module reads from and writes to.**

- **Runtime:** engine · **Produces:** molecules, proteins, results
- A tabbed, sortable table of datasets (`analogs`, `TIHKAL`, `ADMET`, `proteins`, …). Lead
  columns (`smiles`, `score`, `mw`, `logp`, `tpsa`, `qed`, `docking_score`) are pinned; the
  rest follow.
- **Generate analogs:** enter a scaffold SMILES → builds and scores a focused analog library.
- **Dock:** docks the active dataset against the defined protein box and adds a live
  `docking_score` column; tick **rank by binding** to sort by it (most negative = best).
- Subscribes to engine events, so rows/columns update in real time as any tool runs.

**Engine endpoints:** `GET /datasets`, `GET /datasets/{id}/rows`,
`POST /kernel/generate_analogs`, `POST /kernel/dock_dataset`.
**Assistant tools:** `generate_analogs`, `dock_dataset`.

---

## 🧪 Molecule Editor  (`molecule-editor`)

**Draw, view, and score small molecules — in 2D and 3D.**

- **Runtime:** wasm (2D/descriptors run fully in-browser) + engine (3D conformer, scoring)
- **2D mode:** interactive [Ketcher](https://github.com/epam/ketcher) sketcher — draw/edit
  atoms, bonds, rings, templates. Two-way SMILES sync: edit the canvas or type a SMILES.
- **3D mode:** toggle to a real interactive ball-and-stick view (3Dmol.js). The engine
  generates a conformer from the SMILES with RDKit (ETKDG embed + MMFF optimize).
- Live RDKit descriptors (MW, LogP, TPSA, HBD/HBA, rotatable bonds, QED) and an engine-backed
  **designer score** (multi-parameter optimization tuned for CNS/tryptamine-like compounds).

**Engine endpoints:** `POST /kernel/score_molecule`, `GET /molecule3d?smiles=`.
**Assistant tools:** `lookup_molecule` (PubChem → authoritative SMILES), `load_molecule`
(draws it in the editor), `score_molecule`.

> The assistant **always looks a named compound up in PubChem before drawing it** — it never
> invents a SMILES from memory.

---

## 🧬 Protein Editor  (`protein-editor`)

**The lightweight Chimera — import, view, and prep proteins for docking.**

- **Runtime:** engine · **Consumes/Produces:** proteins
- Import any structure by **PDB ID** (e.g. `7WC5`, the 5-HT2A serotonin receptor). The
  structure file is fetched server-side from the RCSB PDB and cached for offline reuse.
- Real **interactive 3D** rendering with [3Dmol.js](https://3dmol.csb.pitt.edu/) — drag to
  rotate, scroll to zoom. Cartoon (spectrum), Surface, and Sticks styles; **Focus ligand**
  zooms into the bound ligand/pocket.
- **Define docking box:** set center (cx, cy, cz) + size; saved onto the `proteins` dataset
  and used by the Docking module.

**Engine endpoints:** `GET /protein/{pdb_id}` (RCSB proxy + cache),
`POST /kernel/define_docking_box`.
**Assistant tools:** `load_protein` (imports + renders in 3D), `open_module`.

---

## 🎯 Docking  (`docking`)

**Score how well ligands bind in a receptor's pocket — generate → dock → rank.**

- **Runtime:** engine · **Consumes:** molecules + proteins · **Produces:** results
- Docks every ligand in a dataset against a protein's docking box and merges a live
  **`docking_score`** column (kcal/mol; more negative = stronger predicted binding).
- **Two backends, auto-selected:**
  - **`rdkit_estimate`** (default) — a deterministic, reproducible RDKit 3D-based affinity
    estimate. Zero extra dependencies, works offline, runs everywhere.
  - **`vina`** — set `DIMITRI_VINA` to an AutoDock Vina/smina binary and provide a prepared
    receptor PDBQT for true physics-based docking.

**Engine endpoint:** `POST /kernel/dock_dataset` (resolves the box from a saved protein or
explicit coords). **Assistant tool:** `dock_dataset`.

---

## 🧫 ADMET  (`admet`)

**Absorption, Distribution, Metabolism, Excretion, Toxicity profiling.**

- **Runtime:** engine · **Consumes:** molecules · **Produces:** results
- Computes ADMET-style metrics for a molecule library and adds them as columns to the table,
  for filtering and prioritization alongside design and docking scores.

**Assistant tool:** `admet_profile`.

---

## Cross-cutting: the assistant

The AI assistant (the **Assistant** panel) can drive all of the above. It is instructed to
*act on the platform* rather than describe steps. Available tools:

| Tool | Action |
|---|---|
| `lookup_molecule` | Resolve a name → authoritative SMILES (PubChem) |
| `load_molecule` | Draw a molecule in the Molecule Editor |
| `score_molecule` | Designer/MPO score for one compound |
| `generate_analogs` | Build + score an analog library from a scaffold |
| `load_protein` | Import + render a protein in 3D |
| `dock_dataset` | Dock a library against a box, add a score column |
| `open_module` | Open any panel (project-data, molecule-editor, protein-editor, docking, admet) |

## Writing a new module

1. Create `modules/<id>/module.json` following the contract above.
2. Add a panel component in `web/src/panels/` and register it in `web/src/App.tsx`.
3. If it needs server compute, add an endpoint in `backend/dimitri_chem/server.py` and a
   client call in `web/src/runtime/engine.ts`.
4. To make it assistant-drivable, add a tool in `assistant/src/tools.ts` and list it in
   `assistant/src/index.ts`.

Keep results flowing through the project store so every surface stays in sync.
