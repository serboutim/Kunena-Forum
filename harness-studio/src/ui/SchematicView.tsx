import { produce } from "immer";
import { useMemo, useRef, useState } from "react";
import { type Analysis, type Conductor, nameOf } from "../model/analysis";
import { colorHex, isLight } from "../model/colors";
import {
  type Anchor, type Rect, anchorsCenter, conductorGroupRect, connectorRect, coreAnchors, endpointAnchors, insertionIndex,
  pickAnchor, schematicPoints, schematicRect, smallRect, terminalRect, toSvgPath, wirePath,
} from "../model/geometry";
import { type CoreSlot, GRID, connect, findConductor, makeIdFactory, moveConnections, snap, translateElements } from "../model/ops";
import type { Cable, ConnectionPoint, Connector, Harness, LayoutPoint, Note, Pos, Terminal, TwistedWires } from "../model/types";
import { useStore } from "../store";
import { add, addMenuItems, cableMenu, cavityMenu, conductorMenu, connectorMenu, genericMenu, terminalLabel } from "./actions";
import { Canvas, type CanvasApi, startDrag, useBackgroundClick } from "./Canvas";
import { openMenu } from "./ContextMenu";
import { analysisOf, computeHighlight } from "./hooks";
import { ViewToggles } from "./ViewToggles";

type Preview = { key: string; fn: (h: Harness) => void } | null;
type WireDraw = { from: ConnectionPoint | CoreSlot; start: Pos; cur: Pos; move: boolean } | null;
type Editing = { kind: "signal"; connectorId: string; cavityId: string } | { kind: "terminalSignal"; id: string } | { kind: "label"; id: string } | { kind: "note"; id: string } | null;

interface Segment { conductor: Conductor; seg: "wire" | "source" | "target"; points: Pos[]; via: LayoutPoint[] }

export function SchematicView() {
  const h = useStore((s) => s.h);
  const selection = useStore((s) => s.selection);
  const options = useStore((s) => s.options);
  const { select, update } = useStore.getState();
  const api = useRef<CanvasApi>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const [wire, setWire] = useState<WireDraw>(null);
  const [marquee, setMarquee] = useState<{ a: Pos; b: Pos } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);

  const dh = useMemo(() => (preview ? produce(h, preview.fn) : h), [h, preview]);
  const { a, issues } = analysisOf(dh);
  const sel = useMemo(() => new Set(selection), [selection]);
  const hl = useMemo(() => computeHighlight(a, selection, options.highlightNets), [a, selection, options.highlightNets]);
  const issueTargets = useMemo(() => {
    const m = new Map<string, "error" | "warning">();
    for (const i of issues) if (i.severity !== "info") for (const t of i.targetIds) if (m.get(t) !== "error") m.set(t, i.severity as "error" | "warning");
    return m;
  }, [issues]);

  const segments = useMemo(() => buildSegments(a), [a]);
  useBackgroundClick(api, () => { select([]); setEditing(null); });

  const dim = (id: string) => hl.active && !hl.elements.has(id) && !sel.has(id);

  // ---------- pointer interactions ----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !api.current) return;
    const t = e.target as Element;
    const handle = t.closest("[data-cp-id]");
    const slot = t.closest("[data-slot]");
    const lp = t.closest("[data-lp]");
    const cond = t.closest("[data-conductor]");
    const node = t.closest("[data-node]");
    if (t.closest("foreignObject")) return;
    e.stopPropagation();
    if (handle || slot) {
      const from: ConnectionPoint | CoreSlot = handle
        ? { id: handle.getAttribute("data-cp-id")!, handle: handle.getAttribute("data-cp-handle")! }
        : parseSlot(slot!.getAttribute("data-slot")!);
      const start = { x: Number((handle ?? slot)!.getAttribute("cx")), y: Number((handle ?? slot)!.getAttribute("cy")) };
      const move = !!(e.metaKey || e.ctrlKey) && !!handle;
      setWire({ from, start, cur: start, move });
      startDrag(e, api.current, {
        onMove: (_d, w, ev) => setWire((s) => s && { ...s, cur: w, move: s.move && (ev.metaKey || ev.ctrlKey) }),
        onUp: (_d, _w, target, ev) => {
          setWire(null);
          const th = target?.closest("[data-cp-id]");
          const ts = target?.closest("[data-slot]");
          const to: ConnectionPoint | CoreSlot | undefined = th
            ? { id: th.getAttribute("data-cp-id")!, handle: th.getAttribute("data-cp-handle")! }
            : ts ? parseSlot(ts.getAttribute("data-slot")!) : undefined;
          if (!to) return;
          if (move && (ev.metaKey || ev.ctrlKey) && "handle" in to && "handle" in from) {
            let n = 0;
            update((d) => { n = moveConnections(d, from, to); });
            useStore.getState().notify(n ? `Moved ${n} connection${n > 1 ? "s" : ""}` : "Nothing to move");
            return;
          }
          let id: string | undefined;
          update((d) => { id = connect(d, from, to); });
          if (id) select([id]);
        },
      });
      return;
    }
    if (lp) {
      const id = lp.getAttribute("data-lp")!;
      startDrag(e, api.current, {
        onMove: (d) => setPreview({ key: `lp${Math.round(d.x / GRID)},${Math.round(d.y / GRID)}`, fn: (x) => translateElements(x, [id], d.x, d.y, "schematic") }),
        onUp: (d, _w, _t, _ev, moved) => { setPreview(null); if (moved) update((x) => translateElements(x, [id], d.x, d.y, "schematic")); },
      });
      return;
    }
    if (cond) {
      const id = cond.getAttribute("data-conductor")!;
      select([id], e.shiftKey || e.metaKey || e.ctrlKey ? "toggle" : "replace");
      return;
    }
    if (node) {
      const id = node.getAttribute("data-node")!;
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      let ids = selection;
      if (additive) { select([id], "toggle"); ids = sel.has(id) ? selection.filter((x) => x !== id) : [...selection, id]; }
      else if (!sel.has(id)) { select([id]); ids = [id]; }
      const moveIds = withAttachedPoints(dh, ids);
      startDrag(e, api.current, {
        onMove: (d) => setPreview({ key: `${Math.round(d.x / GRID)},${Math.round(d.y / GRID)}`, fn: (x) => translateElements(x, moveIds, d.x, d.y, "schematic") }),
        onUp: (d, _w, _t, _ev, moved) => {
          setPreview(null);
          if (moved && (Math.round(d.x / GRID) || Math.round(d.y / GRID))) update((x) => translateElements(x, moveIds, d.x, d.y, "schematic"));
          else if (!moved && !additive) select([id]);
        },
      });
    }
  };

  const onBackgroundPointerDown = (e: React.PointerEvent, world: Pos) => {
    if (!e.shiftKey || !api.current) return false;
    setMarquee({ a: world, b: world });
    startDrag(e, api.current, {
      onMove: (_d, w) => setMarquee({ a: world, b: w }),
      onUp: (_d, w) => {
        setMarquee(null);
        const r = normRect(world, w);
        const ids: string[] = [];
        for (const [id, ref] of a.elements) {
          if (!["connectors", "terminals", "splices", "diodes", "resistors", "cables", "twistedWires", "schematicNotes"].includes(ref.kind)) continue;
          const nr = schematicRect(a, id);
          if (nr && intersects(r, nr)) ids.push(id);
        }
        for (const s of segments) if (s.points.some((p) => inside(r, p)) && s.points.every((p) => inside(r, p))) ids.push(s.conductor.id);
        for (const s of segments) for (const lp of s.via) if (lp.schematicPosition && inside(r, lp.schematicPosition)) ids.push(lp.id);
        select([...new Set(ids)], "add");
      },
    });
    return true;
  };

  const onDoubleClick = (e: React.MouseEvent, world: Pos) => {
    const t = e.target as Element;
    const cav = t.closest("[data-cavity]");
    if (cav) { const [connectorId, cavityId] = cav.getAttribute("data-cavity")!.split("|"); setEditing({ kind: "signal", connectorId, cavityId }); return; }
    const tsig = t.closest("[data-terminal-signal]");
    if (tsig) { setEditing({ kind: "terminalSignal", id: tsig.getAttribute("data-terminal-signal")! }); return; }
    const lbl = t.closest("[data-label-edit]");
    if (lbl) { setEditing({ kind: "label", id: lbl.getAttribute("data-label-edit")! }); return; }
    const note = t.closest("[data-note]");
    if (note) { setEditing({ kind: "note", id: note.getAttribute("data-note")! }); return; }
    const lp = t.closest("[data-lp]");
    if (lp) { const id = lp.getAttribute("data-lp")!; update((d) => removeLayoutPoint(d, id)); return; }
    const cond = t.closest("[data-conductor]");
    if (cond) {
      const id = cond.getAttribute("data-conductor")!;
      const seg = cond.getAttribute("data-seg") as Segment["seg"];
      const s = segments.find((x) => x.conductor.id === id && x.seg === seg);
      if (!s) return;
      const p = { x: snap(world.x), y: snap(world.y) };
      update((d) => {
        const c = findConductor(d, id) as any;
        const key = seg === "wire" ? "layoutPoints" : seg === "source" ? "sourceLayoutPoints" : "targetLayoutPoints";
        const list: LayoutPoint[] = c[key] ?? [];
        const idx = insertionIndex(s.points, list.length, world);
        list.splice(idx, 0, { id: makeIdFactory(d)(6), schematicPosition: p });
        c[key] = list;
      });
      select([id]);
    }
  };

  const onContextMenu = (e: React.MouseEvent, world: Pos) => {
    const t = e.target as Element;
    const cav = t.closest("[data-cavity]");
    if (cav) {
      const [connectorId, cavityId] = cav.getAttribute("data-cavity")!.split("|");
      const c = h.connectors.find((x) => x.id === connectorId)!;
      const cv = c.cavities.find((x) => x.id === cavityId) ?? c.shell!;
      openMenu(e, [...cavityMenu(h, connectorId, cv), { separator: true }, ...connectorMenu(h, connectorId)]);
      return;
    }
    const lp = t.closest("[data-lp]");
    if (lp) { const id = lp.getAttribute("data-lp")!; openMenu(e, [{ label: "Delete layout point", danger: true, onClick: () => update((d) => removeLayoutPoint(d, id)) }]); return; }
    const cond = t.closest("[data-conductor]");
    if (cond) {
      const id = cond.getAttribute("data-conductor")!;
      if (!sel.has(id)) select([id]);
      openMenu(e, conductorMenu(h, id));
      return;
    }
    const node = t.closest("[data-node]");
    if (node) {
      const id = node.getAttribute("data-node")!;
      if (!sel.has(id)) select([id]);
      const ref = a.elements.get(id)!;
      if (ref.kind === "connectors") openMenu(e, connectorMenu(h, id));
      else if (ref.kind === "cables") openMenu(e, cableMenu(h, id));
      else if (ref.kind === "schematicNotes") openMenu(e, [{ label: "Edit text", onClick: () => setEditing({ kind: "note", id }) }, { label: "Delete note", danger: true, onClick: () => update((d) => { d.schematicNotes = d.schematicNotes.filter((n) => n.id !== id); }) }]);
      else openMenu(e, genericMenu(h, id, ref.kind, kindTitle(ref.kind)));
      return;
    }
    openMenu(e, addMenuItems(world, "schematic"));
  };

  const center = (): Pos => {
    const svg = api.current?.svg();
    if (!svg || !api.current) return { x: 300, y: 300 };
    const r = svg.getBoundingClientRect();
    return api.current.toWorld(r.left + r.width / 2 - 60, r.top + r.height / 2 - 60);
  };

  // ---------- render ----------
  const wireLayer = segments.map((s) => {
    const c = s.conductor;
    const route = a.routes.get(c.id);
    const selected = sel.has(c.id) || (c.parentId !== undefined && sel.has(c.parentId));
    const faded = hl.active && !hl.conductors.has(c.id) && !selected;
    const dashed = options.dashUnrouted && h.bundles.length > 0 && !!route?.noRoute;
    const d = toSvgPath(s.points);
    const base = c.kind === "shield" ? "#94a3b8" : colorHex(c.color);
    const warn = options.showWarnings && issueTargets.get(c.id);
    return (
      <g key={`${c.id}-${s.seg}`} opacity={faded ? 0.18 : 1}>
        {selected && <path d={d} stroke="#3b82f6" strokeOpacity={0.35} strokeWidth={9} fill="none" strokeLinejoin="round" />}
        {warn && <path d={d} stroke={warn === "error" ? "#ef4444" : "#f59e0b"} strokeOpacity={0.3} strokeWidth={7} fill="none" />}
        {isLight(c.color) && <path d={d} stroke="#64748b" strokeWidth={4.4} fill="none" strokeLinejoin="round" strokeDasharray={dashed ? "6 5" : undefined} />}
        <path d={d} stroke={base} strokeWidth={c.kind === "shield" ? 2 : 3} fill="none" strokeLinejoin="round" strokeDasharray={dashed || c.kind === "shield" ? "6 5" : undefined} />
        {c.stripeColor && !dashed && <path d={d} stroke={colorHex(c.stripeColor)} strokeWidth={1.6} fill="none" strokeDasharray="5 7" />}
        <path d={d} className="wire-hit" stroke="transparent" strokeWidth={12} fill="none" data-conductor={c.id} data-seg={s.seg} />
        {(c.identLabel || c.identColors?.length) && s.seg !== "target" && <IdentTag points={s.points} label={c.identLabel} colors={c.identColors} />}
        {options.showIds && s.seg !== "target" && (c.kind === "wire" || c.kind === "twisted") && <WireIdTag points={s.points} text={c.displayId} />}
        {selected && s.via.map((lp) => lp.schematicPosition && (
          <circle key={lp.id} className="lp" data-lp={lp.id} cx={lp.schematicPosition.x} cy={lp.schematicPosition.y} r={5} fill="#fff" stroke="#2563eb" strokeWidth={2} />
        ))}
      </g>
    );
  });

  return (
    <div className="stage">
      <Canvas ref={api} viewKey="schematic" onBackgroundPointerDown={onBackgroundPointerDown} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick}
        overlay={<>
          <div className="palette">
            <button onClick={() => add("connector", center())}>▭ Connector</button>
            <button onClick={() => add("terminal", center(), "Ring")}>◎ Terminal</button>
            <button onClick={() => add("splice", center())}>● Splice</button>
            <button onClick={() => add("cable", center())}>≡ Cable</button>
            <button onClick={() => add("twistedWires", center())}>∞ Twisted pair</button>
            <button onClick={() => add("diode", center())}>▷| Diode</button>
            <button onClick={() => add("resistor", center())}>⌇ Resistor</button>
            <button onClick={() => add("schematicNote", center())}>✎ Note</button>
            <div className="hint">Drag from a handle to another to draw a wire. Right-click for more.</div>
          </div>
          <ViewToggles view="schematic" />
        </>}>
        <g onPointerDown={onPointerDown}>
          {dh.schematicNotes.map((n) => <NoteNode key={n.id} n={n} selected={sel.has(n.id)} />)}
          {wireLayer}
          {dh.cables.map((c) => <GroupNode key={c.id} el={c} kind="cables" a={a} h={dh} selected={sel.has(c.id)} dim={dim(c.id)} />)}
          {dh.twistedWires.map((t) => <GroupNode key={t.id} el={t} kind="twistedWires" a={a} h={dh} selected={sel.has(t.id)} dim={dim(t.id)} />)}
          {dh.connectors.map((c) => <ConnectorNode key={c.id} c={c} a={a} selected={sel.has(c.id)} dim={dim(c.id)} showIds={options.showIds} warn={options.showWarnings ? issueTargets.get(c.id) : undefined} />)}
          {dh.terminals.map((t) => <TerminalNode key={t.id} t={t} a={a} selected={sel.has(t.id)} dim={dim(t.id)} showIds={options.showIds} warn={options.showWarnings ? issueTargets.get(t.id) : undefined} />)}
          {dh.splices.map((s) => <InlineNode key={s.id} id={s.id} kind="splices" el={s} a={a} selected={sel.has(s.id)} dim={dim(s.id)} showIds={options.showIds} warn={options.showWarnings ? issueTargets.get(s.id) : undefined} />)}
          {dh.diodes.map((s) => <InlineNode key={s.id} id={s.id} kind="diodes" el={s} a={a} selected={sel.has(s.id)} dim={dim(s.id)} showIds={options.showIds} />)}
          {dh.resistors.map((s) => <InlineNode key={s.id} id={s.id} kind="resistors" el={s} a={a} selected={sel.has(s.id)} dim={dim(s.id)} showIds={options.showIds} />)}
          {wire && (
            <path d={`M${wire.start.x},${wire.start.y} L${wire.cur.x},${wire.cur.y}`} stroke={wire.move ? "#7c3aed" : "#0f172a"} strokeWidth={2}
              strokeDasharray={wire.move ? "2 6" : "6 4"} strokeLinecap="round" fill="none" pointerEvents="none" />
          )}
          {marquee && (() => { const r = normRect(marquee.a, marquee.b); return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#3b82f6" fillOpacity={0.08} stroke="#3b82f6" strokeDasharray="4 3" pointerEvents="none" />; })()}
          {editing && <InlineEditor editing={editing} h={h} a={a} onDone={(next) => setEditing(next)} />}
        </g>
      </Canvas>
    </div>
  );
}

function kindTitle(kind: string) {
  return ({ terminals: "Terminal", splices: "Splice", diodes: "Diode", resistors: "Resistor", twistedWires: "Twisted wires" } as Record<string, string>)[kind] ?? kind;
}

function parseSlot(s: string): CoreSlot {
  const [parentId, coreId, side] = s.split("|");
  return { parentId, coreId, side: side as "source" | "target" };
}

function normRect(a: Pos, b: Pos): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, p: Pos) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Moving every node a wire is attached to should carry that wire's waypoints along. */
function withAttachedPoints(h: Harness, ids: string[]): string[] {
  const set = new Set(ids);
  const out = [...ids];
  for (const w of h.wires) if (set.has(w.source.id) && set.has(w.target.id)) for (const lp of w.layoutPoints ?? []) out.push(lp.id);
  return out;
}

function removeLayoutPoint(h: Harness, id: string) {
  for (const w of h.wires) if (w.layoutPoints) w.layoutPoints = w.layoutPoints.filter((p) => p.id !== id);
  for (const c of [...h.cables.flatMap((x) => [...x.cores, ...(x.shield ? [x.shield] : [])]), ...h.twistedWires.flatMap((t) => t.wires)]) {
    if (c.sourceLayoutPoints) c.sourceLayoutPoints = c.sourceLayoutPoints.filter((p) => p.id !== id);
    if (c.targetLayoutPoints) c.targetLayoutPoints = c.targetLayoutPoints.filter((p) => p.id !== id);
  }
}

function buildSegments(a: Analysis): Segment[] {
  const out: Segment[] = [];
  const anchorsOf = (cp: ConnectionPoint) => endpointAnchors(a, cp);
  for (const c of a.conductors) {
    if (c.kind === "wire") {
      if (!c.source || !c.target) continue;
      const via = (c.raw as any).layoutPoints as LayoutPoint[] | undefined;
      const vp = schematicPoints(via);
      const sa = anchorsOf(c.source), ta = anchorsOf(c.target);
      if (!sa.length || !ta.length) continue;
      const s = pickAnchor(sa, vp[0] ?? anchorsCenter(ta))!;
      const t = pickAnchor(ta, vp[vp.length - 1] ?? anchorsCenter(sa))!;
      out.push({ conductor: c, seg: "wire", points: wirePath(s, t, vp), via: via ?? [] });
      continue;
    }
    const parent = a.elements.get(c.parentId!)!;
    const kind = parent.kind as "cables" | "twistedWires";
    const { a: left, b: right } = coreAnchors(parent.el, kind, c.index);
    const r = conductorGroupRect(parent.el, kind);
    const mid = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const srcCenter = c.source ? anchorsCenter(anchorsOf(c.source)) : undefined;
    const tgtCenter = c.target ? anchorsCenter(anchorsOf(c.target)) : undefined;
    const horizontal = !parent.el.rotated;
    let sourceSide: Anchor = left, targetSide: Anchor = right;
    const before = (p: Pos | undefined) => p && (horizontal ? p.x < mid.x : p.y < mid.y);
    if (srcCenter ? !before(srcCenter) : before(tgtCenter)) { sourceSide = right; targetSide = left; }
    const raw = c.raw as any;
    for (const [seg, cp, side, lps] of [["source", c.source, sourceSide, raw.sourceLayoutPoints], ["target", c.target, targetSide, raw.targetLayoutPoints]] as const) {
      if (!cp) continue;
      const anchors = anchorsOf(cp);
      if (!anchors.length) continue;
      const vp = schematicPoints(lps);
      const ordered = seg === "source" ? vp : [...vp].reverse();
      const end = pickAnchor(anchors, ordered[0] ?? side.p)!;
      const pts = seg === "source" ? wirePath(end, side, vp) : wirePath(side, end, vp);
      out.push({ conductor: c, seg, points: pts, via: lps ?? [] });
    }
  }
  return out;
}

function nodeStroke(selected: boolean, warn?: string) {
  if (selected) return "#2563eb";
  if (warn === "error") return "#dc2626";
  if (warn === "warning") return "#d97706";
  return "#334155";
}

function Handle({ id, handle, p }: { id: string; handle: string; p: Pos }) {
  return <circle className="handle" data-cp-id={id} data-cp-handle={handle} cx={p.x} cy={p.y} r={4.5} fill="#fff" stroke="#334155" strokeWidth={1.5} />;
}

function Header({ id, a, x, y, w, showIds, vertical }: { id: string; a: Analysis; x: number; y: number; w: number; showIds: boolean; vertical?: boolean }) {
  const ref = a.elements.get(id)!;
  const label = ref.el.label as string | undefined;
  const did = a.displayIds.get(id) ?? "";
  const text = label || did;
  if (vertical) {
    return (
      <g data-label-edit={id}>
        <text x={x + 15} y={y + w / 2} className="svg-label" fill="#fff" style={{ fill: "#fff", fontWeight: 600 }} textAnchor="middle" transform={`rotate(-90 ${x + 15} ${y + w / 2})`} dominantBaseline="central">{text}</text>
      </g>
    );
  }
  return (
    <g data-label-edit={id}>
      <text x={x + 10} y={y + 15} className="svg-label" style={{ fill: "#fff", fontWeight: 600 }} dominantBaseline="central">{text}</text>
      {showIds && label && <text x={x + w - 8} y={y + 15} className="svg-muted" style={{ fill: "#cbd5e1" }} textAnchor="end" dominantBaseline="central">{did}</text>}
    </g>
  );
}

function WarnBadge({ x, y, level }: { x: number; y: number; level?: string }) {
  if (!level) return null;
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={7} fill={level === "error" ? "#dc2626" : "#f59e0b"} />
      <text x={x} y={y + 0.5} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 10, fontWeight: 700, fill: "#fff" }}>!</text>
    </g>
  );
}

function ConnectorNode({ c, a, selected, dim, showIds, warn }: { c: Connector; a: Analysis; selected: boolean; dim: boolean; showIds: boolean; warn?: string }) {
  const r = connectorRect(c);
  const rows = [...c.cavities, ...(c.shell ? [c.shell] : [])];
  const stroke = nodeStroke(selected, warn);
  return (
    <g data-node={c.id} opacity={dim ? 0.35 : 1} className="node-hit">
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={5} fill="#fff" stroke={stroke} strokeWidth={selected ? 2.5 : 1.5} />
      {c.rotated ? (
        <>
          <rect x={r.x} y={r.y} width={GRID} height={r.h} rx={5} fill="#1e293b" />
          <Header id={c.id} a={a} x={r.x} y={r.y} w={r.h} showIds={showIds} vertical />
          {rows.map((cv, i) => {
            const x = r.x + GRID + i * GRID;
            const isShell = cv === c.shell;
            const key = `${c.id}::${cv.id}`;
            const sig = a.effectiveSignal.get(key);
            return (
              <g key={cv.id} data-cavity={`${c.id}|${cv.id}`}>
                <line x1={x} y1={r.y} x2={x} y2={r.y + r.h} stroke="#e2e8f0" />
                <rect x={x} y={r.y} width={GRID} height={GRID} fill="#f1f5f9" />
                <text x={x + 15} y={r.y + 15} className="svg-label" textAnchor="middle" dominantBaseline="central" style={{ fontWeight: 600 }}>{isShell ? "⏚" : a.designations.get(cv.id)}</text>
                <text x={x + 15} y={r.y + GRID + 6} className={cv.signal ? "svg-label" : "svg-muted"} transform={`rotate(90 ${x + 15} ${r.y + GRID + 6})`} dominantBaseline="central" opacity={cv.notConnected ? 0.5 : 1}>
                  {cv.notConnected ? "N/C" : sig ?? ""}
                </text>
                {!cv.notConnected && <><Handle id={c.id} handle={cv.id} p={{ x: x + 15, y: r.y }} /><Handle id={c.id} handle={cv.id} p={{ x: x + 15, y: r.y + r.h }} /></>}
              </g>
            );
          })}
        </>
      ) : (
        <>
          <path d={`M${r.x},${r.y + GRID} v-${GRID - 5} q0,-5 5,-5 h${r.w - 10} q5,0 5,5 v${GRID - 5} z`} fill="#1e293b" />
          <Header id={c.id} a={a} x={r.x} y={r.y} w={r.w} showIds={showIds} />
          {rows.map((cv, i) => {
            const y = r.y + GRID + i * GRID;
            const isShell = cv === c.shell;
            const key = `${c.id}::${cv.id}`;
            const sig = a.effectiveSignal.get(key);
            const inherited = !cv.signal && !!sig;
            return (
              <g key={cv.id} data-cavity={`${c.id}|${cv.id}`}>
                {i > 0 && <line x1={r.x} y1={y} x2={r.x + r.w} y2={y} stroke="#e2e8f0" />}
                <rect x={r.x + 1} y={y + 0.5} width={GRID} height={GRID - 1} fill="#f1f5f9" />
                <text x={r.x + 16} y={y + 15} className="svg-label" textAnchor="middle" dominantBaseline="central" style={{ fontWeight: 600, fontSize: 10.5 }}>{isShell ? "⏚" : a.designations.get(cv.id)}</text>
                <text x={r.x + GRID + 8} y={y + 15} dominantBaseline="central" className={inherited ? "svg-muted" : "svg-label"} style={{ fontStyle: inherited ? "italic" : undefined }} opacity={cv.notConnected ? 0.45 : 1}>
                  {cv.notConnected ? "N/C" : isShell && !sig ? "Shell" : clip(sig ?? "", Math.floor((r.w - 44) / 6.2))}
                  {cv.global && <tspan className="svg-muted"> ⊕</tspan>}
                  {cv.propagate === false && <tspan className="svg-muted"> ⊘</tspan>}
                </text>
                {!cv.notConnected && <><Handle id={c.id} handle={cv.id} p={{ x: r.x, y: y + 15 }} /><Handle id={c.id} handle={cv.id} p={{ x: r.x + r.w, y: y + 15 }} /></>}
              </g>
            );
          })}
        </>
      )}
      <WarnBadge x={r.x + r.w} y={r.y} level={warn} />
    </g>
  );
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + "…" : s;
}

function TerminalSymbol({ type, x, y }: { type: string; x: number; y: number }) {
  const cx = x + 15, cy = y + 15;
  switch (type) {
    case "Ring": return <g pointerEvents="none"><circle cx={cx} cy={cy} r={7} fill="none" stroke="#334155" strokeWidth={2.5} /></g>;
    case "Spade": return <path pointerEvents="none" d={`M${cx + 6},${cy - 7} h-8 a4,4 0 0 0 0,14 h8 M${cx - 2},${cy - 3} h8 M${cx - 2},${cy + 3} h8`} fill="none" stroke="#334155" strokeWidth={2} />;
    case "Ferrule": return <rect pointerEvents="none" x={cx - 8} y={cy - 4} width={16} height={8} rx={2} fill="#cbd5e1" stroke="#334155" strokeWidth={1.5} />;
    case "QuickConnectMale": return <rect pointerEvents="none" x={cx - 8} y={cy - 3} width={16} height={6} fill="#334155" />;
    case "QuickConnectFemale": return <path pointerEvents="none" d={`M${cx - 8},${cy - 5} h16 v10 h-16 M${cx - 5},${cy - 2} h10`} fill="none" stroke="#334155" strokeWidth={2} />;
    default: return <path pointerEvents="none" d={`M${cx - 8},${cy} h10 M${cx + 2},${cy} h6`} stroke="#334155" strokeWidth={3} strokeLinecap="round" />;
  }
}

function TerminalNode({ t, a, selected, dim, showIds, warn }: { t: Terminal; a: Analysis; selected: boolean; dim: boolean; showIds: boolean; warn?: string }) {
  const r = terminalRect(t);
  const key = `${t.id}::Terminal`;
  const sig = a.effectiveSignal.get(key);
  const name = nameOf(a, t.id);
  const anchors = endpointAnchors(a, { id: t.id, handle: "Terminal" });
  return (
    <g data-node={t.id} opacity={dim ? 0.35 : 1} className="node-hit">
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={15} fill="#fff" stroke={nodeStroke(selected, warn)} strokeWidth={selected ? 2.5 : 1.5} />
      <TerminalSymbol type={t.type} x={r.x} y={r.y} />
      {!t.rotated && (
        <g data-terminal-signal={t.id}>
          <text x={r.x + 30} y={r.y + 15} dominantBaseline="central" className={t.signal ? "svg-label" : "svg-muted"} style={{ fontStyle: t.signal ? undefined : "italic" }}>{clip(sig ?? terminalLabel(t.type), Math.floor((r.w - 40) / 6.2))}</text>
        </g>
      )}
      <g data-label-edit={t.id}>
        <rect x={r.x + 6} y={r.y - 18} width={Math.max(30, (name.length + (showIds && t.label ? (a.displayIds.get(t.id)?.length ?? 0) + 1 : 0)) * 6.6 + 10)} height={15} rx={3} fill="#1e293b" />
        <text x={r.x + 11} y={r.y - 10.5} dominantBaseline="central" style={{ fontSize: 10, fill: "#fff", fontWeight: 600 }}>{name}{showIds && t.label ? <tspan style={{ fill: "#94a3b8" }}> {a.displayIds.get(t.id)}</tspan> : null}</text>
      </g>
      {anchors.map((an, i) => <Handle key={i} id={t.id} handle="Terminal" p={an.p} />)}
      <WarnBadge x={r.x + r.w} y={r.y} level={warn} />
    </g>
  );
}

function InlineNode({ id, kind, el, a, selected, dim, showIds, warn }: { id: string; kind: "splices" | "diodes" | "resistors"; el: any; a: Analysis; selected: boolean; dim: boolean; showIds: boolean; warn?: string }) {
  const r = smallRect(el);
  const cx = r.x + 15, cy = r.y + 15;
  const name = nameOf(a, id);
  const showTag = showIds || !!el.label;
  const stroke = selected ? "#2563eb" : "#0f172a";
  const rot = el.rotated ? `rotate(90 ${cx} ${cy})` : undefined;
  let symbol;
  if (kind === "splices") symbol = <circle cx={cx} cy={cy} r={selected ? 8 : 7} fill={stroke} />;
  else if (kind === "diodes") {
    const flip = el.anodeOnRight ? `rotate(180 ${cx} ${cy})` : "";
    symbol = <g transform={`${rot ?? ""} ${flip}`}><rect x={r.x} y={r.y} width={30} height={30} fill="transparent" /><line x1={r.x} y1={cy} x2={r.x + 30} y2={cy} stroke={stroke} strokeWidth={2} /><path d={`M${cx - 7},${cy - 8} L${cx + 6},${cy} L${cx - 7},${cy + 8} z`} fill={stroke} /><line x1={cx + 7} y1={cy - 8} x2={cx + 7} y2={cy + 8} stroke={stroke} strokeWidth={2.5} /></g>;
  } else {
    symbol = <g transform={rot}><rect x={r.x} y={r.y} width={30} height={30} fill="transparent" /><line x1={r.x} y1={cy} x2={r.x + 30} y2={cy} stroke={stroke} strokeWidth={2} /><rect x={cx - 9} y={cy - 5} width={18} height={10} fill="#fff" stroke={stroke} strokeWidth={2} /></g>;
  }
  const anchors = kind === "splices"
    ? [{ handle: "Splice", p: { x: r.x, y: cy } }, { handle: "Splice", p: { x: r.x + 30, y: cy } }]
    : (["Left", "Right"] as const).map((hd) => ({ handle: hd, p: endpointAnchors(a, { id, handle: hd })[0].p }));
  return (
    <g data-node={id} opacity={dim ? 0.35 : 1} className="node-hit">
      {kind === "splices" && <rect x={r.x + 4} y={r.y + 4} width={22} height={22} fill="transparent" />}
      {symbol}
      {showTag && (
        <g data-label-edit={id}>
          <rect x={cx - (name.length * 6.4 + 10) / 2} y={r.y - 17} width={name.length * 6.4 + 10} height={15} rx={3} fill="#1e293b" />
          <text x={cx} y={r.y - 9.5} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 10, fill: "#fff", fontWeight: 600 }}>{name}</text>
        </g>
      )}
      {anchors.map((an, i) => <circle key={i} className="handle" data-cp-id={id} data-cp-handle={an.handle} cx={an.p.x} cy={an.p.y} r={3.5} fill="#fff" stroke="#334155" strokeWidth={1.2} />)}
      <WarnBadge x={r.x + 30} y={r.y} level={warn} />
    </g>
  );
}

function GroupNode({ el, kind, a, h, selected, dim }: { el: Cable | TwistedWires; kind: "cables" | "twistedWires"; a: Analysis; h: Harness; selected: boolean; dim: boolean }) {
  const r = conductorGroupRect(el, kind);
  const rows = kind === "cables" ? [...(el as Cable).cores, ...((el as Cable).shield ? [(el as Cable).shield!] : [])] : (el as TwistedWires).wires;
  const name = nameOf(a, el.id);
  const part = kind === "cables" ? h.cableParts.find((p) => p.id === (el as Cable).partId) : undefined;
  const jacket = part?.color ? colorHex(part.color) : "#475569";
  return (
    <g data-node={el.id} opacity={dim ? 0.35 : 1} className="node-hit">
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={kind === "cables" ? 12 : 6} fill={kind === "cables" ? "#f8fafc" : "#fff"} stroke={selected ? "#2563eb" : jacket} strokeWidth={selected ? 2.5 : 2} strokeDasharray={kind === "twistedWires" ? "4 3" : undefined} />
      <g data-label-edit={el.id}>
        <text x={r.x + r.w / 2} y={r.y + 15} textAnchor="middle" dominantBaseline="central" className="svg-label" style={{ fontWeight: 700, fontSize: 10 }}>{clip(name, kind === "cables" ? 9 : 14)}</text>
      </g>
      {rows.map((k, i) => {
        const { a: an, b } = coreAnchors(el, kind, i);
        const isShield = kind === "cables" && k === (el as Cable).shield;
        const col = isShield ? "#94a3b8" : colorHex(k.color);
        return (
          <g key={k.id}>
            {kind === "twistedWires" && !el.rotated ? (
              <path d={`M${an.p.x + 6},${an.p.y} C${an.p.x + 30},${an.p.y - 10} ${b.p.x - 30},${b.p.y + 10} ${b.p.x - 6},${b.p.y}`} stroke={col} strokeWidth={3} fill="none" />
            ) : (
              <line x1={an.p.x} y1={an.p.y} x2={b.p.x} y2={b.p.y} stroke={col} strokeWidth={3} strokeDasharray={isShield ? "5 4" : undefined} />
            )}
            {k.stripeColor && <line x1={an.p.x} y1={an.p.y} x2={b.p.x} y2={b.p.y} stroke={colorHex(k.stripeColor)} strokeWidth={1.5} strokeDasharray="4 5" />}
            <circle className="handle" data-slot={`${el.id}|${k.id}|source`} cx={an.p.x} cy={an.p.y} r={4.5} fill={k.source ? "#334155" : "#fff"} stroke="#334155" strokeWidth={1.5} />
            <circle className="handle" data-slot={`${el.id}|${k.id}|target`} cx={b.p.x} cy={b.p.y} r={4.5} fill={k.target ? "#334155" : "#fff"} stroke="#334155" strokeWidth={1.5} />
          </g>
        );
      })}
    </g>
  );
}

function NoteNode({ n, selected }: { n: Note; selected: boolean }) {
  const p = n.schematicPosition ?? { x: 0, y: 0 };
  const w = n.width ?? 150;
  return (
    <g data-node={n.id} className="node-hit">
      <g data-note={n.id}>
        <rect x={p.x} y={p.y} width={w} height={60} rx={4} fill={colorHex(n.color ?? "Light Yellow")} fillOpacity={0.6} stroke={selected ? "#2563eb" : "#e5d58a"} strokeWidth={selected ? 2 : 1} />
        <foreignObject x={p.x + 6} y={p.y + 4} width={w - 12} height={52} pointerEvents="none">
          <div style={{ fontSize: 11, lineHeight: 1.35, color: "#1f2937", textAlign: (n.alignment ?? "Left").toLowerCase() as any, overflow: "hidden", height: "100%", whiteSpace: "pre-wrap" }}>{n.text}</div>
        </foreignObject>
      </g>
    </g>
  );
}

function midpoint(points: Pos[]): { p: Pos; horizontal: boolean } {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (acc + l >= total / 2 && l > 0) {
      const t = (total / 2 - acc) / l;
      return { p: { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t }, horizontal: Math.abs(points[i].y - points[i - 1].y) < 0.5 };
    }
    acc += l;
  }
  return { p: points[0], horizontal: true };
}

function WireIdTag({ points, text }: { points: Pos[]; text: string }) {
  const { p, horizontal } = midpoint(points);
  return (
    <g pointerEvents="none">
      <rect x={p.x - text.length * 3.2 - 4} y={p.y - (horizontal ? 15 : 6)} width={text.length * 6.4 + 8} height={12} rx={3} fill="#fff" fillOpacity={0.9} />
      <text x={p.x} y={p.y - (horizontal ? 9 : 0)} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 9, fill: "#475569", fontWeight: 600 }}>{text}</text>
    </g>
  );
}

function IdentTag({ points, label, colors }: { points: Pos[]; label?: string; colors?: string[] }) {
  const { p } = midpoint(points);
  const text = label ?? "";
  const w = Math.max(text.length * 6.4 + 8, (colors?.length ?? 0) * 8);
  return (
    <g pointerEvents="none">
      {colors?.length && !text ? colors.map((c, i) => <rect key={i} x={p.x - (colors.length * 8) / 2 + i * 8} y={p.y + 4} width={7} height={10} fill={colorHex(c)} stroke="#334155" strokeWidth={0.5} />) : null}
      {text && (
        <>
          <rect x={p.x - w / 2} y={p.y + 4} width={w} height={12} rx={2} fill={colors?.[0] ? colorHex(colors[0]) : "#fff"} stroke="#334155" strokeWidth={0.6} />
          <text x={p.x} y={p.y + 10} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 9, fontWeight: 700, fill: colors?.[0] && !isLight(colors[0]) ? "#fff" : "#0f172a" }}>{text}</text>
        </>
      )}
    </g>
  );
}

function InlineEditor({ editing, h, a, onDone }: { editing: NonNullable<Editing>; h: Harness; a: Analysis; onDone: (next: Editing) => void }) {
  const update = useStore((s) => s.update);
  let rect: Rect;
  let initial = "";
  let multiline = false;
  if (editing.kind === "signal") {
    const c = h.connectors.find((x) => x.id === editing.connectorId);
    if (!c) return null;
    const rows = [...c.cavities, ...(c.shell ? [c.shell] : [])];
    const i = rows.findIndex((x) => x.id === editing.cavityId);
    const r = connectorRect(c);
    rect = c.rotated ? { x: r.x + GRID + i * GRID - 40, y: r.y + GRID, w: 110, h: 24 } : { x: r.x + GRID + 2, y: r.y + GRID + i * GRID + 3, w: Math.max(90, r.w - GRID - 6), h: 24 };
    initial = rows[i]?.signal ?? "";
  } else if (editing.kind === "terminalSignal") {
    const t = h.terminals.find((x) => x.id === editing.id);
    if (!t) return null;
    const r = terminalRect(t);
    rect = { x: r.x + 26, y: r.y + 3, w: Math.max(90, r.w - 32), h: 24 };
    initial = t.signal ?? "";
  } else if (editing.kind === "label") {
    const r = schematicRect(a, editing.id);
    if (!r) return null;
    rect = { x: r.x, y: r.y - 26, w: Math.max(120, r.w), h: 24 };
    initial = (a.elements.get(editing.id)?.el.label as string) ?? "";
  } else {
    const n = h.schematicNotes.find((x) => x.id === editing.id);
    if (!n) return null;
    const p = n.schematicPosition ?? { x: 0, y: 0 };
    rect = { x: p.x, y: p.y, w: n.width ?? 150, h: 60 };
    initial = n.text;
    multiline = true;
  }

  const commit = (value: string) => {
    update((d) => {
      if (editing.kind === "signal") {
        const c = d.connectors.find((x) => x.id === editing.connectorId)!;
        const cv = c.cavities.find((x) => x.id === editing.cavityId) ?? c.shell;
        if (cv) { if (value.trim()) cv.signal = value.trim(); else delete cv.signal; }
      } else if (editing.kind === "terminalSignal") {
        const t = d.terminals.find((x) => x.id === editing.id)!;
        if (value.trim()) t.signal = value.trim(); else delete t.signal;
      } else if (editing.kind === "label") {
        for (const k of ["connectors", "terminals", "splices", "diodes", "resistors", "cables", "twistedWires"] as const) {
          const el = (d[k] as any[]).find((x) => x.id === editing.id);
          if (el) { if (value.trim()) el.label = value.trim(); else delete el.label; }
        }
      } else {
        const n = d.schematicNotes.find((x) => x.id === editing.id)!;
        n.text = value;
      }
    });
  };

  const step = (dir: 1 | -1): Editing => {
    if (editing.kind !== "signal") return null;
    const c = h.connectors.find((x) => x.id === editing.connectorId)!;
    const rows = [...c.cavities, ...(c.shell ? [c.shell] : [])].filter((x) => !x.notConnected);
    const i = rows.findIndex((x) => x.id === editing.cavityId);
    const next = rows[i + dir];
    return next ? { kind: "signal", connectorId: c.id, cavityId: next.id } : null;
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (editing.kind !== "signal") return;
    const lines = e.clipboardData.getData("text").split(/\r?\n/);
    if (lines.length < 2) return;
    e.preventDefault();
    update((d) => {
      const c = d.connectors.find((x) => x.id === editing.connectorId)!;
      const rows = c.cavities.filter((x) => !x.notConnected);
      let i = rows.findIndex((x) => x.id === editing.cavityId);
      for (const line of lines) {
        if (i < 0 || i >= rows.length) break;
        if (line.trim()) rows[i].signal = line.trim();
        i++;
      }
    });
    onDone(null);
  };

  return (
    <foreignObject x={rect.x} y={rect.y} width={rect.w} height={rect.h} key={JSON.stringify(editing)}>
      {multiline ? (
        <textarea autoFocus className="inline-edit" defaultValue={initial} style={{ resize: "none" }}
          onBlur={(e) => { commit(e.target.value); onDone(null); }}
          onKeyDown={(e) => { if (e.key === "Escape") onDone(null); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur(); }} />
      ) : (
        <input autoFocus className="inline-edit" defaultValue={initial} onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => { commit(e.target.value); onDone(null); }}
          onKeyDown={(e) => {
            const target = e.target as HTMLInputElement;
            if (e.key === "Escape") { target.value = initial; onDone(null); }
            else if (e.key === "Enter") target.blur();
            else if (e.key === "Tab") { e.preventDefault(); commit(target.value); onDone(step(e.shiftKey ? -1 : 1)); }
          }} />
      )}
    </foreignObject>
  );
}

