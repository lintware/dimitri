// Chemistry tools injected into the pi agent. Each one calls the local engine's
// REST API (the same surface the GUI panels use) so design work done by the
// assistant lands in the shared project store and shows up live in the UI.

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const ENGINE = process.env.DIMITRI_ENGINE ?? "http://127.0.0.1:7842";

async function engine(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${ENGINE}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`engine ${path} -> ${res.status}`);
  return res.json();
}

export const generateAnalogs = defineTool({
  name: "generate_analogs",
  label: "Generate Analogs",
  description:
    "Generate and score a focused library of real chemical analogs from a scaffold SMILES using RDKit. Results are written to the 'analogs' dataset and appear in the Project Data table.",
  parameters: Type.Object({
    scaffold: Type.String({ description: "SMILES of the core scaffold, e.g. tryptamine NCCc1c[nH]c2ccccc12" }),
    count: Type.Integer({ description: "How many analogs to generate", default: 200, minimum: 10, maximum: 2000 }),
    name: Type.Optional(Type.String({ description: "Name for this design campaign" })),
  }),
  async execute(_id, params) {
    const r = await engine("/kernel/generate_analogs", {
      scaffold: params.scaffold,
      count: params.count ?? 200,
      name: params.name ?? "analogs",
      dataset_id: "analogs",
    });
    return {
      content: [
        {
          type: "text",
          text: `Generated ${r.count} analogs (mean score ${r.mean_score}, range ${r.score_range?.join("–")}). Top: ${(r.top_5_smiles ?? []).slice(0, 3).join(", ")}. Written to the Project Data table.`,
        },
      ],
      details: r,
    };
  },
});

export const scoreMolecule = defineTool({
  name: "score_molecule",
  label: "Score Molecule",
  description: "Score a single molecule with Dimitri's CNS/tryptamine multi-parameter designer score (RDKit descriptors + MPO).",
  parameters: Type.Object({
    smiles: Type.String({ description: "SMILES of the molecule to score" }),
  }),
  async execute(_id, params) {
    const r = await engine("/kernel/score_molecule", { smiles: params.smiles });
    return {
      content: [{ type: "text", text: `Designer score: ${r.score?.toFixed?.(4) ?? r.score}\n${JSON.stringify(r.breakdown, null, 2)}` }],
      details: r,
    };
  },
});

export const dockDataset = defineTool({
  name: "dock_dataset",
  label: "Dock Library",
  description:
    "Dock every ligand in a dataset against a protein's docking box and add a live 'docking_score' column (kcal/mol, more negative = stronger predicted binding). Uses the box saved for a PDB id (define it in the Protein Editor) or explicit center+size coords. This is the 'generate → dock → rank' workflow.",
  parameters: Type.Object({
    dataset_id: Type.Optional(Type.String({ description: "Dataset to dock (default 'analogs')" })),
    pdb_id: Type.Optional(Type.String({ description: "Protein PDB id whose saved box to use, e.g. 7WC5" })),
    cx: Type.Optional(Type.Number({ description: "Box center x (overrides pdb_id box)" })),
    cy: Type.Optional(Type.Number({ description: "Box center y" })),
    cz: Type.Optional(Type.Number({ description: "Box center z" })),
    size: Type.Optional(Type.Number({ description: "Box edge length in Å" })),
  }),
  async execute(_id, params) {
    const r = await engine("/kernel/dock_dataset", {
      dataset_id: params.dataset_id ?? "analogs",
      pdb_id: params.pdb_id,
      cx: params.cx,
      cy: params.cy,
      cz: params.cz,
      size: params.size,
    });
    if (r.error) return { content: [{ type: "text", text: `Docking skipped: ${r.error}` }], details: r };
    return {
      content: [
        {
          type: "text",
          text: `Docked ${r.docked} ligands in '${r.dataset_id}' (${r.method}). Added the docking_score column; rank by it in Project Data.`,
        },
      ],
      details: r,
    };
  },
});

export const loadMolecule = defineTool({
  name: "load_molecule",
  label: "Load Molecule",
  description:
    "Load a molecule into the Molecule Editor on the platform so the user SEES it drawn (2D structure + descriptors). ALWAYS use this when the user asks you to build/draw/show a specific molecule — do NOT just tell them the SMILES. Opens the editor and renders the structure.",
  parameters: Type.Object({
    smiles: Type.String({ description: "SMILES of the molecule to draw, e.g. acetaminophen CC(=O)Nc1ccc(O)cc1" }),
    name: Type.Optional(Type.String({ description: "Human-readable name, e.g. acetaminophen" })),
  }),
  async execute(_id, params) {
    (globalThis as any).__dimitriLoadMolecule?.(params.smiles, params.name);
    return {
      content: [
        { type: "text", text: `Loaded ${params.name ?? "the molecule"} (${params.smiles}) into the Molecule Editor.` },
      ],
      details: { smiles: params.smiles, name: params.name },
    };
  },
});

export const lookupMolecule = defineTool({
  name: "lookup_molecule",
  label: "Look up Molecule",
  description:
    "Resolve a compound NAME to its authoritative SMILES via PubChem. ALWAYS call this BEFORE load_molecule/score for any named compound (e.g. 'corannulene', 'caffeine', 'aspirin') — never invent or guess a SMILES from memory. Returns the validated canonical SMILES, molecular formula, and PubChem CID.",
  parameters: Type.Object({
    name: Type.String({ description: "Common or IUPAC compound name, e.g. corannulene" }),
  }),
  async execute(_id, params) {
    const r = await engine(`/lookup?name=${encodeURIComponent(params.name)}`);
    if (!r.found) {
      return {
        content: [{ type: "text", text: `No PubChem match for "${params.name}"${r.error ? ` (${r.error})` : ""}. Do NOT guess a SMILES; ask the user to clarify or provide one.` }],
        details: r,
      };
    }
    return {
      content: [
        { type: "text", text: `${params.name} → SMILES \`${r.smiles}\` (${r.formula}, PubChem CID ${r.cid}). Use this exact SMILES.` },
      ],
      details: r,
    };
  },
});

export const loadProtein = defineTool({
  name: "load_protein",
  label: "Load Protein",
  description:
    "Load a protein structure into the Protein Editor and render it in 3D so the user SEES it. ALWAYS use this when the user asks to view/import/bring in a protein — do NOT just ask them to type the ID. Accepts an RCSB PDB id (e.g. 7WC5, the 5-HT2A receptor).",
  parameters: Type.Object({
    pdb_id: Type.String({ description: "RCSB PDB id, e.g. 7WC5" }),
  }),
  async execute(_id, params) {
    (globalThis as any).__dimitriLoadProtein?.(params.pdb_id);
    return {
      content: [{ type: "text", text: `Loaded protein ${params.pdb_id} into the Protein Editor and rendered it in 3D.` }],
      details: { pdb_id: params.pdb_id },
    };
  },
});

export const openModule = defineTool({
  name: "open_module",
  label: "Open Module",
  description: "Open a Dimitri module panel (window) in the UI, e.g. 'docking', 'protein-editor', 'molecule-editor', 'project-data', 'admet'.",
  parameters: Type.Object({
    id: Type.String({ description: "Module id to open" }),
  }),
  async execute(_id, params) {
    // The sidecar relays this to connected UI clients (see index.ts).
    globalThis.__dimitriOpenModule?.(params.id);
    return { content: [{ type: "text", text: `Opened the ${params.id} module.` }], details: { id: params.id } };
  },
});

export const chemistryTools = [generateAnalogs, scoreMolecule, dockDataset, lookupMolecule, loadMolecule, loadProtein, openModule];
