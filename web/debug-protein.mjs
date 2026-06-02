import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /Protein Editor/i }).click();
await page.waitForTimeout(1000);
await page.getByRole("button", { name: /^Import$/i }).click();
await page.waitForTimeout(12000);

// Use NGL's own renderer to produce an image (reliable regardless of headless compositing)
const dataUrl = await page.evaluate(async () => {
  const stage = window.__dimitriStage;
  if (!stage) return "NO_STAGE";
  const comps = stage.compList?.length ?? 0;
  const reprs = stage.compList?.[0]?.reprList?.length ?? 0;
  const blob = await stage.makeImage({ factor: 1, antialias: true, trim: false, transparent: false });
  const buf = await blob.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return JSON.stringify({ comps, reprs, png: b64 });
});
if (dataUrl.startsWith("{")) {
  const { comps, reprs, png } = JSON.parse(dataUrl);
  console.log("comps:", comps, "reprs:", reprs, "pngBytes:", png.length);
  writeFileSync("/tmp/dimitri-shots/4e-ngl-makeimage.png", Buffer.from(png, "base64"));
} else console.log(dataUrl);
await browser.close();
