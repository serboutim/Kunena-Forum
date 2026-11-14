import type { Analysis } from "./analysis";
import type { Cable, ConnectionPoint, Connector, LayoutPoint, Pos, Terminal, TwistedWires } from "./types";
import { GRID } from "./ops";

export interface Rect { x: number; y: number; w: number; h: number }
export type Side = "L" | "R" | "T" | "B";
export interface Anchor { p: Pos; side: Side }

const DIR: Record<Side, Pos> = { L: { x: -1, y: 0 }, R: { x: 1, y: 0 }, T: { x: 0, y: -1 }, B: { x: 0, y: 1 } };

export function connectorRect(c: Connector): Rect {
  const p = c.schematicPosition ?? { x: 0, y: 0 };
  const width = c.width ?? 150;
  const rows = c.cavities.length + (c.shell ? 1 : 0);
  const len = GRID + rows * GRID;
  return c.rotated ? { x: p.x, y: p.y, w: len, h: width } : { x: p.x, y: p.y, w: width, h: len };
}

export function terminalRect(t: Terminal): Rect {
  const p = t.schematicPosition ?? { x: 0, y: 0 };
  const w = t.width ?? 150;
  return t.rotated ? { x: p.x, y: p.y, w: GRID, h: w } : { x: p.x, y: p.y, w, h: GRID };
}

export function conductorGroupRect(el: Cable | TwistedWires, kind: "cables" | "twistedWires"): Rect {
  const rows = kind === "cables" ? (el as Cable).cores.length + ((el as Cable).shield ? 1 : 0) : (el as TwistedWires).wires.length;
  const w = kind === "cables" ? 60 : 90;
  const len = GRID + rows * GRID;
  const p = el.schematicPosition;
  return el.rotated ? { x: p.x, y: p.y, w: len, h: w } : { x: p.x, y: p.y, w, h: len };
}

export function smallRect(el: { schematicPosition?: Pos }): Rect {
  const p = el.schematicPosition ?? { x: 0, y: 0 };
  return { x: p.x, y: p.y, w: GRID, h: GRID };
}

export function schematicRect(a: Analysis, id: string): Rect | undefined {
  const ref = a.elements.get(id);
  if (!ref) return undefined;
  switch (ref.kind) {
    case "connectors": return connectorRect(ref.el);
    case "terminals": return terminalRect(ref.el);
    case "cables":
    case "twistedWires": return conductorGroupRect(ref.el, ref.kind);
    case "splices":
    case "diodes":
    case "resistors": return smallRect(ref.el);
    case "schematicNotes": { const p = ref.el.schematicPosition ?? { x: 0, y: 0 }; return { x: p.x, y: p.y, w: ref.el.width ?? 150, h: 60 }; }
    default: return undefined;
  }
}

/** Both candidate anchors of an endpoint on the schematic (e.g. the left and right ends of a cavity row). */
export function endpointAnchors(a: Analysis, cp: ConnectionPoint): Anchor[] {
  const ref = a.elements.get(cp.id);
  if (!ref) return [];
  const el = ref.el;
  if (ref.kind === "connectors") {
    const r = connectorRect(el);
    const cav = a.cavities.get(cp.handle);
    const i = cav ? cav.index : 0;
    if (el.rotated) {
      const x = r.x + GRID + i * GRID + GRID / 2;
      return [{ p: { x, y: r.y }, side: "T" }, { p: { x, y: r.y + r.h }, side: "B" }];
    }
    const y = r.y + GRID + i * GRID + GRID / 2;
    return [{ p: { x: r.x, y }, side: "L" }, { p: { x: r.x + r.w, y }, side: "R" }];
  }
  if (ref.kind === "terminals") {
    const r = terminalRect(el);
    if (el.rotated) return [{ p: { x: r.x + GRID / 2, y: r.y }, side: "T" }, { p: { x: r.x + GRID / 2, y: r.y + r.h }, side: "B" }];
    return [{ p: { x: r.x, y: r.y + GRID / 2 }, side: "L" }, { p: { x: r.x + r.w, y: r.y + GRID / 2 }, side: "R" }];
  }
  const r = smallRect(el);
  const c = { x: r.x + GRID / 2, y: r.y + GRID / 2 };
  if (ref.kind === "splices") return [{ p: { x: r.x, y: c.y }, side: "L" }, { p: { x: r.x + r.w, y: c.y }, side: "R" }, { p: { x: c.x, y: r.y }, side: "T" }, { p: { x: c.x, y: r.y + r.h }, side: "B" }];
  if (el.rotated) return cp.handle === "Left" ? [{ p: { x: c.x, y: r.y }, side: "T" }] : [{ p: { x: c.x, y: r.y + r.h }, side: "B" }];
  return cp.handle === "Left" ? [{ p: { x: r.x, y: c.y }, side: "L" }] : [{ p: { x: r.x + r.w, y: c.y }, side: "R" }];
}

/** Anchors of a core row on a cable or twisted-wires node. */
export function coreAnchors(el: Cable | TwistedWires, kind: "cables" | "twistedWires", index: number): { a: Anchor; b: Anchor } {
  const r = conductorGroupRect(el, kind);
  if (el.rotated) {
    const x = r.x + GRID + index * GRID + GRID / 2;
    return { a: { p: { x, y: r.y }, side: "T" }, b: { p: { x, y: r.y + r.h }, side: "B" } };
  }
  const y = r.y + GRID + index * GRID + GRID / 2;
  return { a: { p: { x: r.x, y }, side: "L" }, b: { p: { x: r.x + r.w, y }, side: "R" } };
}

export function pickAnchor(anchors: Anchor[], towards: Pos): Anchor | undefined {
  if (!anchors.length) return undefined;
  let best = anchors[0];
  let bestScore = -Infinity;
  for (const an of anchors) {
    const d = DIR[an.side];
    const vx = towards.x - an.p.x, vy = towards.y - an.p.y;
    const score = d.x * vx + d.y * vy - 0.001 * Math.hypot(vx, vy);
    if (score > bestScore) { bestScore = score; best = an; }
  }
  return best;
}

export function anchorsCenter(anchors: Anchor[]): Pos {
  if (!anchors.length) return { x: 0, y: 0 };
  return { x: anchors.reduce((s, a) => s + a.p.x, 0) / anchors.length, y: anchors.reduce((s, a) => s + a.p.y, 0) / anchors.length };
}

const STUB = 15;

/** Orthogonal path between two anchors, through any layout points. */
export function wirePath(s: Anchor, t: Anchor, via: Pos[] = []): Pos[] {
  const ds = DIR[s.side], dt = DIR[t.side];
  const s1 = { x: s.p.x + ds.x * STUB, y: s.p.y + ds.y * STUB };
  const t1 = { x: t.p.x + dt.x * STUB, y: t.p.y + dt.y * STUB };
  if (via.length) return [s.p, s1, ...via, t1, t.p];
  const sh = s.side === "L" || s.side === "R";
  const th = t.side === "L" || t.side === "R";
  if (sh && th) {
    const mx = (s1.x + t1.x) / 2;
    if (Math.abs(s.p.y - t.p.y) < 0.5) return [s.p, t.p];
    return [s.p, s1, { x: mx, y: s1.y }, { x: mx, y: t1.y }, t1, t.p];
  }
  if (!sh && !th) {
    const my = (s1.y + t1.y) / 2;
    if (Math.abs(s.p.x - t.p.x) < 0.5) return [s.p, t.p];
    return [s.p, s1, { x: s1.x, y: my }, { x: t1.x, y: my }, t1, t.p];
  }
  return sh ? [s.p, s1, { x: t1.x, y: s1.y }, t1, t.p] : [s.p, s1, { x: s1.x, y: t1.y }, t1, t.p];
}

export function toSvgPath(points: Pos[], radius = 6): string {
  if (points.length < 2) return "";
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1], p1 = points[i], p2 = points[i + 1];
    const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y), l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    if (r < 0.5) { d += ` L${p1.x},${p1.y}`; continue; }
    const a = { x: p1.x - ((p1.x - p0.x) / l1) * r, y: p1.y - ((p1.y - p0.y) / l1) * r };
    const b = { x: p1.x + ((p2.x - p1.x) / l2) * r, y: p1.y + ((p2.y - p1.y) / l2) * r };
    d += ` L${a.x},${a.y} Q${p1.x},${p1.y} ${b.x},${b.y}`;
  }
  const last = points[points.length - 1];
  return d + ` L${last.x},${last.y}`;
}

export function schematicPoints(lps: LayoutPoint[] | undefined): Pos[] {
  return (lps ?? []).map((lp) => lp.schematicPosition).filter((p): p is Pos => !!p);
}

/** Index at which a new waypoint at `p` should be inserted into `via` given the full path start/end. */
export function insertionIndex(path: Pos[], viaCount: number, p: Pos): number {
  let best = 0, bestD = Infinity;
  for (let i = 1; i < path.length; i++) {
    const d = distToSegment(p, path[i - 1], path[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  // With waypoints the path is [start, stub, ...via, stub, end], so segment i ends at via[i - 2].
  if (viaCount === 0) return 0;
  return Math.max(0, Math.min(viaCount, best - 2));
}

export function distToSegment(p: Pos, a: Pos, b: Pos): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// ---- Layout view ----

export const LAYOUT_NODE = GRID;

export function layoutCenter(el: { layoutPosition?: Pos; schematicPosition?: Pos }): Pos {
  const p = el.layoutPosition ?? el.schematicPosition ?? { x: 0, y: 0 };
  return { x: p.x + LAYOUT_NODE / 2, y: p.y + LAYOUT_NODE / 2 };
}
