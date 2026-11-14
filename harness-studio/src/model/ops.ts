import { analyze, conductorsOf, endpointKey } from "./analysis";
import type {
  Bundle, Cable, CableCore, ConnectionPoint, Connector, Harness, PartKind, Pos, SplitWire, TerminalType, Wire,
} from "./types";
import { PART_KINDS } from "./types";

export const GRID = 30;
export const snap = (v: number) => Math.round(v / GRID) * GRID;
export const snapPos = (p: Pos): Pos => ({ x: snap(p.x), y: snap(p.y) });

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function allIds(h: Harness): Set<string> {
  const ids = new Set<string>();
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.id === "string") ids.add(o.id);
      for (const k of Object.keys(o)) if (k !== "extra" && typeof o[k] === "object") visit(o[k]);
    }
  };
  visit(h);
  return ids;
}

export function makeIdFactory(h: Harness) {
  const used = allIds(h);
  return (len = 4): string => {
    for (;;) {
      let s = "";
      for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      if (!used.has(s)) { used.add(s); return s; }
    }
  };
}

export type AddKind = "connector" | "terminal" | "splice" | "diode" | "resistor" | "cable" | "twistedWires" | "schematicNote" | "layoutNote" | "branchPoint";

/** Adds a component at `pos`; components that appear in both views start at the same point in each. */
export function addComponent(h: Harness, kind: AddKind, pos: Pos, opts: { terminalType?: TerminalType } = {}): string {
  const id = makeIdFactory(h);
  const p = snapPos(pos);
  const both = { schematicPosition: { ...p }, layoutPosition: { ...p } };
  switch (kind) {
    case "connector": {
      const c: Connector = { id: id(), ...both, cavities: [{ id: id() }, { id: id() }, { id: id() }, { id: id() }] };
      h.connectors.push(c);
      return c.id;
    }
    case "terminal": { const t = { id: id(), type: opts.terminalType ?? "Ring", ...both }; h.terminals.push(t); return t.id; }
    case "splice": { const s = { id: id(), ...both }; h.splices.push(s); return s.id; }
    case "diode": { const s = { id: id(), ...both }; h.diodes.push(s); return s.id; }
    case "resistor": { const s = { id: id(), ...both }; h.resistors.push(s); return s.id; }
    case "cable": {
      const c: Cable = { id: id(), schematicPosition: p, cores: [{ id: id(), color: "Red" }, { id: id(), color: "Black" }] };
      h.cables.push(c);
      return c.id;
    }
    case "twistedWires": {
      const t = { id: id(), schematicPosition: p, wires: [{ id: id(), color: "Blue" }, { id: id(), color: "White", stripeColor: "Blue" }] };
      h.twistedWires.push(t);
      return t.id;
    }
    case "schematicNote": { const n = { id: id(), text: "Note", schematicPosition: p, color: "Light Yellow", width: 150 }; h.schematicNotes.push(n); return n.id; }
    case "layoutNote": { const n = { id: id(), text: "Note", layoutPosition: p, color: "Light Yellow", width: 150 }; h.layoutNotes.push(n); return n.id; }
    case "branchPoint": { const b = { id: id(), layoutPosition: p }; h.branchPoints.push(b); return b.id; }
  }
}

/** Finds the colour and part already used on the net at `cp`, so a new wire continues it. */
function netDefaults(h: Harness, cp: ConnectionPoint): Pick<Wire, "color" | "stripeColor" | "partId"> | undefined {
  const a = analyze(h);
  const net = a.netOfEndpoint.get(endpointKey(cp));
  const existing = net?.conductors.map((id) => a.conductorById.get(id)!).find((c) => c.kind === "wire" || c.kind === "twisted");
  if (!existing) return undefined;
  return { color: existing.color, stripeColor: existing.stripeColor, partId: existing.partId };
}

export interface CoreSlot { parentId: string; coreId: string; side: "source" | "target" }

/**
 * Connects two points. Dropping onto a cable/twisted-wire core attaches that core end instead of creating a wire.
 * Returns the id of the created or changed conductor.
 */
export function connect(h: Harness, from: ConnectionPoint | CoreSlot, to: ConnectionPoint | CoreSlot): string | undefined {
  const isSlot = (x: ConnectionPoint | CoreSlot): x is CoreSlot => "coreId" in x;
  if (isSlot(from) && isSlot(to)) return undefined;
  if (isSlot(from) || isSlot(to)) {
    const slot = (isSlot(from) ? from : to) as CoreSlot;
    const cp = (isSlot(from) ? to : from) as ConnectionPoint;
    const core = findCore(h, slot.coreId);
    if (!core) return undefined;
    core[slot.side] = { ...cp };
    return core.id;
  }
  if (from.id === to.id && from.handle === to.handle) return undefined;
  const dup = conductorsOf(h).some((c) => c.source && c.target && (
    (endpointKey(c.source) === endpointKey(from) && endpointKey(c.target) === endpointKey(to)) ||
    (endpointKey(c.source) === endpointKey(to) && endpointKey(c.target) === endpointKey(from))));
  if (dup) return undefined;
  const id = makeIdFactory(h)();
  const defaults = netDefaults(h, from) ?? netDefaults(h, to) ?? { color: "Black" };
  const w: Wire = { id, source: { ...from }, target: { ...to }, ...defaults };
  if (!w.stripeColor) delete w.stripeColor;
  if (!w.partId) delete w.partId;
  h.wires.push(w);
  return id;
}

export function findCore(h: Harness, coreId: string): CableCore | SplitWire | undefined {
  for (const c of h.cables) {
    const k = c.cores.find((x) => x.id === coreId) ?? (c.shield?.id === coreId ? c.shield : undefined);
    if (k) return k;
  }
  for (const t of h.twistedWires) {
    const k = t.wires.find((x) => x.id === coreId);
    if (k) return k;
  }
  return undefined;
}

export function findConductor(h: Harness, id: string): Wire | CableCore | undefined {
  return h.wires.find((w) => w.id === id) ?? findCore(h, id);
}

/** Moves every connection at `from` to `to` (Ctrl/⌘-drag between handles). */
export function moveConnections(h: Harness, from: ConnectionPoint, to: ConnectionPoint): number {
  if (endpointKey(from) === endpointKey(to)) return 0;
  let moved = 0;
  const fk = endpointKey(from);
  const visit = (c: Wire | CableCore) => {
    for (const side of ["source", "target"] as const) {
      const cp = c[side];
      if (cp && endpointKey(cp) === fk) {
        const other = c[side === "source" ? "target" : "source"];
        if (other && endpointKey(other) === endpointKey(to)) continue;
        c[side] = { ...to };
        moved++;
      }
    }
  };
  h.wires.forEach(visit);
  for (const c of h.cables) { c.cores.forEach(visit); if (c.shield) visit(c.shield); }
  for (const t of h.twistedWires) t.wires.forEach(visit);
  return moved;
}

function refersTo(cp: ConnectionPoint | undefined, ids: Set<string>) {
  return !!cp && (ids.has(cp.id) || ids.has(cp.handle));
}

/** Deletes components, conductors, bundles, layout points and parts, cleaning up references. */
export function deleteElements(h: Harness, idList: string[]) {
  const ids = new Set(idList);

  // Splice joining exactly two wires: merge them into one through the splice.
  for (const s of h.splices.filter((x) => ids.has(x.id))) {
    const ends = h.wires.filter((w) => w.source.id === s.id || w.target.id === s.id);
    const coresAt = conductorsOf(h).filter((c) => c.kind !== "wire" && (c.source?.id === s.id || c.target?.id === s.id));
    if (ends.length === 2 && coresAt.length === 0) {
      const [w1, w2] = ends;
      const far1 = w1.source.id === s.id ? w1.target : w1.source;
      const far2 = w2.source.id === s.id ? w2.target : w2.source;
      w1.source = far1; w1.target = far2;
      w1.layoutPoints = [...(w1.layoutPoints ?? []), ...(w2.layoutPoints ?? [])];
      if (!w1.layoutPoints.length) delete w1.layoutPoints;
      h.wires = h.wires.filter((w) => w !== w2);
    }
  }
  // Branch point joining exactly two bundles: merge them, summing lengths.
  for (const bp of h.branchPoints.filter((x) => ids.has(x.id))) {
    const ends = h.bundles.filter((b) => b.sourceId === bp.id || b.targetId === bp.id);
    if (ends.length === 2) {
      const [b1, b2] = ends;
      const far1 = b1.sourceId === bp.id ? b1.targetId : b1.sourceId;
      const far2 = b2.sourceId === bp.id ? b2.targetId : b2.sourceId;
      b1.sourceId = far1; b1.targetId = far2;
      if (b1.length && b2.length) {
        const mm = (l: NonNullable<Bundle["length"]>) => l.value * ({ mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, yd: 914.4 }[l.unit]);
        b1.length = { value: Math.round((mm(b1.length) + mm(b2.length)) * 1000) / 1000, unit: "mm" };
      } else delete b1.length;
      b1.layoutPoints = [...(b1.layoutPoints ?? []), ...(b2.layoutPoints ?? [])];
      b1.partIds = [...new Set([...(b1.partIds ?? []), ...(b2.partIds ?? [])])];
      h.bundles = h.bundles.filter((b) => b !== b2);
    }
  }

  for (const k of ["connectors", "terminals", "splices", "diodes", "resistors", "cables", "twistedWires", "branchPoints", "schematicNotes", "layoutNotes", "bundles", "mates", "wires"] as const) {
    (h as any)[k] = (h[k] as any[]).filter((el) => !ids.has(el.id));
  }
  // Cavities deleted directly
  for (const c of h.connectors) {
    c.cavities = c.cavities.filter((cv) => !ids.has(cv.id));
    if (c.shell && ids.has(c.shell.id)) delete c.shell;
  }
  const gone = new Set(idList);
  const existing = allIds(h);
  for (const id of idList) if (!existing.has(id)) gone.add(id);
  // Conductors referencing removed things
  h.wires = h.wires.filter((w) => !refersTo(w.source, gone) && !refersTo(w.target, gone) && existsCp(h, w.source) && existsCp(h, w.target));
  const cleanCore = (k: CableCore) => {
    if (k.source && (refersTo(k.source, gone) || !existsCp(h, k.source))) delete k.source;
    if (k.target && (refersTo(k.target, gone) || !existsCp(h, k.target))) delete k.target;
  };
  for (const c of h.cables) {
    c.cores = c.cores.filter((k) => !ids.has(k.id));
    c.cores.forEach(cleanCore);
    if (c.shield) { if (ids.has(c.shield.id)) delete c.shield; else cleanCore(c.shield); }
  }
  for (const t of h.twistedWires) { t.wires = t.wires.filter((k) => !ids.has(k.id)); t.wires.forEach(cleanCore); }
  h.twistedWires = h.twistedWires.filter((t) => t.wires.length > 0);
  // Layout points
  for (const w of h.wires) if (w.layoutPoints) w.layoutPoints = w.layoutPoints.filter((p) => !ids.has(p.id));
  for (const b of h.bundles) if (b.layoutPoints) b.layoutPoints = b.layoutPoints.filter((p) => !ids.has(p.id));
  for (const c of [...h.cables.flatMap((x) => [...x.cores, ...(x.shield ? [x.shield] : [])]), ...h.twistedWires.flatMap((t) => t.wires)]) {
    if (c.sourceLayoutPoints) c.sourceLayoutPoints = c.sourceLayoutPoints.filter((p) => !ids.has(p.id));
    if (c.targetLayoutPoints) c.targetLayoutPoints = c.targetLayoutPoints.filter((p) => !ids.has(p.id));
  }
  const nodeIds = new Set([...h.connectors, ...h.terminals, ...h.branchPoints].map((e) => e.id));
  h.bundles = h.bundles.filter((b) => nodeIds.has(b.sourceId) && nodeIds.has(b.targetId));
  const mateIds = new Set([...h.connectors, ...h.terminals].map((e) => e.id));
  h.mates = h.mates.filter((m) => mateIds.has(m.sourceId) && mateIds.has(m.targetId));
  for (const el of [...h.splices, ...h.diodes, ...h.resistors]) if (el.locationId && !nodeIds.has(el.locationId)) delete el.locationId;
  // Parts
  for (const k of PART_KINDS) (h as any)[k] = (h[k] as any[]).filter((p) => !ids.has(p.id));
  unassignMissingParts(h);
  for (const g of h.groups) g.memberIds = g.memberIds.filter((m) => !gone.has(m));
  h.groups = h.groups.filter((g) => g.memberIds.length > 0 || h.groups.some((c) => c.parentGroupId === g.id));
}

function existsCp(h: Harness, cp: ConnectionPoint): boolean {
  const c = h.connectors.find((x) => x.id === cp.id);
  if (c) return c.cavities.some((cv) => cv.id === cp.handle) || c.shell?.id === cp.handle;
  return [...h.terminals, ...h.splices, ...h.diodes, ...h.resistors].some((x) => x.id === cp.id);
}

function unassignMissingParts(h: Harness) {
  const partIds = new Set(PART_KINDS.flatMap((k) => (h[k] as any[]).map((p) => p.id)));
  const fix = (o: any, key: string) => { if (o[key] && !partIds.has(o[key])) delete o[key]; };
  for (const k of ["connectors", "terminals", "splices", "diodes", "resistors", "wires", "cables"] as const) for (const el of h[k] as any[]) fix(el, "partId");
  for (const t of h.twistedWires) for (const w of t.wires) fix(w, "partId");
  for (const c of h.connectors) for (const cv of c.cavities) { fix(cv, "contactPartId"); fix(cv, "cavityPlugPartId"); fix(cv, "cavitySealPartId"); }
  for (const b of [...h.bundles, ...h.branchPoints]) if (b.partIds) b.partIds = b.partIds.filter((p) => partIds.has(p));
}

export function setCavityCount(h: Harness, connectorId: string, n: number) {
  const c = h.connectors.find((x) => x.id === connectorId);
  if (!c) return;
  const count = Math.max(1, Math.min(256, Math.floor(n)));
  if (count > c.cavities.length) {
    const id = makeIdFactory(h);
    while (c.cavities.length < count) c.cavities.push({ id: id() });
  } else if (count < c.cavities.length) {
    deleteElements(h, c.cavities.slice(count).map((cv) => cv.id));
  }
}

export function moveCavity(h: Harness, connectorId: string, cavityId: string, delta: -1 | 1) {
  const c = h.connectors.find((x) => x.id === connectorId);
  if (!c) return;
  const i = c.cavities.findIndex((cv) => cv.id === cavityId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= c.cavities.length) return;
  [c.cavities[i], c.cavities[j]] = [c.cavities[j], c.cavities[i]];
}

export function insertCavityBelow(h: Harness, connectorId: string, cavityId: string) {
  const c = h.connectors.find((x) => x.id === connectorId);
  if (!c) return;
  const i = c.cavities.findIndex((cv) => cv.id === cavityId);
  c.cavities.splice(i + 1, 0, { id: makeIdFactory(h)() });
}

export function toggleShell(h: Harness, connectorId: string) {
  const c = h.connectors.find((x) => x.id === connectorId);
  if (!c) return;
  if (c.shell) deleteElements(h, [c.shell.id]);
  else c.shell = { id: makeIdFactory(h)() };
}

export function setCableCoreCount(h: Harness, cableId: string, n: number) {
  const c = h.cables.find((x) => x.id === cableId);
  if (!c) return;
  const count = Math.max(1, Math.min(64, Math.floor(n)));
  const id = makeIdFactory(h);
  const palette = ["Red", "Black", "White", "Green", "Blue", "Yellow", "Brown", "Orange", "Violet", "Gray"];
  while (c.cores.length < count) c.cores.push({ id: id(), color: palette[c.cores.length % palette.length] });
  if (c.cores.length > count) c.cores = c.cores.slice(0, count);
}

/** Groups selected wires into a new cable whose cores take over each wire's connections. */
export function makeCable(h: Harness, wireIds: string[]): string | undefined {
  const wires = h.wires.filter((w) => wireIds.includes(w.id));
  if (!wires.length) return undefined;
  const id = makeIdFactory(h);
  const pos = centroid(h, wires);
  const cable: Cable = {
    id: id(), schematicPosition: pos,
    cores: wires.map((w) => ({ id: w.id, color: w.color, ...(w.stripeColor ? { stripeColor: w.stripeColor } : {}), source: w.source, target: w.target })),
  };
  h.wires = h.wires.filter((w) => !wireIds.includes(w.id));
  h.cables.push(cable);
  return cable.id;
}

export function twistTogether(h: Harness, wireIds: string[]): string | undefined {
  const wires = h.wires.filter((w) => wireIds.includes(w.id)).slice(0, 8);
  if (wires.length < 2) return undefined;
  const id = makeIdFactory(h);
  const tw = {
    id: id(), schematicPosition: centroid(h, wires),
    wires: wires.map((w) => ({ id: w.id, color: w.color, ...(w.stripeColor ? { stripeColor: w.stripeColor } : {}), ...(w.partId ? { partId: w.partId } : {}), source: w.source, target: w.target })),
  };
  const taken = new Set(wires.map((w) => w.id));
  h.wires = h.wires.filter((w) => !taken.has(w.id));
  h.twistedWires.push(tw);
  return tw.id;
}

/** Splits the selected wires at a new splice; each wire keeps its source and a new wire runs from the splice to the old target. */
export function addSpliceOnWires(h: Harness, wireIds: string[]): string | undefined {
  const wires = h.wires.filter((w) => wireIds.includes(w.id));
  if (!wires.length) return undefined;
  const id = makeIdFactory(h);
  const pos = centroid(h, wires);
  const spliceId = id();
  h.splices.push({ id: spliceId, schematicPosition: pos, layoutPosition: pos });
  const targets = new Map<string, ConnectionPoint>();
  for (const w of wires) {
    targets.set(endpointKey(w.target), w.target);
    w.target = { id: spliceId, handle: "Splice" };
    delete w.layoutPoints;
  }
  const first = wires[0];
  for (const t of targets.values()) {
    h.wires.push({ id: id(), source: { id: spliceId, handle: "Splice" }, target: t, color: first.color, ...(first.stripeColor ? { stripeColor: first.stripeColor } : {}), ...(first.partId ? { partId: first.partId } : {}) });
  }
  return spliceId;
}

function centroid(h: Harness, wires: { source?: ConnectionPoint; target?: ConnectionPoint }[]): Pos {
  const pts: Pos[] = [];
  const posOf = (id: string) => [...h.connectors, ...h.terminals, ...h.splices, ...h.diodes, ...h.resistors].find((e) => e.id === id)?.schematicPosition;
  for (const w of wires) for (const cp of [w.source, w.target]) { const p = cp && posOf(cp.id); if (p) pts.push(p); }
  if (!pts.length) return { x: 300, y: 300 };
  return snapPos({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
}

/** Inserts a branch point into a bundle at a layout position, splitting it in two. */
export function splitBundle(h: Harness, bundleId: string, at: Pos): string | undefined {
  const b = h.bundles.find((x) => x.id === bundleId);
  if (!b) return undefined;
  const id = makeIdFactory(h);
  const bpId = id();
  h.branchPoints.push({ id: bpId, layoutPosition: snapPos(at) });
  const second: Bundle = { id: id(), sourceId: bpId, targetId: b.targetId, ...(b.partIds?.length ? { partIds: [...b.partIds] } : {}) };
  b.targetId = bpId;
  delete b.length;
  delete b.layoutPoints;
  h.bundles.push(second);
  return bpId;
}

export function addBundle(h: Harness, sourceId: string, targetId: string): string | undefined {
  if (sourceId === targetId) return undefined;
  if (h.bundles.some((b) => (b.sourceId === sourceId && b.targetId === targetId) || (b.sourceId === targetId && b.targetId === sourceId))) return undefined;
  const id = makeIdFactory(h)();
  h.bundles.push({ id, sourceId, targetId });
  return id;
}

export function addMate(h: Harness, sourceId: string, targetId: string, targetCavityId?: string): string | undefined {
  if (sourceId === targetId) return undefined;
  if (h.mates.some((m) => (m.sourceId === sourceId && m.targetId === targetId) || (m.sourceId === targetId && m.targetId === sourceId))) return undefined;
  const id = makeIdFactory(h)();
  h.mates.push({ id, sourceId, targetId, ...(targetCavityId ? { targetCavityId } : {}) });
  return id;
}

/** Adds a part of `kind`, optionally pre-filled from a component so the part matches it. */
export function addPart(h: Harness, kind: PartKind, fields: Record<string, unknown> = {}): string {
  const id = makeIdFactory(h)();
  const base: Record<string, unknown> = { id, partNumber: "", manufacturer: "" };
  if (kind === "wireParts") Object.assign(base, { color: "Black", gauge: { value: 20, unit: h.gaugeUnit === "AWG" ? "AWG" : "Metric" } });
  if (kind === "connectorParts") Object.assign(base, { numberOfCavities: 4, configurations: [{ id: makeIdFactory(h)(), accessories: [] }] });
  if (kind === "terminalParts") Object.assign(base, { type: "Ring" });
  if (kind === "coveringParts") Object.assign(base, { type: "HeatShrink", isFixedLength: false });
  if (kind === "cableParts") Object.assign(base, { shielded: false, cores: [{ id: makeIdFactory(h)(), color: "Red" }, { id: makeIdFactory(h)(), color: "Black" }] });
  if (kind === "contactParts") Object.assign(base, { gender: "Pin", type: "Crimp" });
  (h[kind] as any[]).push({ ...base, ...fields });
  return id;
}

/** Assigns a part, syncing the properties the format says must match (wire colours, cavity count, cable cores). */
export function assignPart(h: Harness, elementId: string, partId: string | undefined) {
  const w = findConductor(h, elementId) as (Wire & SplitWire) | undefined;
  if (w && (h.wires.includes(w as Wire) || h.twistedWires.some((t) => t.wires.includes(w)))) {
    if (!partId) { delete w.partId; return; }
    const p = h.wireParts.find((x) => x.id === partId);
    if (!p) return;
    w.partId = partId;
    if (p.color) w.color = p.color;
    if (p.stripeColor) w.stripeColor = p.stripeColor; else delete w.stripeColor;
    return;
  }
  const cable = h.cables.find((c) => c.id === elementId);
  if (cable) {
    if (!partId) { delete cable.partId; return; }
    const p = h.cableParts.find((x) => x.id === partId);
    if (!p) return;
    cable.partId = partId;
    if (p.cores?.length) {
      setCableCoreCount(h, cable.id, p.cores.length);
      cable.cores.forEach((k, i) => { k.color = p.cores![i].color; if (p.cores![i].stripeColor) k.stripeColor = p.cores![i].stripeColor; else delete k.stripeColor; });
    }
    if (p.shielded && !cable.shield) cable.shield = { id: makeIdFactory(h)(), color: "Shield" };
    if (p.shielded === false && cable.shield) delete cable.shield;
    return;
  }
  for (const k of ["connectors", "terminals", "splices", "diodes", "resistors"] as const) {
    const el = (h[k] as any[]).find((x) => x.id === elementId);
    if (!el) continue;
    if (!partId) { delete el.partId; delete el.configurationId; return; }
    el.partId = partId;
    delete el.configurationId;
    if (k === "terminals") {
      const p = h.terminalParts.find((x) => x.id === partId);
      if (p?.type) el.type = p.type;
    }
    return;
  }
}

export function partKindForElement(kind: string): PartKind | undefined {
  return ({ connectors: "connectorParts", terminals: "terminalParts", splices: "spliceParts", diodes: "diodeParts", resistors: "resistorParts", wires: "wireParts", cables: "cableParts" } as Record<string, PartKind>)[kind];
}

export function translateElements(h: Harness, ids: string[], dx: number, dy: number, view: "schematic" | "layout") {
  if (!dx && !dy) return;
  const set = new Set(ids);
  const key = view === "schematic" ? "schematicPosition" : "layoutPosition";
  const move = (p: Pos | undefined) => p && { x: snap(p.x + dx), y: snap(p.y + dy) };
  for (const k of ["connectors", "terminals", "splices", "diodes", "resistors"] as const) {
    for (const el of h[k]) if (set.has(el.id)) el[key] = move(el[key] ?? el.schematicPosition);
  }
  if (view === "schematic") {
    for (const el of [...h.cables, ...h.twistedWires]) if (set.has(el.id)) el.schematicPosition = move(el.schematicPosition)!;
    for (const n of h.schematicNotes) if (set.has(n.id)) n.schematicPosition = move(n.schematicPosition);
    for (const w of h.wires) for (const lp of w.layoutPoints ?? []) if (set.has(lp.id)) lp.schematicPosition = move(lp.schematicPosition);
    for (const c of [...h.cables.flatMap((x) => [...x.cores, ...(x.shield ? [x.shield] : [])]), ...h.twistedWires.flatMap((t) => t.wires)]) {
      for (const lp of [...(c.sourceLayoutPoints ?? []), ...(c.targetLayoutPoints ?? [])]) if (set.has(lp.id)) lp.schematicPosition = move(lp.schematicPosition);
    }
  } else {
    for (const b of h.branchPoints) if (set.has(b.id)) b.layoutPosition = move(b.layoutPosition)!;
    for (const n of h.layoutNotes) if (set.has(n.id)) n.layoutPosition = move(n.layoutPosition);
    for (const b of h.bundles) for (const lp of b.layoutPoints ?? []) if (set.has(lp.id)) lp.layoutPosition = move(lp.layoutPosition);
  }
}
