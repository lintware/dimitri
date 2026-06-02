import { chromium } from "playwright";

const OUT = "/tmp/dimitri-shots";
import { mkdirSync } from "node:fs";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 200)); });

const log = (...a) => console.log(...a);
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/1-app.png` });
log("shot 1: app loaded");

// --- Project Data: generate analogs (design) ---
try {
  const gen = page.getByRole("button", { name: /Generate analogs/i });
  await gen.click();
  await page.waitForTimeout(6000); // RDKit generation
  await page.screenshot({ path: `${OUT}/2-design-table.png` });
  log("shot 2: design/table");
} catch (e) { log("design step err:", e.message); }

// --- Molecule Editor panel ---
try {
  await page.getByRole("button", { name: /Molecule Editor/i }).click();
  await page.waitForTimeout(3000); // RDKit wasm + render
  await page.screenshot({ path: `${OUT}/3-molecule-editor.png` });
  log("shot 3: molecule editor");
} catch (e) { log("mol editor err:", e.message); }

// --- Protein Editor panel: import 7WC5 and render 3D ---
try {
  await page.getByRole("button", { name: /Protein Editor/i }).click();
  await page.waitForTimeout(2000);
  // find PDB input (value 7WC5) and Import button
  const importBtn = page.getByRole("button", { name: /^Import$/i });
  await importBtn.click();
  await page.waitForTimeout(9000); // fetch from RCSB + molstar render
  await page.screenshot({ path: `${OUT}/4-protein-3d.png` });
  log("shot 4: protein 3D");
} catch (e) { log("protein err:", e.message); }

await browser.close();
log("done ->", OUT);
