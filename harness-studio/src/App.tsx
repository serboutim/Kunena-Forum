import { useEffect } from "react";
import { nameOf } from "./model/analysis";
import { formatLength, formatMm2 } from "./model/units";
import { type View, useStore } from "./store";
import { ConnectionsView } from "./ui/ConnectionsView";
import { ContextMenu, useMenu } from "./ui/ContextMenu";
import { Inspector } from "./ui/Inspector";
import { LayoutView } from "./ui/LayoutView";
import { PartsView } from "./ui/PartsView";
import { SchematicView } from "./ui/SchematicView";
import { TopBar, openFile, saveFile } from "./ui/TopBar";
import { deleteSelection, rotateSelection, selectNetOfSelection } from "./ui/actions";
import { useAnalysis } from "./ui/hooks";

const VIEW_KEYS: Record<string, View> = { "1": "schematic", "2": "layout", "3": "connections", "4": "parts" };

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "s") { e.preventDefault(); saveFile(); return; }
      if (mod && key === "o") { e.preventDefault(); openFile(); return; }
      if (isTyping(e)) return;
      if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && key === "y") { e.preventDefault(); s.redo(); return; }
      if (mod && key === "a" && (s.view === "schematic" || s.view === "layout")) {
        e.preventDefault();
        const h = s.h;
        const ids = s.view === "schematic"
          ? [...h.connectors, ...h.terminals, ...h.splices, ...h.diodes, ...h.resistors, ...h.cables, ...h.twistedWires, ...h.wires, ...h.schematicNotes].map((x) => x.id)
          : [...h.connectors, ...h.terminals, ...h.branchPoints, ...h.bundles, ...h.mates, ...h.layoutNotes].map((x) => x.id);
        s.select(ids);
        return;
      }
      if (mod || e.altKey) return;
      if (key === "delete" || key === "backspace") { e.preventDefault(); deleteSelection(); }
      else if (key === "escape") { useMenu.getState().close(); s.select([]); }
      else if (key === "r") rotateSelection();
      else if (key === "i") s.setOption("showIds", !s.options.showIds);
      else if (key === "s") selectNetOfSelection();
      else if (VIEW_KEYS[e.key]) s.setView(VIEW_KEYS[e.key]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function StatusBar() {
  const { h, a, issues } = useAnalysis();
  const selection = useStore((s) => s.selection);
  const fileName = useStore((s) => s.fileName);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  let sel = "Nothing selected";
  if (selection.length === 1) {
    const id = selection[0];
    const c = a.conductorById.get(id);
    if (c) {
      const r = a.routes.get(id);
      sel = `${c.displayId} · ${formatMm2(c.gaugeMm2, h.gaugeUnit)} · ${r?.noRoute ? "no route" : formatLength(r?.lengthMm, h.lengthUnit)}`;
    } else if (a.elements.has(id)) sel = nameOf(a, id);
    else sel = "1 selected";
  } else if (selection.length > 1) {
    const g = selection.map((id) => a.conductorById.get(id)?.gaugeMm2).filter((x): x is number => x !== undefined);
    sel = `${selection.length} selected${g.length ? ` · ${g.length} wires, total ${formatMm2(g.reduce((s, x) => s + x, 0), h.gaugeUnit)}` : ""}`;
  }
  return (
    <footer className="statusbar">
      <span><b>{fileName}</b></span>
      <span>{sel}</span>
      <span className="spacer" />
      <span><b style={{ color: errors ? "var(--danger)" : undefined }}>{errors}</b> errors</span>
      <span><b style={{ color: warnings ? "var(--warn)" : undefined }}>{warnings}</b> warnings</span>
      <span>{a.nets.length} nets</span>
      <span>Autosaved locally</span>
    </footer>
  );
}

export function App() {
  useShortcuts();
  const view = useStore((s) => s.view);
  const toast = useStore((s) => s.toast);
  const sidebar = view === "schematic" || view === "layout";
  return (
    <div className="app">
      <TopBar />
      <main className={`main${sidebar ? "" : " full"}`}>
        <div className="stage">
          {view === "schematic" && <SchematicView />}
          {view === "layout" && <LayoutView />}
          {view === "connections" && <ConnectionsView />}
          {view === "parts" && <PartsView />}
        </div>
        {sidebar && <aside className="sidebar"><Inspector /></aside>}
      </main>
      <StatusBar />
      <ContextMenu />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
