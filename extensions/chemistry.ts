// Dimitri Chemistry Extension for Pi Agent
// Registers chemistry tools for the LLM

export const chemistryTools = {
  generate_analogs: {
    description: "Generate scaffold-based analogs with R-group exploration",
    parameters: { scaffold: "string", count: "number" }
  },
  run_docking: {
    description: "Run molecular docking (Vina / DiffDock / UniDock)",
    parameters: { smiles: "string", pdb_id: "string", method: "string" }
  },
  calculate_admet: {
    description: "Predict ADMET properties",
    parameters: { smiles: "string" }
  },
  search_pdb: {
    description: "Search PDB by ligand or protein name",
    parameters: { query: "string" }
  }
};

// This extension will be loaded by Pi to expose the above tools to Claude.