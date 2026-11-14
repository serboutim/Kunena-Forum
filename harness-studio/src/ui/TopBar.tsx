import { useEffect, useRef, useState } from "react";
import { analyze } from "../model/analysis";
import { buildBom, bomToCsv } from "../model/bom";
import { connectionsToCsv } from "../model/connections";
import { HarnessFormatError, harnessToText, parseHarness } from "../model/io";
import { COMPONENT_KINDS, type Harness, LENGTH_UNITS, emptyHarness } from "../model/types";
import { demoHarness } from "../samples/demo";
import { type View, useStore } from "../store";
import { type MenuItem, MenuList } from "./ContextMenu";
import { Field, Modal } from "./controls";
import { downloadText, exportSvg, pickFile } from "./files";

const VIEWS: { id: View; label: string }[] = [
  { id: "schematic", label: "Schematic" },
  { id: "layout", label: "Layout" },
  { id: "connections", label: "Connections" },
  { id: "parts", label: "Parts" },
];

const st = () => useStore.getState();

export function baseName(fileName: string) {
  return fileName.replace(/\.(harness|harnesslib|json)$/i, "") || "harness";
}

export function saveFile() {
  const { h, fileName } = st();
  const name = /\.harness$/i.test(fileName) ? fileName : `${baseName(fileName)}.harness`;
  downloadText(harnessToText(h), name);
  st().notify(`Saved ${name}`);
}

export async function openFile() {
  const file = await pickFile(".harness,.harnesslib,.json");
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseHarness(text);
    if (file.name.endsWith(".harnesslib")) {
      st().update((d) => mergeLibrary(d, parsed));
      st().notify(`Imported parts from ${file.name}`);
    } else {
      st().replace(parsed, file.name);
      st().notify(`Opened ${file.name}`);
    }
  } catch (err) {
    st().notify(err instanceof HarnessFormatError || err instanceof Error ? `Could not open file: ${err.message}` : "Could not open file");
  }
}

const PART_ARRAYS = [
  "wireParts", "connectorParts", "terminalParts", "spliceParts", "contactParts", "cableParts", "coveringParts", "diodeParts",
  "resistorParts", "groupParts", "lockParts", "dustCoverParts", "backshellParts", "bootParts", "cavitySealParts", "cavityPlugParts", "mountParts",
] as const;

function mergeLibrary(d: Harness, lib: Harness) {
  for (const k of PART_ARRAYS) {
    const have = new Set((d[k] as { id: string }[]).map((p) => p.id));
    for (const p of lib[k] as { id: string }[]) if (!have.has(p.id)) (d[k] as unknown[]).push(p);
  }
}

function exportLibrary() {
  const { h, fileName } = st();
  const lib = emptyHarness();
  for (const k of PART_ARRAYS) (lib as any)[k] = h[k];
  lib.currency = h.currency; lib.lengthUnit = h.lengthUnit; lib.gaugeUnit = h.gaugeUnit;
  downloadText(harnessToText(lib), `${baseName(fileName)}.harnesslib`);
}

function Dropdown({ label, items, right }: { label: string; items: MenuItem[]; right?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="tb-btn" onClick={() => setOpen(!open)}>{label} ▾</button>
      {open && <div className={`dropdown${right ? " right" : ""}`}><MenuList items={items} close={() => setOpen(false)} /></div>}
    </div>
  );
}

export function TopBar() {
  const h = useStore((s) => s.h);
  const view = useStore((s) => s.view);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [settings, setSettings] = useState(false);
  const [title, setTitle] = useState(h.title ?? "");
  useEffect(() => setTitle(h.title ?? ""), [h.title]);

  const fileItems: MenuItem[] = [
    { label: "New harness", onClick: () => { if (confirm("Start a new, empty harness? Unsaved changes in the current one will be lost.")) st().replace(emptyHarness(), "Untitled.harness"); } },
    { label: "Open…", kbd: "Ctrl+O", onClick: openFile },
    { label: "Load demo harness", onClick: () => st().replace(demoHarness(), "Demo Harness.harness") },
    { separator: true },
    { label: "Save .harness", kbd: "Ctrl+S", onClick: saveFile },
    { label: "Export parts library (.harnesslib)", onClick: exportLibrary },
    { separator: true },
    { label: "Settings…", onClick: () => setSettings(true) },
  ];
  const exportItems: MenuItem[] = [
    { label: "Connections table (CSV)", onClick: () => { const s = st(); const a = analyze(s.h); downloadText(connectionsToCsv(s.h, a), `${baseName(s.fileName)} connections.csv`, "text/csv"); } },
    { label: "Bill of materials (CSV)", onClick: () => { const s = st(); const a = analyze(s.h); downloadText(bomToCsv(s.h, buildBom(s.h, a)), `${baseName(s.fileName)} BOM.csv`, "text/csv"); } },
    {
      label: "Current view as SVG", disabled: view !== "schematic" && view !== "layout",
      onClick: () => { const svg = document.querySelector<SVGSVGElement>(".stage svg.canvas"); if (svg) exportSvg(svg, `${baseName(st().fileName)} ${view}.svg`); },
    },
    { label: "Print / PDF…", kbd: "Ctrl+P", onClick: () => window.print() },
  ];

  return (
    <header className="topbar">
      <div className="brand">
        <svg className="brand-logo" viewBox="0 0 32 32" aria-hidden>
          <rect width="32" height="32" rx="7" fill="#2563eb" />
          <path d="M7 10h6c4 0 4 12 8 12h4M7 22h6c4 0 4-12 8-12h4" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </svg>
        Harness Studio
      </div>
      <input className="title-input" value={title} placeholder="Untitled harness" onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title !== (h.title ?? "") && st().update((d) => { if (title.trim()) d.title = title.trim(); else delete d.title; })}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      <Dropdown label="File" items={fileItems} />
      <Dropdown label="Export" items={exportItems} />
      <button className="tb-btn" disabled={!canUndo} onClick={() => st().undo()} title="Undo (Ctrl+Z)">↶</button>
      <button className="tb-btn" disabled={!canRedo} onClick={() => st().redo()} title="Redo (Ctrl+Shift+Z)">↷</button>
      <nav className="tabs">
        {VIEWS.map((v, i) => (
          <button key={v.id} className={`tab${view === v.id ? " active" : ""}`} onClick={() => st().setView(v.id)}>
            {v.label}<kbd>{i + 1}</kbd>
          </button>
        ))}
      </nav>
      {h.readOnly && <span className="badge warning">Read-only</span>}
      <button className="tb-btn" onClick={() => setSettings(true)} title="Settings">⚙ Settings</button>
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </header>
  );
}

function freezeIds(d: Harness) {
  const a = analyze(d);
  const last: Record<string, number> = {};
  for (const kind of COMPONENT_KINDS) {
    for (const el of d[kind] as any[]) {
      const m = /(\D+)(\d+)$/.exec(a.displayIds.get(el.id) ?? "");
      if (!m) continue;
      el.idNumber = Number(m[2]);
      last[m[1]] = Math.max(last[m[1]] ?? 0, el.idNumber);
    }
  }
  d.idNumbers = { numbering: "Static", lastIdNumbers: last };
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const h = useStore((s) => s.h);
  const set = (fn: (d: Harness) => void) => useStore.setState((s) => {
    const next = structuredClone(s.h);
    fn(next);
    return { h: next, past: [...s.past, s.h], future: [] };
  });
  return (
    <Modal title="Harness settings" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <Field label="Title">
        <input className="input" value={h.title ?? ""} onChange={(e) => set((d) => { d.title = e.target.value || undefined; })} />
      </Field>
      <Field label="Length unit">
        <select className="select" value={h.lengthUnit} onChange={(e) => set((d) => { d.lengthUnit = e.target.value as Harness["lengthUnit"]; })}>
          {LENGTH_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </Field>
      <Field label="Wire gauge">
        <select className="select" value={h.gaugeUnit} onChange={(e) => set((d) => { d.gaugeUnit = e.target.value as Harness["gaugeUnit"]; })}>
          <option value="AWG">AWG</option>
          <option value="Metric">Metric (mm²)</option>
        </select>
      </Field>
      <Field label="Currency">
        <input className="input" value={h.currency} maxLength={4} onChange={(e) => set((d) => { d.currency = e.target.value; })} />
      </Field>
      <Field label="Component IDs">
        <select className="select" value={h.idNumbers?.numbering ?? "CanvasPosition"} onChange={(e) => set((d) => { if (e.target.value === "Static") freezeIds(d); else d.idNumbers = { numbering: "CanvasPosition" }; })}>
          <option value="CanvasPosition">By canvas position (left-to-right, top-to-bottom)</option>
          <option value="Static">Static (keep IDs when moving; new items get the next number)</option>
        </select>
      </Field>
      <Field label="Read-only">
        <label className="check"><input type="checkbox" checked={!!h.readOnly} onChange={(e) => set((d) => { d.readOnly = e.target.checked || undefined; })} /> Prevent edits to this harness</label>
      </Field>
      <p className="hint-text">Settings are saved in the .harness file. Lengths are entered in the harness unit unless a unit is typed, e.g. <code>12 in</code>.</p>
    </Modal>
  );
}
