/**
 * Dimitri Chemistry Extension for Pi
 *
 * Adds the `/chem` slash command to the embedded pi agent. The command does NOT
 * talk to the backend directly — it drives the agent's existing chemistry tools
 * (generate_analogs / score_molecule / dock_dataset, defined in
 * assistant/src/tools.ts) via `pi.sendUserMessage`, so the work goes through the
 * engine's REST surface, lands in the shared project store, and shows up live in
 * the UI panels. That keeps it working in the bundled .app (no `uv` subprocess).
 *
 * Paired skill: skills/chem.md (medicinal-chemist persona + workflows).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("chem", {
    description:
      "Dimitri chemistry designer — /chem generate <scaffold> [count] | score <smiles> | dock [pdb_id] | status",
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      const [sub, ...rest] = (args || "").trim().split(/\s+/).filter(Boolean);

      switch (sub) {
        case "generate":
        case "gen": {
          const scaffold = rest[0];
          if (!scaffold) {
            pi.sendUserMessage(
              "I typed `/chem generate` without a scaffold. Ask me which scaffold SMILES to design around (e.g. tryptamine NCCc1c[nH]c2ccccc12).",
            );
            return;
          }
          const count = parseInt(rest[1] || "200", 10) || 200;
          pi.sendUserMessage(
            `Use the generate_analogs tool to generate ${count} analogs from the scaffold "${scaffold}", then summarize the top compounds with their designer scores.`,
          );
          return;
        }
        case "score": {
          const smi = rest.join(" ");
          if (!smi) {
            pi.sendUserMessage("I typed `/chem score` without a molecule. Ask me for the SMILES to score.");
            return;
          }
          pi.sendUserMessage(
            `Use the score_molecule tool to score the molecule "${smi}" and explain the MPO breakdown (MW, LogP, TPSA, QED).`,
          );
          return;
        }
        case "dock": {
          const pdb = rest[0];
          pi.sendUserMessage(
            `Use the dock_dataset tool to dock the current analogs library${
              pdb ? ` against PDB ${pdb}` : ""
            }, then report the top-ranked ligands by docking_score.`,
          );
          return;
        }
        case "status": {
          pi.sendUserMessage(
            "Summarize the current analogs design library from the project data: list the top compounds and their scores.",
          );
          return;
        }
        default:
          pi.sendUserMessage(
            "Show me the `/chem` usage: `generate <scaffold> [count]`, `score <smiles>`, `dock [pdb_id]`, `status`.",
          );
      }
    },
  });
}
