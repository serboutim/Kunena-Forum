import { Fragment, type ReactNode, useMemo, useState } from "react";
import { buildBom, bomToCsv, bomTotal } from "../model/bom";
import { colorHex } from "../model/colors";
import { addPart, deleteElements, makeIdFactory } from "../model/ops";
import {
  type AccessoryType, type CablePart, type ConnectorPart, type Harness, type PartBase, type PartKind,
  ACCESSORY_KIND, COVERING_TYPES, LENGTH_UNITS, PART_KIND_LABEL, TERMINAL_TYPES,
} from "../model/types";
import { partName, usedPartIds } from "../model/validation";
import { useStore } from "../store";
import { terminalLabel } from "./actions";
import { ColorSelect, GaugeInput, LengthInput, NumberInput, TextInput } from "./controls";
import { downloadText } from "./files";
import { analysisOf } from "./hooks";

type Setter = (fn: (p: any) => void) => void;
interface Col { label: string; width?: number; render: (p: any, set: Setter, h: Harness) => ReactNode }

const gaugeCols: Col[] = [
  { label: "Min gauge", width: 100, render: (p, set, h) => <GaugeInput value={p.minGauge} unit={h.gaugeUnit} onCommit={(g) => set((x) => { if (g) x.minGauge = g; else delete x.minGauge; })} /> },
  { label: "Max gauge", width: 100, render: (p, set, h) => <GaugeInput value={p.maxGauge} unit={h.gaugeUnit} onCommit={(g) => set((x) => { if (g) x.maxGauge = g; else delete x.maxGauge; })} /> },
];
const priceCol: Col = { label: "Price", width: 80, render: (p, set) => <NumberInput value={p.price} onCommit={(v) => set((x) => { if (v === undefined) delete x.price; else x.price = v; })} /> };
const pplCol: Col = {
  label: "Price / length", width: 150, render: (p, set, h) => (
    <span style={{ display: "flex", gap: 4 }}>
      <NumberInput value={p.pricePerLength?.price} onCommit={(v) => set((x) => { if (v === undefined) delete x.pricePerLength; else x.pricePerLength = { price: v, unit: x.pricePerLength?.unit ?? (h.lengthUnit === "mm" || h.lengthUnit === "cm" ? "m" : h.lengthUnit) }; })} />
      <select className="select" style={{ width: 56 }} value={p.pricePerLength?.unit ?? "m"} onChange={(e) => set((x) => { if (x.pricePerLength) x.pricePerLength.unit = e.target.value; })}>
        {LENGTH_UNITS.map((u) => <option key={u}>{u}</option>)}
      </select>
    </span>
  ),
};
const colorCol: Col = { label: "Color", width: 140, render: (p, set) => <ColorSelect value={p.color} allowNone onChange={(c) => set((x) => { if (c) x.color = c; else delete x.color; })} /> };

const KIND_COLS: Partial<Record<PartKind, Col[]>> = {
  wireParts: [
    colorCol,
    { label: "Stripe", width: 140, render: (p, set) => <ColorSelect value={p.stripeColor} allowNone onChange={(c) => set((x) => { if (c) x.stripeColor = c; else delete x.stripeColor; })} /> },
    { label: "Gauge", width: 100, render: (p, set, h) => <GaugeInput value={p.gauge} unit={h.gaugeUnit} onCommit={(g) => set((x) => { if (g) x.gauge = g; else delete x.gauge; })} /> },
    pplCol,
  ],
  connectorParts: [
    colorCol,
    { label: "Cavities", width: 70, render: (p, set) => <NumberInput value={p.numberOfCavities} step={1} onCommit={(v) => set((x) => { if (v === undefined) delete x.numberOfCavities; else x.numberOfCavities = Math.max(1, Math.round(v)); })} /> },
    { label: "Gender", width: 90, render: (p, set) => <select className="select" value={p.gender ?? ""} onChange={(e) => set((x) => { if (e.target.value) x.gender = e.target.value; else delete x.gender; })}><option value="">—</option><option>Male</option><option>Female</option></select> },
    { label: "Shell", width: 50, render: (p, set) => <input type="checkbox" checked={!!p.hasShell} onChange={(e) => set((x) => { x.hasShell = e.target.checked; })} /> },
    {
      label: "Designations", width: 120, render: (p, set) => (
        <select className="select" value={p.designationStrategy?.type ?? "sequential"} onChange={(e) => set((x) => {
          const t = e.target.value;
          x.designationStrategy = t === "alphabetical" ? { type: t, skippedLetters: ["I", "O"] } : t === "grid" ? { type: t, rows: 2, columns: Math.ceil((x.numberOfCavities ?? 2) / 2), rowLabels: { type: "alphabetical" }, columnLabels: { type: "sequential" } } : t === "custom" ? { type: t, labels: [] } : { type: "sequential" };
        })}>
          <option value="sequential">1, 2, 3</option><option value="alphabetical">A, B, C</option><option value="grid">Grid (A1…)</option><option value="custom">Custom</option>
        </select>
      ),
    },
    priceCol,
  ],
  terminalParts: [
    { label: "Type", width: 150, render: (p, set) => <select className="select" value={p.type ?? "Ring"} onChange={(e) => set((x) => { x.type = e.target.value; })}>{TERMINAL_TYPES.map((t) => <option key={t} value={t}>{terminalLabel(t)}</option>)}</select> },
    { label: "Size", width: 90, render: (p, set) => <TextInput value={typeof p.size === "string" ? p.size : p.size ? `${p.size.value} ${p.size.unit}` : ""} onCommit={(v) => set((x) => { const m = /^\s*(\d+(?:\.\d+)?)\s*(mm|in)?\s*$/.exec(v); if (!v.trim()) delete x.size; else x.size = m ? { value: Number(m[1]), unit: m[2] ?? "mm" } : v; })} /> },
    ...gaugeCols, priceCol,
  ],
  contactParts: [
    { label: "Gender", width: 90, render: (p, set) => <select className="select" value={p.gender ?? ""} onChange={(e) => set((x) => { if (e.target.value) x.gender = e.target.value; else delete x.gender; })}><option value="">—</option><option>Pin</option><option>Socket</option></select> },
    { label: "Type", width: 90, render: (p, set) => <select className="select" value={p.type ?? "Crimp"} onChange={(e) => set((x) => { x.type = e.target.value; })}><option>Crimp</option><option>Solder</option><option>Other</option></select> },
    ...gaugeCols, priceCol,
  ],
  spliceParts: [...gaugeCols, priceCol],
  coveringParts: [
    { label: "Type", width: 150, render: (p, set) => <select className="select" value={p.type ?? "Other"} onChange={(e) => set((x) => { x.type = e.target.value; })}>{COVERING_TYPES.map((t) => <option key={t} value={t}>{t.replace(/([a-z])([A-Z])/g, "$1 $2")}</option>)}</select> },
    colorCol,
    { label: "Min ⌀", width: 90, render: (p, set) => <LengthInput value={p.minDiameter} unit="mm" placeholder="—" onCommit={(l) => set((x) => { if (l) x.minDiameter = l; else delete x.minDiameter; })} /> },
    { label: "Max ⌀", width: 90, render: (p, set) => <LengthInput value={p.maxDiameter} unit="mm" placeholder="—" onCommit={(l) => set((x) => { if (l) x.maxDiameter = l; else delete x.maxDiameter; })} /> },
    { label: "Fixed length", width: 80, render: (p, set) => <input type="checkbox" checked={!!p.isFixedLength} onChange={(e) => set((x) => { x.isFixedLength = e.target.checked; })} /> },
    { label: "Price", width: 150, render: (p, set, h) => (p.isFixedLength ? priceCol.render(p, set, h) : pplCol.render(p, set, h)) },
  ],
  cableParts: [
    colorCol,
    { label: "Shielded", width: 70, render: (p, set) => <input type="checkbox" checked={!!p.shielded} onChange={(e) => set((x) => { x.shielded = e.target.checked; })} /> },
    { label: "Cores", width: 60, render: (p) => <span>{p.cores?.length ?? 0}</span> },
    pplCol,
  ],
  diodeParts: [
    { label: "Voltage (V)", width: 90, render: (p, set) => <NumberInput value={p.voltage} onCommit={(v) => set((x) => { x.voltage = v; x.voltageUnit = "V"; })} /> },
    { label: "Current (A)", width: 90, render: (p, set) => <NumberInput value={p.current} onCommit={(v) => set((x) => { x.current = v; x.currentUnit = "A"; })} /> },
    priceCol,
  ],
  resistorParts: [
    { label: "Resistance (Ω)", width: 100, render: (p, set) => <NumberInput value={p.resistance} onCommit={(v) => set((x) => { x.resistance = v; x.resistanceUnit = "ohm"; })} /> },
    { label: "Power (W)", width: 80, render: (p, set) => <NumberInput value={p.power} onCommit={(v) => set((x) => { x.power = v; x.powerUnit = "W"; })} /> },
    priceCol,
  ],
};

const NAV_GROUPS: { title: string; kinds: PartKind[] }[] = [
  { title: "Conductors", kinds: ["wireParts", "cableParts"] },
  { title: "Terminations", kinds: ["connectorParts", "contactParts", "terminalParts", "spliceParts"] },
  { title: "Inline", kinds: ["diodeParts", "resistorParts"] },
  { title: "Protection", kinds: ["coveringParts", "bootParts", "backshellParts"] },
  { title: "Accessories", kinds: ["lockParts", "dustCoverParts", "mountParts", "cavityPlugParts", "cavitySealParts", "groupParts"] },
];

export function PartsView() {
  const [tab, setTab] = useState<PartKind | "bom">("bom");
  const h = useStore((s) => s.h);
  return (
    <div className="parts-layout">
      <nav className="parts-nav">
        <button className={tab === "bom" ? "active" : ""} onClick={() => setTab("bom")}><span>Bill of materials</span></button>
        {NAV_GROUPS.map((g) => (
          <Fragment key={g.title}>
            <div className="group">{g.title}</div>
            {g.kinds.map((k) => (
              <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
                <span>{PART_KIND_LABEL[k]}</span><span className="hint-text">{(h[k] as unknown[]).length || ""}</span>
              </button>
            ))}
          </Fragment>
        ))}
      </nav>
      {tab === "bom" ? <BomTable /> : <PartTable kind={tab} />}
    </div>
  );
}

function PartTable({ kind }: { kind: PartKind }) {
  const h = useStore((s) => s.h);
  const selection = useStore((s) => s.selection);
  const { update, select } = useStore.getState();
  const [open, setOpen] = useState<string | null>(null);
  const used = useMemo(() => usedPartIds(h), [h]);
  const usage = useMemo(() => usageCounts(h), [h]);
  const parts = h[kind] as PartBase[];
  const cols = KIND_COLS[kind] ?? [colorCol, priceCol];
  const hasDetails = kind === "connectorParts" || kind === "cableParts" || kind === "terminalParts" || kind === "spliceParts";
  const setter = (id: string): Setter => (fn) => update((d) => { const p = (d[kind] as any[]).find((x) => x.id === id); if (p) fn(p); });
  return (
    <div className="table-view">
      <div className="table-toolbar">
        <h2>{PART_KIND_LABEL[kind]} parts</h2>
        <button className="btn primary" onClick={() => { let id = ""; update((d) => { id = addPart(d, kind); }); select([id]); }}>+ Add part</button>
        <span style={{ flex: 1 }} />
        <span className="hint-text">Assign parts from a component's inspector or right-click menu.</span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            {hasDetails && <th style={{ width: 24 }} />}
            <th>Part number</th><th>Internal</th><th>Manufacturer</th><th>Description</th>
            {cols.map((c) => <th key={c.label}>{c.label}</th>)}
            <th>Used</th><th />
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => {
            const set = setter(p.id);
            return (
              <Fragment key={p.id}>
                <tr className={selection.includes(p.id) ? "sel" : ""} onClick={() => select([p.id])}>
                  {hasDetails && <td><button className="btn small" onClick={(e) => { e.stopPropagation(); setOpen(open === p.id ? null : p.id); }}>{open === p.id ? "▾" : "▸"}</button></td>}
                  <td style={{ minWidth: 130 }}><TextInput value={p.partNumber} placeholder="Part number" onCommit={(v) => set((x) => { x.partNumber = v; })} /></td>
                  <td style={{ minWidth: 90 }}><TextInput value={p.internalPartNumber} placeholder="—" onCommit={(v) => set((x) => { if (v) x.internalPartNumber = v; else delete x.internalPartNumber; })} /></td>
                  <td style={{ minWidth: 120 }}><TextInput value={p.manufacturer} placeholder="Manufacturer" onCommit={(v) => set((x) => { x.manufacturer = v; })} /></td>
                  <td style={{ minWidth: 180 }}><TextInput value={p.description} placeholder="Description" onCommit={(v) => set((x) => { if (v) x.description = v; else delete x.description; })} /></td>
                  {cols.map((c) => <td key={c.label} style={{ minWidth: c.width }} onClick={(e) => e.stopPropagation()}>{c.render(p, set, h)}</td>)}
                  <td>{used.has(p.id) ? <span className="badge ok">{usage.get(p.id) ?? 1}×</span> : <span className="badge warning">Not Used</span>}</td>
                  <td><button className="btn small danger" title="Delete part" onClick={(e) => { e.stopPropagation(); update((d) => deleteElements(d, [p.id])); }}>✕</button></td>
                </tr>
                {open === p.id && kind === "connectorParts" && <tr><td colSpan={cols.length + 8} style={{ background: "#f8fafc", whiteSpace: "normal" }}><ConfigurationsEditor part={p as ConnectorPart} kind={kind} /></td></tr>}
                {open === p.id && (kind === "terminalParts" || kind === "spliceParts") && <tr><td colSpan={cols.length + 8} style={{ background: "#f8fafc", whiteSpace: "normal" }}><ConfigurationsEditor part={p as any} kind={kind} /></td></tr>}
                {open === p.id && kind === "cableParts" && <tr><td colSpan={cols.length + 8} style={{ background: "#f8fafc", whiteSpace: "normal" }}><CoresEditor part={p as CablePart} /></td></tr>}
              </Fragment>
            );
          })}
          {!parts.length && <tr><td colSpan={cols.length + 8} style={{ textAlign: "center", padding: 30, color: "#94a3b8" }}>No {PART_KIND_LABEL[kind].toLowerCase()} parts yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function usageCounts(h: Harness): Map<string, number> {
  const m = new Map<string, number>();
  const inc = (id?: string) => { if (id) m.set(id, (m.get(id) ?? 0) + 1); };
  for (const k of ["connectors", "terminals", "splices", "diodes", "resistors", "wires", "cables"] as const) for (const el of h[k] as any[]) inc(el.partId);
  for (const t of h.twistedWires) for (const w of t.wires) inc(w.partId);
  for (const b of [...h.bundles, ...h.branchPoints]) for (const p of b.partIds ?? []) inc(p);
  for (const c of h.connectors) for (const cv of c.cavities) { inc(cv.contactPartId); inc(cv.cavityPlugPartId); inc(cv.cavitySealPartId ?? undefined); }
  return m;
}

const CONNECTOR_ACCESSORIES: AccessoryType[] = ["ContactPart", "CavityPlugPart", "CavitySealPart", "LockPart", "DustCoverPart", "BackshellPart", "BootPart", "MountPart", "CoveringPart"];

function ConfigurationsEditor({ part, kind }: { part: { id: string; configurations?: { id: string; name?: string; accessories?: any[] }[] }; kind: PartKind }) {
  const h = useStore((s) => s.h);
  const update = useStore((s) => s.update);
  const types: AccessoryType[] = kind === "connectorParts" ? CONNECTOR_ACCESSORIES : ["BootPart", "CoveringPart"];
  const edit = (fn: (p: any, d: Harness) => void) => update((d) => { const p = (d[kind] as any[]).find((x) => x.id === part.id); if (p) fn(p, d); });
  const cfgs = part.configurations ?? [];
  return (
    <div style={{ padding: "6px 4px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <b>Configurations</b>
        <span className="hint-text">Accessories are applied automatically to every component using the configuration. Contacts load into connected cavities and plugs into empty ones, first matching rule wins.</span>
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={() => edit((p, d) => { p.configurations = [...(p.configurations ?? []), { id: makeIdFactory(d)(), name: (p.configurations?.length ?? 0) ? `Configuration ${(p.configurations?.length ?? 0) + 1}` : undefined, accessories: [] }]; })}>+ Add configuration</button>
      </div>
      {!cfgs.length && <div className="hint-text">No configurations.</div>}
      {cfgs.map((cfg, ci) => (
        <div key={cfg.id} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 8, marginBottom: 8, background: "#fff" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            {ci === 0 ? <b style={{ width: 200 }}>Default configuration</b> : <span style={{ width: 200 }}><TextInput value={cfg.name} placeholder="Name" onCommit={(v) => edit((p) => { p.configurations[ci].name = v; })} /></span>}
            <select className="select" style={{ width: 170 }} value="" onChange={(e) => { const t = e.target.value as AccessoryType; if (t) edit((p, d) => { const c = p.configurations[ci]; c.accessories = [...(c.accessories ?? []), { id: makeIdFactory(d)(), type: t }]; }); }}>
              <option value="">+ Add accessory…</option>
              {types.map((t) => <option key={t} value={t}>{PART_KIND_LABEL[ACCESSORY_KIND[t]]}</option>)}
            </select>
            <button className="btn small" onClick={() => edit((p, d) => { const copy = JSON.parse(JSON.stringify(p.configurations[ci])); copy.id = makeIdFactory(d)(); copy.name = `${cfg.name ?? "Default"} copy`; copy.accessories = (copy.accessories ?? []).map((x: any) => ({ ...x, id: makeIdFactory(d)() })); p.configurations.push(copy); })}>Duplicate</button>
            {ci > 0 && <button className="btn small danger" onClick={() => edit((p) => { p.configurations.splice(ci, 1); })}>Delete</button>}
          </div>
          <table className="mini-table">
            <tbody>
              {(cfg.accessories ?? []).map((acc, ai) => {
                const pk = ACCESSORY_KIND[acc.type as AccessoryType];
                const options = (h[pk] as PartBase[]) ?? [];
                const isCavity = ["ContactPart", "CavityPlugPart"].includes(acc.type);
                return (
                  <tr key={acc.id}>
                    <td style={{ width: 110 }}>{PART_KIND_LABEL[pk]}</td>
                    <td style={{ width: 220 }}>
                      <select className="select" value={acc.partId ?? ""} onChange={(e) => edit((p) => { const a = p.configurations[ci].accessories[ai]; if (e.target.value) a.partId = e.target.value; else delete a.partId; })}>
                        <option value="">— choose part —</option>
                        {options.map((o) => <option key={o.id} value={o.id}>{partName(o)}</option>)}
                      </select>
                    </td>
                    <td>
                      {isCavity && (
                        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <select className="select" style={{ width: 130 }} value={acc.rule?.apply ?? (acc.type === "ContactPart" ? "connected" : "unconnected")} onChange={(e) => edit((p) => { const a = p.configurations[ci].accessories[ai]; a.rule = { ...(a.rule ?? {}), apply: e.target.value }; })}>
                            <option value="connected">Connected cavities</option><option value="unconnected">Empty cavities</option><option value="never">Never (manual)</option>
                          </select>
                          {acc.type === "ContactPart" && (
                            <label className="check"><input type="checkbox" checked={!!acc.rule?.gaugeFromPart} onChange={(e) => edit((p) => { const a = p.configurations[ci].accessories[ai]; a.rule = { ...(a.rule ?? {}), gaugeFromPart: e.target.checked || undefined }; })} /> only if gauge fits</label>
                          )}
                        </span>
                      )}
                    </td>
                    <td style={{ width: 30 }}><button className="btn small danger" onClick={() => edit((p) => { p.configurations[ci].accessories.splice(ai, 1); })}>✕</button></td>
                  </tr>
                );
              })}
              {!(cfg.accessories ?? []).length && <tr><td className="hint-text">No accessories.</td></tr>}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function CoresEditor({ part }: { part: CablePart }) {
  const h = useStore((s) => s.h);
  const update = useStore((s) => s.update);
  const edit = (fn: (p: CablePart, d: Harness) => void) => update((d) => { const p = d.cableParts.find((x) => x.id === part.id); if (p) fn(p, d); });
  return (
    <div style={{ padding: "6px 4px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <b>Cores</b>
        <button className="btn small" disabled={(part.cores?.length ?? 0) >= 64} onClick={() => edit((p, d) => { p.cores = [...(p.cores ?? []), { id: makeIdFactory(d)(), color: "Black" }]; })}>+ Add core</button>
        <span className="hint-text">Cables using this part take their core colours and twisting from here.</span>
      </div>
      <table className="mini-table" style={{ maxWidth: 640 }}>
        <thead><tr><th>#</th><th>Color</th><th>Stripe</th><th>Gauge</th><th>Twisted with next</th><th /></tr></thead>
        <tbody>
          {(part.cores ?? []).map((k, i) => (
            <tr key={k.id}>
              <td>{i + 1}</td>
              <td><ColorSelect value={k.color} onChange={(c) => edit((p) => { p.cores![i].color = c ?? "Black"; })} /></td>
              <td><ColorSelect value={k.stripeColor} allowNone onChange={(c) => edit((p) => { if (c) p.cores![i].stripeColor = c; else delete p.cores![i].stripeColor; })} /></td>
              <td style={{ width: 110 }}><GaugeInput value={k.gauge} unit={h.gaugeUnit} onCommit={(g) => edit((p) => { if (g) p.cores![i].gauge = g; else delete p.cores![i].gauge; })} /></td>
              <td><input type="checkbox" disabled={i === (part.cores?.length ?? 0) - 1} checked={!!k.twistedWithNext} onChange={(e) => edit((p) => { if (e.target.checked) p.cores![i].twistedWithNext = true; else delete p.cores![i].twistedWithNext; })} /></td>
              <td><button className="btn small danger" onClick={() => edit((p) => { p.cores!.splice(i, 1); })}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BomTable() {
  const h = useStore((s) => s.h);
  const fileName = useStore((s) => s.fileName);
  const select = useStore((s) => s.select);
  const { a } = analysisOf(h);
  const rows = useMemo(() => buildBom(h, a), [h, a]);
  const total = bomTotal(rows);
  return (
    <div className="table-view">
      <div className="table-toolbar">
        <h2>Bill of materials</h2>
        <span className="hint-text">Wire and cable lengths come from routing through bundles; cut-to-length coverings take the bundle length.</span>
        <span style={{ flex: 1 }} />
        <b>Total {h.currency}{total.toFixed(2)}</b>
        <button className="btn" onClick={() => downloadText(bomToCsv(h, rows), fileName.replace(/\.harness$/, "") + " - BOM.csv", "text/csv")}>Export CSV</button>
      </div>
      <table className="data-table">
        <thead><tr><th>Type</th><th>Part number</th><th>Manufacturer</th><th>Description</th><th className="num">Qty</th><th>Unit</th><th className="num">Unit price</th><th className="num">Total</th><th>Used by</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.partId} onClick={() => select([r.partId])}>
              <td><span className="badge">{PART_KIND_LABEL[r.kind]}</span></td>
              <td className="mono">
                {r.part.color && <span className="cell-swatch" style={{ background: colorHex(r.part.color), marginRight: 6 }} />}
                <b>{r.part.partNumber || <i className="hint-text">no part number</i>}</b>
                {r.part.internalPartNumber && <span className="hint-text"> [{r.part.internalPartNumber}]</span>}
              </td>
              <td>{r.part.manufacturer}</td>
              <td>{r.part.description}</td>
              <td className="num">{r.quantity}{r.incomplete && <span title="Some uses have no known length" style={{ color: "#d97706" }}> +?</span>}</td>
              <td>{r.unit}</td>
              <td className="num">{r.unitPrice !== undefined ? `${h.currency}${r.unitPrice.toFixed(r.unit === "ea" ? 2 : 4)}` : "—"}</td>
              <td className="num">{r.total !== undefined ? `${h.currency}${r.total.toFixed(2)}` : "—"}</td>
              <td className="hint-text" style={{ whiteSpace: "normal", maxWidth: 260 }}>{r.usedBy.join(", ")}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={9} style={{ textAlign: "center", padding: 30, color: "#94a3b8" }}>Assign parts to components to build the bill of materials.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

