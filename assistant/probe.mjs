import WebSocket from "ws";
const text = process.argv[2] ?? "Say hello in one word.";
const ws = new WebSocket("ws://127.0.0.1:7843");
let toks = "";
const kill = setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 120000);
ws.on("open", () => ws.send(JSON.stringify({ type: "prompt", text })));
ws.on("message", (d) => {
  const e = JSON.parse(d.toString());
  if (e.type === "token") toks += e.delta;
  else if (e.type === "tool") console.log("[TOOL CALL]", e.name, JSON.stringify(e.args));
  else if (e.type === "open_module") console.log("[OPEN MODULE]", e.id);
  else if (e.type === "error") { console.log("[ERR]", e.message); clearTimeout(kill); process.exit(1); }
  else if (e.type === "end") { console.log("\n[ASSISTANT]\n" + toks.slice(0, 800)); clearTimeout(kill); ws.close(); process.exit(0); }
});
ws.on("error", (e) => { console.log("WSERR", e.message); clearTimeout(kill); process.exit(1); });
