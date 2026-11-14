import {
  FORMAT_VERSION, PART_KINDS, RESERVED_HANDLES, emptyHarness,
  type Bundle, type Cable, type CableCore, type ConnectionPoint, type Connector, type GroupMeta,
  type Harness, type LayoutPoint, type Mate, type TwistedWires, type Wire,
} from "./types";

type IdMap = (id: string) => string;

const NODE_ARRAYS = ["connectors", "terminals", "splices", "diodes", "resistors", "branchPoints", "schematicNotes", "layoutNotes"] as const;
const LINK_ARRAYS = ["wires", "cables", "twistedWires", "bundles", "mates"] as const;
type NodeArray = (typeof NODE_ARRAYS)[number];
type LinkArray = (typeof LINK_ARRAYS)[number];

const SETTINGS_KEYS = ["version", "kind", "currency", "lengthUnit", "gaugeUnit", "readOnly", "idNumbers", "title"];
const KNOWN_KEYS = new Set<string>([...SETTINGS_KEYS, ...NODE_ARRAYS, ...LINK_ARRAYS, "groups", ...PART_KINDS]);

function mapHandle(h: string, f: IdMap): string {
  return (RESERVED_HANDLES as readonly string[]).includes(h) ? h : f(h);
}
function mapCp(cp: ConnectionPoint | undefined, f: IdMap): ConnectionPoint | undefined {
  return cp ? { ...cp, id: f(cp.id), handle: mapHandle(cp.handle, f) } : undefined;
}
function mapLps(lps: LayoutPoint[] | undefined, f: IdMap): LayoutPoint[] | undefined {
  return lps?.map((lp) => ({ ...lp, id: f(lp.id) }));
}
function mapCore<T extends CableCore>(c: T, f: IdMap): T {
  const out: T = { ...c, id: f(c.id) };
  if (c.source) out.source = mapCp(c.source, f);
  if (c.target) out.target = mapCp(c.target, f);
  if (c.sourceLayoutPoints) out.sourceLayoutPoints = mapLps(c.sourceLayoutPoints, f);
  if (c.targetLayoutPoints) out.targetLayoutPoints = mapLps(c.targetLayoutPoints, f);
  return out;
}

/** Rewrites every element id and id reference inside an element of the given array. Part ids are never rewritten. */
export function mapElementIds(kind: NodeArray | LinkArray, el: any, f: IdMap): any {
  switch (kind) {
    case "connectors": {
      const c = el as Connector;
      return { ...c, id: f(c.id), cavities: c.cavities.map((cv) => ({ ...cv, id: f(cv.id) })), ...(c.shell ? { shell: { ...c.shell, id: f(c.shell.id) } } : {}) };
    }
    case "terminals":
    case "branchPoints":
    case "schematicNotes":
    case "layoutNotes":
      return { ...el, id: f(el.id) };
    case "splices":
    case "diodes":
    case "resistors":
      return { ...el, id: f(el.id), ...(el.locationId ? { locationId: f(el.locationId) } : {}) };
    case "wires": {
      const w = el as Wire;
      const out: Wire = { ...w, id: f(w.id), source: mapCp(w.source, f)!, target: mapCp(w.target, f)! };
      if (w.layoutPoints) out.layoutPoints = mapLps(w.layoutPoints, f);
      return out;
    }
    case "cables": {
      const c = el as Cable;
      return { ...c, id: f(c.id), cores: c.cores.map((k) => mapCore(k, f)), ...(c.shield ? { shield: mapCore(c.shield, f) } : {}) };
    }
    case "twistedWires": {
      const t = el as TwistedWires;
      return { ...t, id: f(t.id), wires: t.wires.map((k) => mapCore(k, f)) };
    }
    case "bundles": {
      const b = el as Bundle;
      return { ...b, id: f(b.id), sourceId: f(b.sourceId), targetId: f(b.targetId), ...(b.layoutPoints ? { layoutPoints: mapLps(b.layoutPoints, f) } : {}) };
    }
    case "mates": {
      const m = el as Mate;
      return { ...m, id: f(m.id), sourceId: f(m.sourceId), targetId: f(m.targetId), ...(m.targetCavityId ? { targetCavityId: f(m.targetCavityId) } : {}) };
    }
  }
}

export class HarnessFormatError extends Error {}

/** Parses a `.harness` (or `.harnesslib`) JSON document into the flattened in-memory model. */
export function parseHarness(input: unknown): Harness {
  const raw = typeof input === "string" ? JSON.parse(input) : input;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HarnessFormatError("A harness document must be a JSON object");
  const doc = raw as Record<string, any>;
  if (typeof doc.version !== "number") throw new HarnessFormatError("Missing numeric 'version' field");

  const h = emptyHarness();
  if (doc.currency) h.currency = doc.currency;
  if (doc.lengthUnit) h.lengthUnit = doc.lengthUnit;
  if (doc.gaugeUnit) h.gaugeUnit = doc.gaugeUnit;
  if (doc.readOnly) h.readOnly = true;
  if (doc.idNumbers) h.idNumbers = doc.idNumbers;
  if (typeof doc.title === "string") h.title = doc.title;
  for (const [k, v] of Object.entries(doc)) if (!KNOWN_KEYS.has(k)) h.extra[k] = v;

  const partIds = new Set<string>();
  const flatten = (d: Record<string, any>, prefix: string, group: GroupMeta | undefined) => {
    const q: IdMap = (id) => (prefix ? `${prefix}-${id}` : id);
    for (const kind of [...NODE_ARRAYS, ...LINK_ARRAYS]) {
      for (const el of (d[kind] as any[] | undefined) ?? []) {
        const mapped = mapElementIds(kind, el, q);
        (h[kind] as any[]).push(mapped);
        group?.memberIds.push(mapped.id);
      }
    }
    for (const kind of PART_KINDS) {
      for (const p of (d[kind] as any[] | undefined) ?? []) {
        if (partIds.has(p.id)) continue;
        partIds.add(p.id);
        (h[kind] as any[]).push(p);
      }
    }
    for (const g of (d.groups as any[] | undefined) ?? []) {
      const { document, ...meta } = g;
      const gid = q(g.id);
      const gm: GroupMeta = { ...meta, id: gid, memberIds: [], ...(group ? { parentGroupId: group.id } : {}) };
      h.groups.push(gm);
      flatten(document ?? {}, gid, gm);
    }
  };
  flatten(doc, "", undefined);
  normalize(h);
  return h;
}

/** Fills in fields that the editor relies on. */
function normalize(h: Harness) {
  for (const k of ["connectors", "terminals", "splices", "diodes", "resistors"] as const) {
    for (const el of h[k] as any[]) {
      if (!el.schematicPosition && el.layoutPosition) el.schematicPosition = { ...el.layoutPosition };
      if (!el.layoutPosition && el.schematicPosition) el.layoutPosition = { ...el.schematicPosition };
      if (!el.schematicPosition) el.schematicPosition = { x: 0, y: 0 };
      if (!el.layoutPosition) el.layoutPosition = { x: 0, y: 0 };
    }
  }
  for (const c of h.connectors) if (!Array.isArray(c.cavities)) c.cavities = [];
  for (const c of h.cables) if (!Array.isArray(c.cores)) c.cores = [];
  for (const t of h.twistedWires) if (!Array.isArray(t.wires)) t.wires = [];
  for (const w of h.wires) if (!w.color) w.color = "Black";
}

function endpointIdsOf(kind: LinkArray, el: any): string[] {
  switch (kind) {
    case "wires": return [el.source?.id, el.target?.id].filter(Boolean);
    case "bundles": return [el.sourceId, el.targetId];
    case "mates": return [el.sourceId, el.targetId];
    case "cables": return [...el.cores, ...(el.shield ? [el.shield] : [])].flatMap((c: CableCore) => [c.source?.id, c.target?.id]).filter((x): x is string => !!x);
    case "twistedWires": return (el.wires as CableCore[]).flatMap((c) => [c.source?.id, c.target?.id]).filter((x): x is string => !!x);
  }
}

/** Serialises the in-memory model back to a v1.3 document, re-nesting grouped members. */
export function serializeHarness(h: Harness): Record<string, unknown> {
  const groupById = new Map(h.groups.map((g) => [g.id, g]));
  const homeOf = new Map<string, string>();
  for (const g of h.groups) for (const m of g.memberIds) homeOf.set(m, g.id);

  const chain = (gid: string | undefined): string[] => {
    const out: string[] = [];
    for (let g = gid; g; g = groupById.get(g)?.parentGroupId) out.unshift(g);
    return out;
  };
  const deepestCommon = (ids: string[]): string | undefined => {
    if (ids.length === 0) return undefined;
    const chains = ids.map((id) => chain(homeOf.get(id)));
    let common: string | undefined;
    for (let i = 0; ; i++) {
      const g = chains[0][i];
      if (!g || !chains.every((c) => c[i] === g)) return common;
      common = g;
    }
  };

  const docFor = (gid: string | undefined): Record<string, unknown> => {
    const unq: IdMap = (id) => (gid && id.startsWith(`${gid}-`) ? id.slice(gid.length + 1) : id);
    const out: Record<string, unknown> = {};
    for (const kind of NODE_ARRAYS) {
      const items = (h[kind] as any[]).filter((el) => homeOf.get(el.id) === gid).map((el) => {
        const mapped = mapElementIds(kind, el, unq);
        if (gid && "locationId" in el && el.locationId && homeOf.get(el.locationId) !== gid) delete mapped.locationId;
        return mapped;
      });
      if (items.length) out[kind] = items.map(stripEmpty);
    }
    for (const kind of LINK_ARRAYS) {
      const items = (h[kind] as any[]).filter((el) => deepestCommon(endpointIdsOf(kind, el)) === gid).map((el) => mapElementIds(kind, el, unq));
      if (items.length) out[kind] = items.map(stripEmpty);
    }
    const children = h.groups.filter((g) => g.parentGroupId === gid);
    if (children.length) {
      out.groups = children.map((g) => {
        const { memberIds: _m, parentGroupId: _p, ...meta } = g;
        return { ...meta, id: unq(g.id), document: docFor(g.id) };
      });
    }
    return out;
  };

  const out: Record<string, unknown> = { version: FORMAT_VERSION };
  if (h.title) out.title = h.title;
  if (h.currency !== "$") out.currency = h.currency;
  out.lengthUnit = h.lengthUnit;
  out.gaugeUnit = h.gaugeUnit;
  if (h.readOnly) out.readOnly = true;
  if (h.idNumbers) out.idNumbers = h.idNumbers;
  Object.assign(out, docFor(undefined));
  for (const kind of PART_KINDS) if ((h[kind] as unknown[]).length) out[kind] = (h[kind] as unknown[]).map(stripEmpty);
  Object.assign(out, h.extra);
  return out;
}

function stripEmpty<T>(el: T): T {
  if (!el || typeof el !== "object") return el;
  const out: any = Array.isArray(el) ? [] : {};
  for (const [k, v] of Object.entries(el as any)) {
    if (v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? stripEmpty(v) : Array.isArray(v) ? v.map(stripEmpty) : v;
  }
  return out;
}

export function harnessToText(h: Harness): string {
  return JSON.stringify(serializeHarness(h), null, 2);
}
