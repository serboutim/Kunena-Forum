import type {
  Cable, CableCore, Cavity, ConnectionPoint, Connector, ConnectorPart, CrossFlowKind, DesignationStrategy,
  Harness, Pos, TwistedWires, Wire,
} from "./types";
import { estimateWireDiameter, gaugeToMm2, toMm } from "./units";

export type ElementKind =
  | "connectors" | "terminals" | "splices" | "diodes" | "resistors" | "cables" | "twistedWires"
  | "bundles" | "branchPoints" | "mates" | "schematicNotes" | "layoutNotes" | "wires";

export interface ElementRef { kind: ElementKind; el: any }

export type ConductorKind = "wire" | "core" | "shield" | "twisted";

export interface Conductor {
  id: string;
  kind: ConductorKind;
  /** Cable or twisted-wires id for cores and twisted wires. */
  parentId?: string;
  index: number;
  source?: ConnectionPoint;
  target?: ConnectionPoint;
  color: string;
  stripeColor?: string;
  identColors?: string[];
  identLabel?: string;
  partId?: string;
  gaugeMm2?: number;
  displayId: string;
  raw: Wire | CableCore;
}

export interface CavityRef { connector: Connector; cavity: Cavity; index: number; isShell: boolean }

export interface Net { id: string; name: string; signals: string[]; endpoints: string[]; conductors: string[] }

export interface Route {
  bundleIds: string[];
  nodeIds: string[];
  lengthMm?: number;
  /** A bundle on the route has no set length; its drawn length was used instead. */
  estimated: boolean;
  noRoute: boolean;
}

export interface Analysis {
  elements: Map<string, ElementRef>;
  cavities: Map<string, CavityRef>;
  conductors: Conductor[];
  conductorById: Map<string, Conductor>;
  displayIds: Map<string, string>;
  designations: Map<string, string>;
  /** Endpoint key -> conductor ids ending there. */
  connections: Map<string, string[]>;
  netOfEndpoint: Map<string, Net>;
  netOfConductor: Map<string, Net>;
  nets: Net[];
  effectiveSignal: Map<string, string | undefined>;
  routes: Map<string, Route>;
  conductorsInBundle: Map<string, string[]>;
  inlineLocation: Map<string, string | undefined>;
  bundleDiameterMm: Map<string, number>;
  cableLengthMm: Map<string, number | undefined>;
  mated: Map<string, string[]>;
}

export const SCHEMATIC_PREFIX: Record<string, string> = {
  connectors: "C", terminals: "T", wires: "W", cables: "CB", twistedWires: "TW", splices: "S",
  diodes: "D", resistors: "R", bundles: "B", branchPoints: "BP",
};

export function endpointKey(cp: ConnectionPoint): string {
  return `${cp.id}::${cp.handle}`;
}

export function splitKey(key: string): ConnectionPoint {
  const i = key.lastIndexOf("::");
  return { id: key.slice(0, i), handle: key.slice(i + 2) };
}

export function conductorsOf(h: Harness): Omit<Conductor, "displayId" | "gaugeMm2">[] {
  const out: Omit<Conductor, "displayId" | "gaugeMm2">[] = [];
  const base = (c: Wire | CableCore) => ({
    source: c.source, target: c.target, color: c.color, stripeColor: c.stripeColor,
    identColors: c.identColors, identLabel: c.identLabel, raw: c,
  });
  h.wires.forEach((w, i) => out.push({ id: w.id, kind: "wire", index: i, partId: w.partId, ...base(w) }));
  for (const c of h.cables) {
    c.cores.forEach((k, i) => out.push({ id: k.id, kind: "core", parentId: c.id, index: i, ...base(k) }));
    if (c.shield) out.push({ id: c.shield.id, kind: "shield", parentId: c.id, index: c.cores.length, ...base(c.shield) });
  }
  for (const t of h.twistedWires) {
    t.wires.forEach((k, i) => out.push({ id: k.id, kind: "twisted", parentId: t.id, index: i, partId: k.partId, ...base(k) }));
  }
  return out;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function letterSeq(n: number, skipped: string[] = []): string[] {
  const pool = [...LETTERS].filter((l) => !skipped.includes(l));
  const out: string[] = [];
  for (let i = 0; out.length < n; i++) {
    let s = "";
    let k = i;
    do { s = pool[k % pool.length] + s; k = Math.floor(k / pool.length) - 1; } while (k >= 0);
    out.push(s);
  }
  return out;
}

export function designationLabels(strategy: DesignationStrategy | undefined, n: number): string[] {
  if (!strategy || strategy.type === "sequential") return Array.from({ length: n }, (_, i) => String(i + 1));
  if (strategy.type === "alphabetical") return letterSeq(n, strategy.skippedLetters);
  if (strategy.type === "custom") return Array.from({ length: n }, (_, i) => strategy.labels[i] ?? String(i + 1));
  const rows = strategy.type === "grid" && strategy.rowLabels?.type === "sequential"
    ? Array.from({ length: strategy.rows }, (_, i) => String(i + 1)) : letterSeq(strategy.rows);
  const cols = strategy.columnLabels?.type === "alphabetical"
    ? letterSeq(strategy.columns) : Array.from({ length: strategy.columns }, (_, i) => String(i + 1));
  const out: string[] = [];
  for (const r of rows) for (const c of cols) out.push(r + c);
  return Array.from({ length: n }, (_, i) => out[i] ?? String(i + 1));
}

class UnionFind {
  parent = new Map<string, string>();
  add(a: string) { if (!this.parent.has(a)) this.parent.set(a, a); }
  find(a: string): string {
    this.add(a);
    let r = a;
    while (this.parent.get(r) !== r) r = this.parent.get(r)!;
    let c = a;
    while (this.parent.get(c) !== r) { const n = this.parent.get(c)!; this.parent.set(c, r); c = n; }
    return r;
  }
  union(a: string, b: string) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(ra, rb); }
}

const byPos = (p?: Pos) => (p ? p.x * 1e6 + p.y : 0);

export function findPart<T = any>(h: Harness, kind: keyof Harness, id: string | undefined): T | undefined {
  if (!id) return undefined;
  return (h[kind] as any[]).find((p) => p.id === id);
}

export function polylineLength(points: Pos[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return s;
}

/** Layout units are drawn at 0.75 mm each (the formboard scale), used to estimate unset bundle lengths. */
export const MM_PER_LAYOUT_UNIT = 0.75;

export function analyze(h: Harness): Analysis {
  const elements = new Map<string, ElementRef>();
  const cavities = new Map<string, CavityRef>();
  const kinds: ElementKind[] = ["connectors", "terminals", "splices", "diodes", "resistors", "cables", "twistedWires", "bundles", "branchPoints", "mates", "schematicNotes", "layoutNotes", "wires"];
  for (const kind of kinds) for (const el of h[kind] as any[]) elements.set(el.id, { kind, el });
  for (const c of h.connectors) {
    c.cavities.forEach((cv, i) => cavities.set(cv.id, { connector: c, cavity: cv, index: i, isShell: false }));
    if (c.shell) cavities.set(c.shell.id, { connector: c, cavity: c.shell, index: c.cavities.length, isShell: true });
  }

  // ---- Display IDs (canvas position numbering, or static when set) ----
  const displayIds = new Map<string, string>();
  const isStatic = h.idNumbers?.numbering === "Static";
  const number = (kind: string, items: any[], sortKey: (el: any) => number) => {
    const sorted = [...items].sort((a, b) => sortKey(a) - sortKey(b));
    const prefix = SCHEMATIC_PREFIX[kind];
    let next = isStatic ? Math.max(0, ...items.map((e) => e.idNumber ?? 0)) + 1 : 1;
    sorted.forEach((el, i) => {
      const n = isStatic ? (el.idNumber ?? next++) : i + 1;
      displayIds.set(el.id, `${prefix}${n}`);
    });
  };
  for (const k of ["connectors", "terminals", "splices", "diodes", "resistors", "cables", "twistedWires"] as const) {
    number(k, h[k] as any[], (el) => byPos(el.schematicPosition));
  }
  number("branchPoints", h.branchPoints, (el) => byPos(el.layoutPosition));

  const compOrder = new Map<string, number>();
  ["connectors", "terminals", "splices", "diodes", "resistors"].forEach((k, ki) => {
    for (const el of h[k as CrossFlowKind]) compOrder.set(el.id, ki * 1e5 + Number((displayIds.get(el.id) ?? "0").replace(/\D/g, "")));
  });
  const endpointOrder = (cp?: ConnectionPoint) => {
    if (!cp) return 1e12;
    const cav = cavities.get(cp.handle);
    return (compOrder.get(cp.id) ?? 9e5) * 1000 + (cav ? cav.index : 0);
  };
  number("bundles", h.bundles, (b) => Math.min(compOrder.get(b.sourceId) ?? 9e5, compOrder.get(b.targetId) ?? 9e5) * 1e4 + Math.max(compOrder.get(b.sourceId) ?? 9e5, compOrder.get(b.targetId) ?? 9e5) / 1e3);

  // ---- Conductors ----
  const rawConductors = conductorsOf(h);
  const wireLike = rawConductors.filter((c) => c.kind === "wire" || c.kind === "twisted");
  number("wires", wireLike.map((c) => c.raw), (w: Wire) => Math.min(endpointOrder(w.source), endpointOrder(w.target)));
  const conductors: Conductor[] = rawConductors.map((c) => {
    let displayId = displayIds.get(c.id) ?? c.id;
    let gaugeMm2: number | undefined;
    if (c.kind === "core" || c.kind === "shield") {
      const cable = elements.get(c.parentId!)!.el as Cable;
      const cid = displayIds.get(cable.id) ?? "CB";
      const name = cable.label || cid;
      displayId = c.kind === "shield" ? `${name}.S` : `${name}.${c.index + 1}`;
      const part = findPart(h, "cableParts", cable.partId);
      gaugeMm2 = c.kind === "core" ? gaugeToMm2(part?.cores?.[c.index]?.gauge) : undefined;
    } else {
      gaugeMm2 = gaugeToMm2(findPart(h, "wireParts", c.partId)?.gauge);
    }
    return { ...c, displayId, gaugeMm2 };
  });
  const conductorById = new Map(conductors.map((c) => [c.id, c]));

  // ---- Designations ----
  const designations = new Map<string, string>();
  for (const c of h.connectors) {
    const part = findPart<ConnectorPart>(h, "connectorParts", c.partId);
    const labels = designationLabels(part?.designationStrategy, c.cavities.length);
    c.cavities.forEach((cv, i) => designations.set(cv.id, labels[i]));
    if (c.shell) designations.set(c.shell.id, "Shell");
  }

  // ---- Endpoints & nets ----
  const uf = new UnionFind();
  const allEndpoints: string[] = [];
  const addEp = (k: string) => { uf.add(k); allEndpoints.push(k); };
  for (const c of h.connectors) {
    for (const cv of c.cavities) addEp(`${c.id}::${cv.id}`);
    if (c.shell) addEp(`${c.id}::${c.shell.id}`);
  }
  for (const t of h.terminals) addEp(`${t.id}::Terminal`);
  for (const s of h.splices) addEp(`${s.id}::Splice`);
  for (const d of [...h.diodes, ...h.resistors]) { addEp(`${d.id}::Left`); addEp(`${d.id}::Right`); }

  const connections = new Map<string, string[]>();
  for (const c of conductors) {
    for (const cp of [c.source, c.target]) {
      if (!cp) continue;
      const k = endpointKey(cp);
      uf.add(k);
      if (!connections.has(k)) connections.set(k, []);
      connections.get(k)!.push(c.id);
    }
    if (c.source && c.target) uf.union(endpointKey(c.source), endpointKey(c.target));
  }

  const mated = new Map<string, string[]>();
  const pushMate = (a: string, b: string) => { mated.set(a, [...(mated.get(a) ?? []), b]); mated.set(b, [...(mated.get(b) ?? []), a]); };
  for (const m of h.mates) {
    const a = elements.get(m.sourceId), b = elements.get(m.targetId);
    if (!a || !b) continue;
    pushMate(m.sourceId, m.targetId);
    if (a.kind === "connectors" && b.kind === "connectors") {
      const ca = a.el as Connector, cb = b.el as Connector;
      for (let i = 0; i < Math.min(ca.cavities.length, cb.cavities.length); i++) uf.union(`${ca.id}::${ca.cavities[i].id}`, `${cb.id}::${cb.cavities[i].id}`);
      if (ca.shell && cb.shell) uf.union(`${ca.id}::${ca.shell.id}`, `${cb.id}::${cb.shell.id}`);
    } else if (a.kind === "terminals" && b.kind === "connectors" && m.targetCavityId) {
      uf.union(`${m.sourceId}::Terminal`, `${m.targetId}::${m.targetCavityId}`);
    } else if (a.kind === "connectors" && b.kind === "terminals" && m.targetCavityId) {
      uf.union(`${m.targetId}::Terminal`, `${m.sourceId}::${m.targetCavityId}`);
    } else if (a.kind === "terminals" && b.kind === "terminals") {
      uf.union(`${m.sourceId}::Terminal`, `${m.targetId}::Terminal`);
    }
  }

  type SigSrc = { key: string; signal?: string; propagate?: boolean; global?: boolean };
  const sigSources: SigSrc[] = [];
  for (const c of h.connectors) {
    for (const cv of [...c.cavities, ...(c.shell ? [c.shell] : [])]) sigSources.push({ key: `${c.id}::${cv.id}`, signal: cv.signal, propagate: cv.propagate, global: cv.global });
  }
  for (const t of h.terminals) sigSources.push({ key: `${t.id}::Terminal`, signal: t.signal, propagate: t.propagate, global: t.global });
  const globals = new Map<string, string>();
  for (const s of sigSources) {
    if (!s.signal || !s.global) continue;
    const prev = globals.get(s.signal);
    if (prev) uf.union(prev, s.key); else globals.set(s.signal, s.key);
  }

  const netsByRoot = new Map<string, Net>();
  const netOfEndpoint = new Map<string, Net>();
  for (const k of uf.parent.keys()) {
    const r = uf.find(k);
    if (!netsByRoot.has(r)) netsByRoot.set(r, { id: r, name: "", signals: [], endpoints: [], conductors: [] });
    const n = netsByRoot.get(r)!;
    n.endpoints.push(k);
    netOfEndpoint.set(k, n);
  }
  for (const s of sigSources) {
    if (!s.signal || s.propagate === false) continue;
    const n = netOfEndpoint.get(s.key)!;
    if (!n.signals.includes(s.signal)) n.signals.push(s.signal);
  }
  const netOfConductor = new Map<string, Net>();
  for (const c of conductors) {
    const cp = c.source ?? c.target;
    if (!cp) continue;
    const n = netOfEndpoint.get(endpointKey(cp))!;
    n.conductors.push(c.id);
    netOfConductor.set(c.id, n);
  }
  const nets = [...netsByRoot.values()].filter((n) => n.conductors.length > 0 || n.signals.length > 0);
  nets.forEach((n, i) => { n.name = n.signals[0] ?? `N${i + 1}`; });

  const effectiveSignal = new Map<string, string | undefined>();
  for (const s of sigSources) {
    const n = netOfEndpoint.get(s.key);
    effectiveSignal.set(s.key, s.signal || (n && n.signals.length ? n.signals.join(" / ") : undefined));
  }

  // ---- Routing through bundles ----
  const adjacency = new Map<string, { to: string; bundleId: string; w: number; estimated: boolean }[]>();
  const posOf = (id: string): Pos | undefined => elements.get(id)?.el.layoutPosition;
  for (const b of h.bundles) {
    const a = posOf(b.sourceId), c = posOf(b.targetId);
    let mm = toMm(b.length);
    let estimated = false;
    if (mm === undefined) {
      estimated = true;
      mm = a && c ? polylineLength([a, ...(b.layoutPoints ?? []).map((p) => p.layoutPosition!).filter(Boolean), c]) * MM_PER_LAYOUT_UNIT : 0;
    }
    for (const [x, y] of [[b.sourceId, b.targetId], [b.targetId, b.sourceId]]) {
      if (!adjacency.has(x)) adjacency.set(x, []);
      adjacency.get(x)!.push({ to: y, bundleId: b.id, w: mm, estimated });
    }
  }
  const dijkstraCache = new Map<string, { dist: Map<string, number>; prev: Map<string, { node: string; bundleId: string; estimated: boolean }> }>();
  const dijkstra = (src: string) => {
    const hit = dijkstraCache.get(src);
    if (hit) return hit;
    const dist = new Map<string, number>([[src, 0]]);
    const prev = new Map<string, { node: string; bundleId: string; estimated: boolean }>();
    const done = new Set<string>();
    for (;;) {
      let u: string | undefined;
      let best = Infinity;
      for (const [n, d] of dist) if (!done.has(n) && d < best) { best = d; u = n; }
      if (u === undefined) break;
      done.add(u);
      for (const e of adjacency.get(u) ?? []) {
        const nd = best + e.w;
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { node: u, bundleId: e.bundleId, estimated: e.estimated }); }
      }
    }
    const res = { dist, prev };
    dijkstraCache.set(src, res);
    return res;
  };

  const physical = new Set([...h.connectors, ...h.terminals, ...h.branchPoints].map((e) => e.id));
  const inlineLocation = new Map<string, string | undefined>();
  const inlines = [...h.splices, ...h.diodes, ...h.resistors];
  for (const el of inlines) if (el.locationId && physical.has(el.locationId)) inlineLocation.set(el.id, el.locationId);
  const locOf = (id: string | undefined) => (id ? (physical.has(id) ? id : inlineLocation.get(id)) : undefined);
  for (let pass = 0; pass < 3; pass++) {
    for (const el of inlines) {
      if (el.locationId && physical.has(el.locationId)) continue;
      const others: string[] = [];
      for (const c of conductors) {
        if (c.source?.id === el.id && c.target) { const l = locOf(c.target.id); if (l) others.push(l); }
        if (c.target?.id === el.id && c.source) { const l = locOf(c.source.id); if (l) others.push(l); }
      }
      if (others.length === 0) continue;
      let best: string | undefined;
      let bestCost = Infinity;
      const tables = others.map((o) => dijkstra(o).dist);
      const candidates = new Set<string>(others);
      for (const t of tables) for (const n of t.keys()) candidates.add(n);
      for (const n of candidates) {
        let cost = 0;
        for (const t of tables) cost += t.get(n) ?? 1e9;
        if (cost < bestCost - 1e-9) { bestCost = cost; best = n; }
      }
      inlineLocation.set(el.id, best);
    }
  }

  const routes = new Map<string, Route>();
  const conductorsInBundle = new Map<string, string[]>(h.bundles.map((b) => [b.id, []]));
  for (const c of conductors) {
    if (!c.source || !c.target) continue;
    const a = locOf(c.source.id), b = locOf(c.target.id);
    if (!a || !b) { routes.set(c.id, { bundleIds: [], nodeIds: [], noRoute: true, estimated: false }); continue; }
    if (a === b) { routes.set(c.id, { bundleIds: [], nodeIds: [a], lengthMm: 0, noRoute: false, estimated: false }); continue; }
    const { dist, prev } = dijkstra(a);
    if (!dist.has(b)) { routes.set(c.id, { bundleIds: [], nodeIds: [], noRoute: true, estimated: false }); continue; }
    const bundleIds: string[] = [];
    const nodeIds = [b];
    let estimated = false;
    for (let n = b; n !== a;) {
      const p = prev.get(n)!;
      bundleIds.unshift(p.bundleId);
      nodeIds.unshift(p.node);
      estimated ||= p.estimated;
      n = p.node;
    }
    routes.set(c.id, { bundleIds, nodeIds, lengthMm: dist.get(b), noRoute: false, estimated });
    for (const bid of bundleIds) conductorsInBundle.get(bid)!.push(c.id);
  }

  const cableLengthMm = new Map<string, number | undefined>();
  for (const cable of h.cables) {
    const lens = [...cable.cores, ...(cable.shield ? [cable.shield] : [])].map((k) => routes.get(k.id)?.lengthMm).filter((v): v is number => v !== undefined);
    cableLengthMm.set(cable.id, lens.length ? Math.max(...lens) : undefined);
  }

  const bundleDiameterMm = new Map<string, number>();
  for (const [bid, ids] of conductorsInBundle) {
    const inside = new Set(ids);
    let sumSq = 0;
    const seenCables = new Set<string>();
    for (const id of ids) {
      const c = conductorById.get(id)!;
      if ((c.kind === "core" || c.kind === "shield") && !seenCables.has(c.parentId!)) {
        const cable = elements.get(c.parentId!)!.el as Cable;
        const all = [...cable.cores, ...(cable.shield ? [cable.shield] : [])];
        if (all.every((k) => inside.has(k.id))) {
          seenCables.add(cable.id);
          sumSq += estimateCableDiameter(h, cable, conductorById) ** 2;
          continue;
        }
      }
      if (seenCables.has(c.parentId ?? "")) continue;
      sumSq += estimateWireDiameter(c.gaugeMm2) ** 2;
    }
    bundleDiameterMm.set(bid, ids.length ? Math.sqrt(sumSq) * 1.15 : 0);
  }

  return {
    elements, cavities, conductors, conductorById, displayIds, designations, connections,
    netOfEndpoint, netOfConductor, nets, effectiveSignal, routes, conductorsInBundle, inlineLocation,
    bundleDiameterMm, cableLengthMm, mated,
  };
}

export function estimateCableDiameter(h: Harness, cable: Cable, conductorById: Map<string, Conductor>): number {
  const part = findPart(h, "cableParts", cable.partId);
  if (part?.diameter) return toMm(part.diameter) ?? 5;
  const sumSq = cable.cores.reduce((s, k) => s + estimateWireDiameter(conductorById.get(k.id)?.gaugeMm2) ** 2, 0);
  return Math.sqrt(sumSq) * 1.15 + (cable.shield ? 0.6 : 0) + 1.2;
}

/** Human-readable name of an element: its label, falling back to its component ID. */
export function nameOf(a: Analysis, id: string): string {
  const ref = a.elements.get(id);
  return (ref?.el.label as string | undefined) || a.displayIds.get(id) || id;
}

/** e.g. `ECU:12`, `T3`, `S1`, `D1 (A)`. */
export function endpointLabel(a: Analysis, cp: ConnectionPoint | undefined): string {
  if (!cp) return "—";
  const ref = a.elements.get(cp.id);
  if (!ref) return `? ${cp.id}`;
  const name = nameOf(a, cp.id);
  if (ref.kind === "connectors") return `${name}:${a.designations.get(cp.handle) ?? "?"}`;
  if (ref.kind === "diodes") {
    const anodeLeft = !ref.el.anodeOnRight;
    const isAnode = (cp.handle === "Left") === anodeLeft;
    return `${name} (${isAnode ? "A" : "K"})`;
  }
  if (ref.kind === "resistors") return `${name} (${cp.handle === "Left" ? "1" : "2"})`;
  return name;
}

export function conductorLengthMm(a: Analysis, c: Conductor): number | undefined {
  return a.routes.get(c.id)?.lengthMm;
}

export function twistedWith(a: Analysis, h: Harness, c: Conductor): string[] {
  if (c.kind === "twisted") {
    const tw = a.elements.get(c.parentId!)!.el as TwistedWires;
    return tw.wires.filter((w) => w.id !== c.id).map((w) => a.conductorById.get(w.id)?.displayId ?? w.id);
  }
  if (c.kind === "core") {
    const cable = a.elements.get(c.parentId!)!.el as Cable;
    const part = findPart(h, "cableParts", cable.partId);
    const flags = cable.cores.map((k, i) => (part?.cores ? !!part.cores[i]?.twistedWithNext : !!k.twistedWithNext));
    let start = c.index;
    while (start > 0 && flags[start - 1]) start--;
    let end = c.index;
    while (end < cable.cores.length - 1 && flags[end]) end++;
    if (start === end) return [];
    return cable.cores.slice(start, end + 1).filter((k) => k.id !== c.id).map((k) => a.conductorById.get(k.id)?.displayId ?? k.id);
  }
  return [];
}
