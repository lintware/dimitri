// Lazy singleton loader for RDKit-WASM (runs in-browser; powers the Molecule
// Editor's 2D depiction and descriptors with no engine round-trip — criterion #7).
import initRDKitModule from "@rdkit/rdkit";

const initRDKit = initRDKitModule as unknown as (opts?: any) => Promise<any>;

let rdkitPromise: Promise<any> | null = null;

export function getRDKit(): Promise<any> {
  if (!rdkitPromise) {
    // wasm is copied into /public during install/build
    rdkitPromise = initRDKit({ locateFile: () => "/RDKit_minimal.wasm" });
  }
  return rdkitPromise!;
}

export type MolInfo = {
  valid: boolean;
  svg?: string;
  descriptors?: Record<string, number>;
  canonical?: string;
};

export async function analyzeSmiles(smiles: string): Promise<MolInfo> {
  const RDKit = await getRDKit();
  const mol = RDKit.get_mol(smiles);
  if (!mol || !mol.is_valid()) {
    mol?.delete?.();
    return { valid: false };
  }
  const svg = mol.get_svg(360, 300);
  let descriptors: Record<string, number> = {};
  try {
    descriptors = JSON.parse(mol.get_descriptors());
  } catch {
    /* ignore */
  }
  const canonical = mol.get_smiles();
  mol.delete();
  return { valid: true, svg, descriptors, canonical };
}
