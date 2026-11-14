import type { ReactNode } from "react";
import { type Analysis, endpointLabel, findPart, nameOf, twistedWith } from "../model/analysis";
import { buildBom, bomTotal } from "../model/bom";
import { colorHex } from "../model/colors";
import { wiringTable } from "../model/connections";
import {
  addSpliceOnWires, assignPart, deleteElements, findConductor, makeCable, partKindForElement, setCableCoreCount, setCavityCount,
  toggleShell, twistTogether,
} from "../model/ops";
import type { Cable, Connector, ConnectorPart, Harness, PartKind, TwistedWires } from "../model/types";
import { PART_KINDS, PART_KIND_LABEL, TERMINAL_TYPES } from "../model/types";
import { formatLength, formatMm2 } from "../model/units";
import { type Issue, cavityLoad, partName } from "../model/validation";
import { useStore } from "../store";
import { createPartFrom, selectNetOfSelection, terminalLabel } from "./actions";
import { ColorSelect, Field, LengthInput, PartSelect, Stepper, TextInput } from "./controls";
import { useAnalysis } from "./hooks";

const st = () => useStore.getState();

function editEl(kind: keyof Harness, id: string, fn: (el: any) => void) {
  st().update((d) => { const el = (d[kind] as any[]).find((x) => x.id === id); if (el) fn(el); });
}

export function Inspector() {
  const { h, a, issues } = useAnalysis();
  const selection = useStore((s) => s.selection);
  const ids = selection.filter((id) => a.elements.has(id) || a.conductorById.has(id) || partKindOf(h, id));
  if (!ids.length) return <Overview h={h} a={a} issues={issues} />;
  if (ids.length > 1) return <MultiSelection h={h} a={a} ids={ids} />;
  const id = ids[0];
  const mine = issues.filter((i) => i.targetIds.includes(id));
  let body: ReactNode = null;
  const cond = a.conductorById.get(id);
  const ref = a.elements.get(id);
  const pk = partKindOf(h, id);
  if (cond) body = <ConductorPanel h={h} a={a} id={id} />;
  else if (ref?.kind === "connectors") body = <ConnectorPanel h={h} a={a} c={ref.el} />;
  else if (ref?.kind === "terminals") body = <TerminalPanel h={h} a={a} id={id} />;
  else if (ref && ["splices", "diodes", "resistors"].includes(ref.kind)) body = <InlinePanel h={h} a={a} id={id} kind={ref.kind as any} />;
  else if (ref?.kind === "cables" || ref?.kind === "twistedWires") body = <GroupPanel h={h} a={a} el={ref.el} kind={ref.kind} />;
  else if (ref?.kind === "bundles") body = <BundlePanel h={h} a={a} id={id} />;
  else if (ref?.kind === "branchPoints") body = <BranchPointPanel h={h} a={a} id={id} />;
  else if (ref?.kind === "mates") body = <MatePanel h={h} a={a} id={id} />;
  else if (ref?.kind === "schematicNotes" || ref?.kind === "layoutNotes") body = <NotePanel kind={ref.kind} id={id} el={ref.el} />;
  else if (pk) body = <PartPanel h={h} kind={pk} id={id} />;
  return (
    <>
      {body}
      {mine.length > 0 && (
        <section className="panel-section">
          <h3>Issues</h3>
          {mine.map((i, k) => <IssueRow key={k} issue={i} />)}
        </section>
      )}
    </>
  );
}

function partKindOf(h: Harness, id: string): PartKind | undefined {
  return PART_KINDS.find((k) => (h[k] as any[]).some((p) => p.id === id));
}

function Title({ icon, text, sub, onDelete }: { icon: string; text: string; sub?: string; onDelete?: () => void }) {
  return (
    <section className="panel-section">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="panel-title"><span>{icon}</span><span>{text}</span></div>
        {sub && <span className="badge">{sub}</span>}
        <span style={{ flex: 1 }} />
        {onDelete && <button className="btn small danger" onClick={onDelete} title="Delete (Del)">Delete</button>}
      </div>
    </section>
  );
}

const del = (id: string) => () => { st().update((d) => deleteElements(d, [id])); st().select([]); };

function PartField({ h, id, kind }: { h: Harness; id: string; kind: string }) {
  const pk = partKindForElement(kind)!;
  const el = (h as any)[kind]?.find?.((x: any) => x.id === id) ?? findConductor(h, id);
  return (
    <Field label="Part">
      <PartSelect parts={h[pk] as any[]} value={el?.partId} onChange={(pid) => st().update((d) => assignPart(d, id, pid))} onCreate={() => createPartFrom(id, kind)} />
    </Field>
  );
}

function ConnectorPanel({ h, a, c }: { h: Harness; a: Analysis; c: Connector }) {
  const part = findPart<ConnectorPart>(h, "connectorParts", c.partId);
  const rows = wiringTable(h, a, c.id);
  const cfgs = part?.configurations ?? [];
  const contactOptions = h.contactParts;
  return (
    <>
      <Title icon="▭" text={nameOf(a, c.id)} sub={a.displayIds.get(c.id)} onDelete={del(c.id)} />
      <section className="panel-section">
        <Field label="Label"><TextInput value={c.label} placeholder={a.displayIds.get(c.id)} onCommit={(v) => editEl("connectors", c.id, (x) => { if (v.trim()) x.label = v.trim(); else delete x.label; })} /></Field>
        <PartField h={h} id={c.id} kind="connectors" />
        {cfgs.length > 1 && (
          <Field label="Configuration">
            <select className="select" value={c.configurationId ?? cfgs[0].id} onChange={(e) => editEl("connectors", c.id, (x) => { x.configurationId = e.target.value; })}>
              {cfgs.map((cfg, i) => <option key={cfg.id} value={cfg.id}>{cfg.name || (i === 0 ? "Default" : cfg.id)}</option>)}
            </select>
          </Field>
        )}
        <Field label="Cavities"><Stepper value={c.cavities.length} min={1} max={256} onChange={(n) => st().update((d) => setCavityCount(d, c.id, n))} /></Field>
        <Field label="Options">
          <div className="btn-row">
            <label className="check"><input type="checkbox" checked={!!c.shell} onChange={() => st().update((d) => toggleShell(d, c.id))} /> Shell</label>
            <label className="check"><input type="checkbox" checked={!!c.rotated} onChange={(e) => editEl("connectors", c.id, (x) => { x.rotated = e.target.checked || undefined; })} /> Rotated</label>
            <label className="check"><input type="checkbox" checked={!!c.excludeFromBom} onChange={(e) => editEl("connectors", c.id, (x) => { x.excludeFromBom = e.target.checked || undefined; })} /> Exclude from BOM</label>
          </div>
        </Field>
        <Field label="Width"><Stepper value={(c.width ?? 150) / 30} min={2} max={12} onChange={(n) => editEl("connectors", c.id, (x) => { x.width = n * 30; })} /></Field>
        {part && <div className="hint-text">{part.gender ?? "No gender"} · {part.numberOfCavities ?? "?"} cavities{part.hasShell ? " · shell" : ""}{part.manufacturer ? ` · ${part.manufacturer}` : ""}</div>}
      </section>
      <section className="panel-section">
        <h3>Cavities <span className="hint-text" style={{ textTransform: "none", letterSpacing: 0 }}>paste a column of signals into any field</span></h3>
        <table className="mini-table">
          <thead><tr><th>#</th><th>Signal</th><th>Contact</th><th>N/C</th></tr></thead>
          <tbody>
            {[...c.cavities, ...(c.shell ? [c.shell] : [])].map((cv, i) => {
              const load = cavityLoad(h, a, c, cv);
              const inherited = a.effectiveSignal.get(`${c.id}::${cv.id}`);
              return (
                <tr key={cv.id}>
                  <td><b>{cv === c.shell ? "Shell" : a.designations.get(cv.id)}</b></td>
                  <td>
                    <SignalInput value={cv.signal} placeholder={cv.notConnected ? "N/C" : inherited ?? ""} onCommit={(v) => editEl("connectors", c.id, (x: Connector) => { const t = cv === c.shell ? x.shell! : x.cavities[i]; if (v.trim()) t.signal = v.trim(); else delete t.signal; })}
                      onPasteLines={(lines) => st().update((d) => { const x = d.connectors.find((k) => k.id === c.id)!; let k = i; for (const line of lines) { while (k < x.cavities.length && x.cavities[k].notConnected) k++; if (k >= x.cavities.length) break; if (line.trim()) x.cavities[k].signal = line.trim(); k++; } })} />
                  </td>
                  <td>
                    <select className="select" title={load.fromConfiguration ? "From the part configuration" : ""} value={cv.contactPartId ?? ""} onChange={(e) => editEl("connectors", c.id, (x: Connector) => { const t = cv === c.shell ? x.shell! : x.cavities[i]; if (e.target.value) { t.contactPartId = e.target.value; delete t.cavityPlugPartId; } else delete t.contactPartId; })}>
                      <option value="">{load.contact ? `${partName(load.contact)} (auto)` : load.plug ? `${partName(load.plug)} (plug)` : "—"}</option>
                      {contactOptions.map((p) => <option key={p.id} value={p.id}>{partName(p)}</option>)}
                    </select>
                  </td>
                  <td><input type="checkbox" checked={!!cv.notConnected} disabled={(a.connections.get(`${c.id}::${cv.id}`) ?? []).length > 0} onChange={(e) => editEl("connectors", c.id, (x: Connector) => { const t = cv === c.shell ? x.shell! : x.cavities[i]; if (e.target.checked) t.notConnected = true; else delete t.notConnected; })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <WiringTableSection rows={rows} />
    </>
  );
}

function SignalInput({ value, placeholder, onCommit, onPasteLines }: { value?: string; placeholder?: string; onCommit: (v: string) => void; onPasteLines: (lines: string[]) => void }) {
  return (
    <input className="input" key={value ?? ""} defaultValue={value ?? ""} placeholder={placeholder}
      onBlur={(e) => { if (e.target.value !== (value ?? "")) onCommit(e.target.value); }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      onPaste={(e) => { const lines = e.clipboardData.getData("text").split(/\r?\n/); if (lines.length > 1) { e.preventDefault(); onPasteLines(lines); } }} />
  );
}

function WiringTableSection({ rows }: { rows: ReturnType<typeof wiringTable> }) {
  if (!rows.length) return null;
  return (
    <section className="panel-section">
      <h3>Wiring table</h3>
      <table className="mini-table">
        <thead><tr><th>Cav</th><th>Signal</th><th>Destination</th><th>Wire</th><th>Color</th><th>Length</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ opacity: r.wire ? 1 : 0.5 }}>
              <td>{r.cavity}</td><td>{r.signal}</td><td>{r.destination}</td><td className="mono">{r.wire}</td><td>{r.color}</td><td>{r.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TerminalPanel({ h, a, id }: { h: Harness; a: Analysis; id: string }) {
  const t = h.terminals.find((x) => x.id === id)!;
  const gauge = (a.connections.get(`${id}::Terminal`) ?? []).reduce<number | undefined>((s, cid) => { const g = a.conductorById.get(cid)?.gaugeMm2; return s === undefined || g === undefined ? undefined : s + g; }, 0);
  return (
    <>
      <Title icon="◎" text={nameOf(a, id)} sub={a.displayIds.get(id)} onDelete={del(id)} />
      <section className="panel-section">
        <Field label="Label"><TextInput value={t.label} placeholder={a.displayIds.get(id)} onCommit={(v) => editEl("terminals", id, (x) => { if (v.trim()) x.label = v.trim(); else delete x.label; })} /></Field>
        <Field label="Type">
          <select className="select" value={t.type} onChange={(e) => editEl("terminals", id, (x) => { x.type = e.target.value; })}>
            {TERMINAL_TYPES.map((tt) => <option key={tt} value={tt}>{terminalLabel(tt)}</option>)}
          </select>
        </Field>
        <Field label="Signal"><TextInput value={t.signal} placeholder={a.effectiveSignal.get(`${id}::Terminal`)} onCommit={(v) => editEl("terminals", id, (x) => { if (v.trim()) x.signal = v.trim(); else delete x.signal; })} /></Field>
        <PartField h={h} id={id} kind="terminals" />
        <Field label="Width"><Stepper value={(t.width ?? 150) / 30} min={2} max={12} onChange={(n) => editEl("terminals", id, (x) => { x.width = n * 30; })} /></Field>
        <Field label="Options"><label className="check"><input type="checkbox" checked={!!t.rotated} onChange={(e) => editEl("terminals", id, (x) => { x.rotated = e.target.checked || undefined; })} /> Rotated</label></Field>
        <div className="hint-text">{(a.connections.get(`${id}::Terminal`) ?? []).length} connected · total {formatMm2(gauge, h.gaugeUnit)}</div>
      </section>
      <WiringTableSection rows={wiringTable(h, a, id)} />
    </>
  );
}

function InlinePanel({ h, a, id, kind }: { h: Harness; a: Analysis; id: string; kind: "splices" | "diodes" | "resistors" }) {
  const el = (h[kind] as any[]).find((x) => x.id === id);
  const physical = [...h.connectors, ...h.terminals, ...h.branchPoints];
  const auto = a.inlineLocation.get(id);
  const icon = kind === "splices" ? "●" : kind === "diodes" ? "▷|" : "⌇";
  return (
    <>
      <Title icon={icon} text={nameOf(a, id)} sub={a.displayIds.get(id)} onDelete={del(id)} />
      <section className="panel-section">
        <Field label="Label"><TextInput value={el.label} placeholder={a.displayIds.get(id)} onCommit={(v) => editEl(kind, id, (x) => { if (v.trim()) x.label = v.trim(); else delete x.label; })} /></Field>
        <PartField h={h} id={id} kind={kind} />
        <Field label="Location">
          <select className="select" value={el.locationId ?? ""} onChange={(e) => editEl(kind, id, (x) => { if (e.target.value) x.locationId = e.target.value; else delete x.locationId; })}>
            <option value="">Automatic{auto && !el.locationId ? ` (${nameOf(a, auto)})` : ""}</option>
            {physical.map((p) => <option key={p.id} value={p.id}>{nameOf(a, p.id)}</option>)}
          </select>
        </Field>
        {kind === "diodes" && <Field label="Anode"><label className="check"><input type="checkbox" checked={!!el.anodeOnRight} onChange={(e) => editEl(kind, id, (x) => { x.anodeOnRight = e.target.checked || undefined; })} /> Anode on right</label></Field>}
        {kind !== "splices" && <Field label="Options"><label className="check"><input type="checkbox" checked={!!el.rotated} onChange={(e) => editEl(kind, id, (x) => { x.rotated = e.target.checked || undefined; })} /> Rotated</label></Field>}
        <div className="hint-text">Inline components are placed where they minimise wire length unless a location is set.</div>
      </section>
      <WiringTableSection rows={wiringTable(h, a, id)} />
    </>
  );
}

function ConductorPanel({ h, a, id }: { h: Harness; a: Analysis; id: string }) {
  const c = a.conductorById.get(id)!;
  const route = a.routes.get(id);
  const net = a.netOfConductor.get(id);
  const isWire = c.kind === "wire" || c.kind === "twisted";
  const raw = findConductor(h, id)!;
  const setW = (fn: (w: any) => void) => st().update((d) => { const w = findConductor(d, id); if (w) fn(w); });
  const tw = twistedWith(a, h, c);
  return (
    <>
      <Title icon="⟋" text={c.displayId} sub={c.kind === "wire" ? "Wire" : c.kind === "twisted" ? "Twisted wire" : c.kind === "shield" ? "Shield" : "Cable core"} onDelete={c.kind === "wire" ? del(id) : undefined} />
      <section className="panel-section">
        <Field label="From">{endpointLabel(a, c.source)}</Field>
        <Field label="To">{endpointLabel(a, c.target)}</Field>
        <Field label="Net"><span>{net?.name ?? "—"} <button className="btn small" onClick={selectNetOfSelection}>Select net</button></span></Field>
        <Field label="Length">
          {route?.noRoute ? <span className="badge error">NO ROUTE</span> : route ? <span>{formatLength(route.lengthMm, h.lengthUnit)} {route.estimated && <span className="badge warning" title="A bundle on the route has no length; its drawn length was used">estimated</span>}</span> : "—"}
        </Field>
        {route && !route.noRoute && route.bundleIds.length > 0 && <Field label="Route"><span className="hint-text">{route.nodeIds.map((n) => nameOf(a, n)).join(" → ")}</span></Field>}
        <Field label="Gauge">{formatMm2(c.gaugeMm2, h.gaugeUnit)}</Field>
        {tw.length > 0 && <Field label="Twisted with">{tw.join(", ")}</Field>}
      </section>
      <section className="panel-section">
        {isWire && <PartField h={h} id={id} kind="wires" />}
        <Field label="Color"><ColorSelect value={raw.color} onChange={(col) => setW((w) => { w.color = col ?? "Black"; if (w.partId) delete w.partId; })} /></Field>
        <Field label="Stripe"><ColorSelect value={raw.stripeColor} allowNone onChange={(col) => setW((w) => { if (col) w.stripeColor = col; else delete w.stripeColor; if (w.partId) delete w.partId; })} /></Field>
        <Field label="Ident label"><TextInput value={raw.identLabel} placeholder="e.g. 12V" onCommit={(v) => setW((w) => { if (v.trim()) w.identLabel = v.trim(); else delete w.identLabel; })} /></Field>
        <Field label="Ident bands">
          <span style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            {(raw.identColors ?? []).map((col, i) => <button key={i} className="swatch" title={`${col} (click to remove)`} style={{ background: colorHex(col) }} onClick={() => setW((w) => { w.identColors.splice(i, 1); if (!w.identColors.length) delete w.identColors; })} />)}
            <select className="select" style={{ width: 90 }} value="" onChange={(e) => e.target.value && setW((w) => { w.identColors = [...(w.identColors ?? []), e.target.value]; })}>
              <option value="">+ band</option>
              {["Black", "Brown", "Red", "Orange", "Yellow", "Green", "Blue", "Violet", "Gray", "White"].map((x) => <option key={x}>{x}</option>)}
            </select>
          </span>
        </Field>
        {c.kind === "wire" && <Field label="BOM"><label className="check"><input type="checkbox" checked={!!(raw as any).excludeFromBom} onChange={(e) => setW((w) => { w.excludeFromBom = e.target.checked || undefined; })} /> Exclude from BOM</label></Field>}
        {c.kind === "core" && <div className="hint-text">Core colour and gauge follow the cable part when one is assigned.</div>}
      </section>
    </>
  );
}

function GroupPanel({ h, a, el, kind }: { h: Harness; a: Analysis; el: Cable | TwistedWires; kind: "cables" | "twistedWires" }) {
  const isCable = kind === "cables";
  const items = isCable ? [...(el as Cable).cores, ...((el as Cable).shield ? [(el as Cable).shield!] : [])] : (el as TwistedWires).wires;
  return (
    <>
      <Title icon={isCable ? "≡" : "∞"} text={nameOf(a, el.id)} sub={a.displayIds.get(el.id)} onDelete={del(el.id)} />
      <section className="panel-section">
        <Field label="Label"><TextInput value={el.label} placeholder={a.displayIds.get(el.id)} onCommit={(v) => editEl(kind, el.id, (x) => { if (v.trim()) x.label = v.trim(); else delete x.label; })} /></Field>
        {isCable && <PartField h={h} id={el.id} kind="cables" />}
        {isCable && <Field label="Cores"><Stepper value={(el as Cable).cores.length} min={1} max={64} onChange={(n) => st().update((d) => setCableCoreCount(d, el.id, n))} /></Field>}
        {isCable && <Field label="Shield"><label className="check"><input type="checkbox" checked={!!(el as Cable).shield} onChange={() => editEl("cables", el.id, (x) => { if (x.shield) delete x.shield; else x.shield = { id: `${x.id}-shield`, color: "Shield" }; })} /> Shielded</label></Field>}
        {isCable && <Field label="Length">{formatLength(a.cableLengthMm.get(el.id), h.lengthUnit)}</Field>}
        <div className="hint-text">Drag from a component handle to a core's end to connect it.</div>
      </section>
      <section className="panel-section">
        <h3>{isCable ? "Cores" : "Wires"}</h3>
        <table className="mini-table">
          <thead><tr><th>ID</th><th>Color</th><th>From</th><th>To</th><th>Length</th></tr></thead>
          <tbody>
            {items.map((k) => {
              const c = a.conductorById.get(k.id)!;
              return (
                <tr key={k.id} style={{ cursor: "pointer" }} onClick={() => st().select([k.id])}>
                  <td className="mono">{c.displayId}</td>
                  <td><span className="cell-swatch" style={{ background: colorHex(k.color) }} /></td>
                  <td>{endpointLabel(a, k.source)}</td>
                  <td>{endpointLabel(a, k.target)}</td>
                  <td>{a.routes.get(k.id)?.noRoute ? "—" : formatLength(a.routes.get(k.id)?.lengthMm, h.lengthUnit)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

function BundlePanel({ h, a, id }: { h: Harness; a: Analysis; id: string }) {
  const b = h.bundles.find((x) => x.id === id)!;
  const inside = a.conductorsInBundle.get(id) ?? [];
  return (
    <>
      <Title icon="⌇" text={b.label || a.displayIds.get(id) || "Bundle"} sub={a.displayIds.get(id)} onDelete={del(id)} />
      <section className="panel-section">
        <Field label="Between">{nameOf(a, b.sourceId)} ↔ {nameOf(a, b.targetId)}</Field>
        <Field label="Length"><LengthInput value={b.length} unit={h.lengthUnit} onCommit={(l) => editEl("bundles", id, (x) => { if (l) x.length = l; else delete x.length; })} /></Field>
        <Field label="Label"><TextInput value={b.label} placeholder="e.g. Main trunk" onCommit={(v) => editEl("bundles", id, (x) => { if (v.trim()) x.label = v.trim(); else delete x.label; })} /></Field>
        <Field label="Label color"><ColorSelect value={b.labelColor} allowNone onChange={(c) => editEl("bundles", id, (x) => { if (c) x.labelColor = c; else delete x.labelColor; })} /></Field>
        <Field label="Diameter">≈ {(a.bundleDiameterMm.get(id) ?? 0).toFixed(1)} mm</Field>
        <div className="hint-text">Lengths accept calculations, e.g. <code>40 + 30 + 40</code>, <code>5' 3"</code> or <code>(10 + 20) cm</code>.</div>
      </section>
      <section className="panel-section">
        <h3>Coverings</h3>
        {(b.partIds ?? []).map((pid, i) => {
          const p = findPart(h, "coveringParts", pid);
          return (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              {p?.color && <span className="cell-swatch" style={{ background: colorHex(p.color) }} />}
              <span style={{ flex: 1 }}>{p ? partName(p) : pid}<span className="hint-text"> {p?.type}</span></span>
              <button className="btn small danger" onClick={() => editEl("bundles", id, (x) => { x.partIds.splice(i, 1); })}>✕</button>
            </div>
          );
        })}
        <PartSelect parts={h.coveringParts} value={undefined} placeholder="+ Add covering…" onChange={(pid) => pid && editEl("bundles", id, (x) => { x.partIds = [...(x.partIds ?? []), pid]; })} />
      </section>
      <section className="panel-section">
        <h3>Conductors inside ({inside.length})</h3>
        <div className="btn-row">
          {inside.map((cid) => { const c = a.conductorById.get(cid)!; return <button key={cid} className="btn small" onClick={() => st().select([cid])}><span className="cell-swatch" style={{ background: colorHex(c.color), width: 12 }} />{c.displayId}</button>; })}
          {!inside.length && <span className="hint-text">No wires route through this bundle yet.</span>}
        </div>
      </section>
    </>
  );
}

function BranchPointPanel({ h, a, id }: { h: Harness; a: Analysis; id: string }) {
  const b = h.branchPoints.find((x) => x.id === id)!;
  const parts = [...h.bootParts, ...h.coveringParts];
  return (
    <>
      <Title icon="◉" text={nameOf(a, id)} sub={a.displayIds.get(id)} onDelete={del(id)} />
      <section className="panel-section">
        <Field label="Label"><TextInput value={b.label} placeholder={a.displayIds.get(id)} onCommit={(v) => editEl("branchPoints", id, (x) => { if (v.trim()) x.label = v.trim(); else delete x.label; })} /></Field>
        <Field label="Bundles">{h.bundles.filter((x) => x.sourceId === id || x.targetId === id).length}</Field>
        <div className="hint-text">Deleting a branch point that joins two bundles merges them and sums their lengths. Drag one branch point onto another to merge.</div>
      </section>
      <section className="panel-section">
        <h3>Boots & coverings</h3>
        {(b.partIds ?? []).map((pid, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <span style={{ flex: 1 }}>{partName((findPart(h, "bootParts", pid) ?? findPart(h, "coveringParts", pid) ?? { id: pid }) as any)}</span>
            <button className="btn small danger" onClick={() => editEl("branchPoints", id, (x) => { x.partIds.splice(i, 1); })}>✕</button>
          </div>
        ))}
        <PartSelect parts={parts} value={undefined} placeholder="+ Add boot or covering…" onChange={(pid) => pid && editEl("branchPoints", id, (x) => { x.partIds = [...(x.partIds ?? []), pid]; })} />
      </section>
    </>
  );
}

function MatePanel({ h, a, id }: { h: Harness; a: Analysis; id: string }) {
  const m = h.mates.find((x) => x.id === id)!;
  const target = h.connectors.find((c) => c.id === m.targetId);
  const sourceIsTerminal = h.terminals.some((t) => t.id === m.sourceId);
  return (
    <>
      <Title icon="⇄" text="Mate" onDelete={del(id)} />
      <section className="panel-section">
        <Field label="Source">{nameOf(a, m.sourceId)}</Field>
        <Field label="Target">{nameOf(a, m.targetId)}</Field>
        {sourceIsTerminal && target && (
          <Field label="Into cavity">
            <select className="select" value={m.targetCavityId ?? ""} onChange={(e) => editEl("mates", id, (x) => { x.targetCavityId = e.target.value; })}>
              {target.cavities.map((cv) => <option key={cv.id} value={cv.id}>{a.designations.get(cv.id)}</option>)}
            </select>
          </Field>
        )}
        <div className="hint-text">Mated connectors join cavity-for-cavity onto the same nets. Cavity counts must match and part genders must be opposite.</div>
      </section>
    </>
  );
}

function NotePanel({ kind, id, el }: { kind: "schematicNotes" | "layoutNotes"; id: string; el: any }) {
  return (
    <>
      <Title icon="✎" text="Note" onDelete={del(id)} />
      <section className="panel-section">
        <Field label="Text"><TextInput multiline value={el.text} onCommit={(v) => editEl(kind, id, (x) => { x.text = v; })} /></Field>
        <Field label="Color"><ColorSelect value={el.color} onChange={(c) => editEl(kind, id, (x) => { x.color = c; })} /></Field>
        <Field label="Width"><Stepper value={(el.width ?? 150) / 30} min={2} max={12} onChange={(n) => editEl(kind, id, (x) => { x.width = n * 30; })} /></Field>
      </section>
    </>
  );
}

function PartPanel({ h, kind, id }: { h: Harness; kind: PartKind; id: string }) {
  const p = (h[kind] as any[]).find((x) => x.id === id);
  return (
    <>
      <Title icon="⬢" text={partName(p)} sub={PART_KIND_LABEL[kind]} onDelete={del(id)} />
      <section className="panel-section">
        <Field label="Part number"><TextInput value={p.partNumber} onCommit={(v) => editEl(kind, id, (x) => { x.partNumber = v; })} /></Field>
        <Field label="Internal no."><TextInput value={p.internalPartNumber} onCommit={(v) => editEl(kind, id, (x) => { if (v) x.internalPartNumber = v; else delete x.internalPartNumber; })} /></Field>
        <Field label="Manufacturer"><TextInput value={p.manufacturer} onCommit={(v) => editEl(kind, id, (x) => { x.manufacturer = v; })} /></Field>
        <Field label="Description"><TextInput value={p.description} onCommit={(v) => editEl(kind, id, (x) => { x.description = v; })} /></Field>
        <Field label="URL"><TextInput value={p.url} placeholder="Datasheet link" onCommit={(v) => editEl(kind, id, (x) => { if (v) x.url = v; else delete x.url; })} /></Field>
        <div className="hint-text">Components using this part are highlighted in the other views.</div>
      </section>
    </>
  );
}

function MultiSelection({ h, a, ids }: { h: Harness; a: Analysis; ids: string[] }) {
  const wireIds = ids.filter((id) => h.wires.some((w) => w.id === id));
  const allWires = ids.filter((id) => a.conductorById.get(id)?.kind === "wire" || a.conductorById.get(id)?.kind === "twisted");
  const gauge = allWires.reduce<number | undefined>((s, id) => { const g = a.conductorById.get(id)?.gaugeMm2; return s === undefined || g === undefined ? undefined : s + g; }, 0);
  const u = st().update;
  return (
    <>
      <Title icon="⧉" text={`${ids.length} selected`} onDelete={() => { u((d) => deleteElements(d, ids)); st().select([]); }} />
      {allWires.length > 0 && (
        <section className="panel-section">
          <h3>Wires ({allWires.length})</h3>
          <Field label="Total gauge">{formatMm2(gauge, h.gaugeUnit)}</Field>
          <Field label="Assign part"><PartSelect parts={h.wireParts} value={undefined} placeholder="Choose wire part…" onChange={(pid) => pid && u((d) => { for (const id of allWires) assignPart(d, id, pid); })} /></Field>
          <div className="btn-row">
            <button className="btn" disabled={!wireIds.length} onClick={() => { let id; u((d) => { id = makeCable(d, wireIds); }); if (id) st().select([id]); }}>Make cable</button>
            <button className="btn" disabled={wireIds.length < 2} onClick={() => { let id; u((d) => { id = twistTogether(d, wireIds); }); if (id) st().select([id]); }}>Twist together</button>
            <button className="btn" disabled={!wireIds.length} onClick={() => { let id; u((d) => { id = addSpliceOnWires(d, wireIds); }); if (id) st().select([id]); }}>Add splice</button>
          </div>
        </section>
      )}
      <section className="panel-section">
        <div className="btn-row">
          {ids.map((id) => <span key={id} className="badge">{a.conductorById.get(id)?.displayId ?? (a.elements.has(id) ? nameOf(a, id) : id)}</span>)}
        </div>
      </section>
    </>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <div className="issue" onClick={() => issue.targetIds.length && st().select(issue.targetIds.slice(0, 1))}>
      <span className={`dot ${issue.severity}`} />
      <span>{issue.message}</span>
    </div>
  );
}

function Overview({ h, a, issues }: { h: Harness; a: Analysis; issues: Issue[] }) {
  const bom = buildBom(h, a);
  const total = bomTotal(bom);
  const wireMm = a.conductors.reduce((s, c) => s + (a.routes.get(c.id)?.lengthMm ?? 0), 0);
  const counts = { error: 0, warning: 0, info: 0 } as Record<string, number>;
  for (const i of issues) counts[i.severity]++;
  const stats: [string, number | string][] = [
    ["Connectors", h.connectors.length], ["Terminals", h.terminals.length], ["Wires", a.conductors.length],
    ["Bundles", h.bundles.length], ["Nets", a.nets.length], ["Wire length", formatLength(wireMm, h.lengthUnit === "mm" ? "m" : h.lengthUnit)],
    ["Parts", PART_KINDS.reduce((s, k) => s + (h[k] as unknown[]).length, 0)], ["BOM cost", `${h.currency}${total.toFixed(2)}`],
  ];
  return (
    <>
      <section className="panel-section">
        <div className="panel-title">{h.title || "Untitled harness"}</div>
        <div className="hint-text" style={{ marginTop: 4 }}>{h.lengthUnit} · {h.gaugeUnit === "Metric" ? "mm²" : h.gaugeUnit} · {h.currency}{h.readOnly ? " · read-only" : ""}</div>
      </section>
      <section className="panel-section">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {stats.map(([k, v]) => (
            <div key={k} style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 10px" }}>
              <div className="hint-text">{k}</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{v}</div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel-section">
        <h3>
          Validation
          <span className="btn-row">
            <span className="badge error">{counts.error}</span><span className="badge warning">{counts.warning}</span><span className="badge info">{counts.info}</span>
          </span>
        </h3>
        {issues.length === 0 && <div className="hint-text">No issues found.</div>}
        {issues.slice(0, 80).map((i, k) => <IssueRow key={k} issue={i} />)}
        {issues.length > 80 && <div className="hint-text">…and {issues.length - 80} more</div>}
      </section>
      <section className="panel-section">
        <h3>Shortcuts</h3>
        <div className="hint-text" style={{ lineHeight: 1.8 }}>
          <b>Del</b> delete · <b>R</b> rotate · <b>I</b> component IDs · <b>S</b> select net · <b>⌘/Ctrl+Z</b> undo · <b>⌘/Ctrl+S</b> save<br />
          <b>Shift-drag</b> on canvas to marquee select · <b>⌘/Ctrl-drag</b> a handle to move its connections · <b>double-click</b> a wire or bundle to add a layout point
        </div>
      </section>
    </>
  );
}
