<div align="center">

# Dimitri 🧬

**An open-source AI harness for molecular science.**

Design molecules, visualize proteins in 3D, dock and rank — with an AI assistant that
drives the whole toolkit. Download the app, connect your own AI account, and go. No
terminal, no conda, no Docker.

_Named after Dmitri Mendeleev. Built by **Lint Labs**. Free and open-source._

</div>

---

## What it is

Dimitri is a downloadable **desktop app** (Tauri) that bundles a real Python chemistry
engine (RDKit) and an embedded AI assistant (the [pi](https://github.com/earendil-works)
agent). It's a *harness* — a modern, AI-native IDE for molecular science — inspired by
the workflow a medicinal chemist actually uses: a live data spreadsheet, a structure
editor, a protein viewer, docking, and an assistant that can operate every one of them.

You bring your own AI subscription (Claude, OpenAI, DeepSeek, or xAI); everything else
runs locally and works offline.

## Features

- **🧪 Molecule design** — draw/edit 2D structures (Ketcher), view them in interactive 3D,
  generate and score analogs from any scaffold, and see live physicochemical descriptors.
- **🧬 Protein visualization** — import any structure by PDB ID, view it in 3D
  (Chimera-style, via 3Dmol.js), and define a docking box.
- **🎯 Docking & ranking** — dock a whole library against a receptor and get a live
  docking-score column. Generate → dock → rank, end to end.
- **🔎 Grounded AI assistant** — ask in plain language ("build caffeine", "load 7WC5",
  "generate 50 tryptamine analogs and dock them"). The assistant *acts on the platform*
  and looks compounds up in PubChem instead of guessing structures.
- **📊 Live project data** — one shared spreadsheet that every tool reads from and writes
  to, updating in real time.
- **🔌 Triad control** — every capability is usable three ways: GUI panel, CLI, and AI tool.
- **🛜 Offline-first** — design, scoring, and visualization need no internet; only the
  assistant requires a connection.

## Install

> Download `Dimitri.app`, drag it to Applications, and open it. The chemistry engine and
> assistant start automatically — the in-app health check turns green on first run.

(Pre-built releases coming soon. To build it yourself, see **Development** below.)

### Connect your AI account

Drop a key into `~/Library/Application Support/Dimitri/.env`:

```
# one of:
ANTHROPIC_API_KEY=...      # or sign in with Claude Pro/Max via pi
OPENAI_API_KEY=...
DEEPSEEK_API_KEY=...
XAI_API_KEY=...
```

The assistant auto-selects a model from whatever you connect (see the model table in
[`CLAUDE.md`](CLAUDE.md)).

## Quick tour

1. **Project Data** — pick a dataset, enter a scaffold (e.g. tryptamine
   `NCCc1c[nH]c2ccccc12`), click **Generate analogs**.
2. **Molecule Editor** — draw or paste a SMILES; flip the **2D / 3D** toggle; click **Score**.
3. **Protein Editor** — enter a PDB ID (e.g. `7WC5`), **Import**, rotate the 3D structure,
   set a **docking box**.
4. **Dock** — back in Project Data, click **Dock** and tick **rank by binding**.
5. **Assistant** — or just ask: *"generate 50 tryptamine analogs, dock them against 7WC5,
   and rank by binding."*

See [`docs/MODULES.md`](docs/MODULES.md) for full documentation of every module.

## Architecture

```
┌─ Tauri shell (Rust) ── supervises sidecars, hosts the web UI
│
├─ Engine sidecar    (Python, FastAPI :7842)  — RDKit chemistry + SQLite project store
├─ Assistant sidecar (Node, pi agent :7843)   — LLM + chemistry tools over WebSocket
└─ Web UI            (React + Vite, dockview)  — dockable panels, talks to both
```

The SQLite **project store** is the single source of truth; an event bus pushes changes to
the UI live. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full design and
[`CLAUDE.md`](CLAUDE.md) for contributor notes and gotchas.

## Development

```bash
# Dev (hot-reloading UI)
cd web && npx vite --port 5173            # keep running
cd src-tauri && cargo build && ./target/debug/dimitri

# Bundle the self-contained .app
cd src-tauri && cargo tauri build         # → target/release/bundle/macos/Dimitri.app
```

Requirements for dev: Rust, [`uv`](https://docs.astral.sh/uv/), Node. The bundled `.app`
needs none of these — Python and Node are vendored inside it.

## Tech & licensing

Tauri v2 · React + Vite · dockview · **Ketcher** (2D) · **RDKit**-WASM + **3Dmol.js** (3D) ·
FastAPI + RDKit + SQLite · pi (`@earendil-works`) · **AutoDock Vina** (optional docking).

All chemistry libraries are open-source — Ketcher (Apache-2.0), RDKit (BSD), 3Dmol.js (BSD),
AutoDock Vina (Apache-2.0). Only the LLM is bring-your-own-key.

## License

Open-source and free. © Lint Labs. See [`LICENSE`](LICENSE).

Contributions welcome — open an issue or PR.
