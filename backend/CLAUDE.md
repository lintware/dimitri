# Engine sidecar (`backend/`) — Python + FastAPI

The chemistry engine and **single source of truth**. RDKit science + a SQLite
**ProjectStore** that the GUI, assistant, and CLI all read/write. Runs on **:7842**.

## Layout (`dimitri_chem/`)
- `server.py` — FastAPI app + REST surface + `WS /events` EventBus.
- `store.py` — SQLite ProjectStore (datasets, columns, rows). Changes fan out over the
  EventBus (`dataset_changed`, `column_added`) so the UI updates live.
- `molecule.py` / `properties.py` / `analogs.py` / `scoring.py` / `docking.py` /
  `library.py` — RDKit chemistry kernels.
- `cli.py` — CLI that hits the same REST surface (triad: GUI / CLI / LLM tool).

## REST surface (:7842)
`GET /health` · `/modules` · `/datasets` · `/datasets/{id}/rows` ·
`POST /kernel/{generate_analogs,score_molecule,dock_dataset,define_docking_box}` ·
`GET /lookup?name=` (PubChem→SMILES) · `/molecule3d?smiles=` (RDKit 3D) ·
`/protein/{pdb_id}` (RCSB, cached) · `WS /events`.

## Conventions
- **External fetches are proxied here**, never from the webview (tauri:// can't fetch
  cross-origin). PDB cache: `~/Library/Application Support/Dimitri/pdb_cache/`.
- Docking: pluggable AutoDock Vina (`DIMITRI_VINA`) else a deterministic RDKit estimate.
- Bundled engine runs `python/bin/python3 -m dimitri_chem.server` (module form — the
  console-script shebang is a build-time absolute path).
- After editing here, re-sync into `src-tauri/vendor/` + `pip install --force-reinstall
  --no-deps backend/` before `cargo tauri build` (see root CLAUDE.md → Vendoring).
- Module registry scanned from `DIMITRI_MODULES` (the `modules/` dir).
