import { useEffect, useRef, useState } from "react";
import {
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewApi,
  type IDockviewPanelProps,
} from "dockview";
import "dockview/dist/styles/dockview.css";
import { ProjectData } from "./panels/ProjectData";
import { Assistant } from "./panels/Assistant";
import { MoleculeEditor } from "./panels/MoleculeEditor";
import { ProteinEditor } from "./panels/ProteinEditor";
import { getHealth } from "./runtime/engine";

const components = {
  "project-data": (_p: IDockviewPanelProps) => <ProjectData />,
  "molecule-editor": (_p: IDockviewPanelProps) => <MoleculeEditor />,
  "protein-editor": (_p: IDockviewPanelProps) => <ProteinEditor />,
  assistant: (_p: IDockviewPanelProps) => <Assistant />,
};

const PANELS = [
  { id: "project-data", title: "Project Data" },
  { id: "molecule-editor", title: "Molecule Editor" },
  { id: "protein-editor", title: "Protein Editor" },
  { id: "assistant", title: "Assistant" },
];

export default function App() {
  const apiRef = useRef<DockviewApi | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({
    "project-data": true,
    assistant: true,
  });

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth({ ok: false }));
  }, []);

  // Open a panel predictably: focus it if already open, else add it in a sensible
  // spot (Assistant docks right; editors open in the main area).
  const openPanel = (id: string, title?: string) => {
    const api = apiRef.current;
    if (!api || !(id in components)) return;
    const existing = api.getPanel(id);
    if (existing) {
      existing.api.setActive();
      return;
    }
    const t = title ?? PANELS.find((p) => p.id === id)?.title ?? id;
    const position =
      id === "assistant" ? ({ direction: "right" } as const) : ({ direction: "within" } as const);
    api.addPanel({ id, component: id, title: t, position });
    api.getPanel(id)?.api.setActive();
  };

  // Let the assistant's open_module tool surface a panel.
  useEffect(() => {
    const onOpen = (e: Event) => openPanel((e as CustomEvent).detail as string);
    window.addEventListener("dimitri:open-module", onOpen);
    return () => window.removeEventListener("dimitri:open-module", onOpen);
  }, []);

  // Let the assistant's load_molecule tool open the editor and draw a structure.
  useEffect(() => {
    const onLoad = (e: Event) => {
      const { smiles } = (e as CustomEvent).detail as { smiles: string; name?: string };
      openPanel("molecule-editor");
      // give the panel a tick to mount before pushing the SMILES into it
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("dimitri:set-smiles", { detail: smiles }));
      }, 120);
    };
    window.addEventListener("dimitri:load-molecule", onLoad);
    return () => window.removeEventListener("dimitri:load-molecule", onLoad);
  }, []);

  // load_protein tool: open the Protein Editor and import the structure.
  useEffect(() => {
    const onLoadProtein = (e: Event) => {
      const { pdbId } = (e as CustomEvent).detail as { pdbId: string };
      openPanel("protein-editor");
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("dimitri:set-pdb", { detail: pdbId }));
      }, 120);
    };
    window.addEventListener("dimitri:load-protein", onLoadProtein);
    return () => window.removeEventListener("dimitri:load-protein", onLoadProtein);
  }, []);

  const onReady = (event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    // Keep the menu checkboxes in sync with dockview's real state, so closing a
    // panel via its tab ✕ still lets you reopen it from the menu.
    const sync = () => {
      const ids = new Set(event.api.panels.map((p) => p.id));
      setOpen(Object.fromEntries(PANELS.map((p) => [p.id, ids.has(p.id)])));
    };
    event.api.onDidLayoutChange(sync);
    event.api.addPanel({ id: "project-data", component: "project-data", title: "Project Data" });
    event.api.addPanel({
      id: "assistant",
      component: "assistant",
      title: "Assistant",
      position: { direction: "right" },
    });
    sync();
  };

  const toggle = (id: string, title: string) => {
    const api = apiRef.current;
    if (!api) return;
    const existing = api.getPanel(id);
    if (existing) api.removePanel(existing);
    else openPanel(id, title);
  };

  return (
    <>
      <div className="menubar">
        <span className="brand">DIMITRI</span>
        <span>Project</span>
        <span>File</span>
        <span>Tools</span>
        <span>Extensions</span>
        <span className="spacer" />
        <span className="panels">
          {PANELS.map((p) => (
            <button
              key={p.id}
              className={open[p.id] ? "on" : ""}
              onClick={() => toggle(p.id, p.title)}
            >
              {open[p.id] ? "☑" : "☐"} {p.title}
            </button>
          ))}
        </span>
        <span style={{ color: health?.ok ? "var(--success)" : "var(--muted)" }}>
          {health == null ? "…" : health.ok ? "● engine" : "○ engine"}
          {health?.rdkit ? " rdkit" : ""}
        </span>
      </div>
      <div className="layout">
        <DockviewReact
          components={components}
          onReady={onReady}
          className="dockview-theme-dark"
        />
      </div>
    </>
  );
}
