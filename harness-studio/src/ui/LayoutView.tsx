import { produce } from "immer";
import { useMemo, useRef, useState } from "react";
import { type Analysis, findPart, nameOf } from "../model/analysis";
import { colorHex, isLight } from "../model/colors";
import { distToSegment, layoutCenter } from "../model/geometry";
import { GRID, addBundle, addMate, deleteElements, makeIdFactory, snap, translateElements } from "../model/ops";
import type { Bundle, Harness, Length, Note, Pos } from "../model/types";
import { estimateWireDiameter, formatLength, parseLengthExpression as parseLength, toMm } from "../model/units";
import { partName } from "../model/validation";
import { useStore } from "../store";
import { add, addMenuItems, bundleMenu, connectorMenu, genericMenu } from "./actions";
import { Canvas, type CanvasApi, startDrag, useBackgroundClick } from "./Canvas";
import { openMenu } from "./ContextMenu";
import { analysisOf, computeHighlight } from "./hooks";
import { ViewToggles } from "./ViewToggles";

type Preview = { key: string; fn: (h: Harness) => void } | null;

export function LayoutView() {
  const h = useStore((s) => s.h);
  const selection = useStore((s) => s.selection);
  const options = useStore((s) => s.options);
  const { select, update, notify } = useStore.getState();
  const api = useRef<CanvasApi>(null);
  const [preview, setPreview] = useState<Preview>(null);
  const [draw, setDraw] = useState<{ from: string; start: Pos; cur: Pos; mate: boolean } | null>(null);
  const [editingLength, setEditingLength] = useState<string | null>(null);

  const dh = useMemo(() => (preview ? produce(h, preview.fn) : h), [h, preview]);
  const { a, issues } = analysisOf(dh);
  const sel = useMemo(() => new Set(selection), [selection]);
  const hl = useMemo(() => computeHighlight(a, selection, options.highlightNets), [a, selection, options.highlightNets]);
  const warned = useMemo(() => new Set(issues.filter((i) => i.severity !== "info").flatMap((i) => i.targetIds)), [issues]);
  useBackgroundClick(api, () => select([]));

  const center = (id: string): Pos | undefined => {
    const el = a.elements.get(id)?.el;
    return el ? layoutCenter(el) : undefined;
  };
  const bundlePoints = (b: Bundle): Pos[] => {
    const s = center(b.sourceId), t = center(b.targetId);
    if (!s || !t) return [];
    return [s, ...(b.layoutPoints ?? []).map((p) => p.layoutPosition).filter((p): p is Pos => !!p), t];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !api.current) return;
    const t = e.target as Element;
    if (t.closest("foreignObject")) return;
    e.stopPropagation();
    const bh = t.closest("[data-bnode]");
    const lp = t.closest("[data-lp]");
    const bundle = t.closest("[data-bundle]");
    const mate = t.closest("[data-mate]");
    const node = t.closest("[data-node]");
    if (bh) {
      const from = bh.getAttribute("data-bnode")!;
      const start = center(from)!;
      setDraw({ from, start, cur: start, mate: e.shiftKey });
      startDrag(e, api.current, {
        onMove: (_d, w, ev) => setDraw((s) => s && { ...s, cur: w, mate: ev.shiftKey }),
        onUp: (_d, _w, target, ev) => {
          setDraw(null);
          const to = target?.closest("[data-bnode]")?.getAttribute("data-bnode") ?? target?.closest("[data-node]")?.getAttribute("data-node");
          if (!to || to === from) return;
          const kinds = [a.elements.get(from)?.kind, a.elements.get(to)?.kind];
          if (ev.shiftKey) {
            if (!kinds.every((k) => k === "connectors" || k === "terminals")) { notify("Mates join connectors and terminals"); return; }
            let id: string | undefined;
            update((d) => {
              const toConn = d.connectors.find((c) => c.id === to);
              const fromTerm = d.terminals.some((x) => x.id === from);
              const cav = fromTerm && toConn ? toConn.cavities.find((cv) => !a.connections.get(`${to}::${cv.id}`)?.length) ?? toConn.cavities[0] : undefined;
              id = addMate(d, from, to, cav?.id);
            });
            if (id) select([id]);
            return;
          }
          if (!kinds.every((k) => k === "connectors" || k === "terminals" || k === "branchPoints")) { notify("Bundles run between connectors, terminals and branch points"); return; }
          let id: string | undefined;
          update((d) => { id = addBundle(d, from, to); });
          if (id) select([id]);
        },
      });
      return;
    }
    if (lp) {
      const id = lp.getAttribute("data-lp")!;
      startDrag(e, api.current, {
        onMove: (d) => setPreview({ key: `${Math.round(d.x / GRID)},${Math.round(d.y / GRID)}`, fn: (x) => translateElements(x, [id], d.x, d.y, "layout") }),
        onUp: (d, _w, target, _ev, moved) => {
          setPreview(null);
          if (!moved) return;
          const bp = target?.closest("[data-node]")?.getAttribute("data-node");
          if (bp && h.branchPoints.some((b) => b.id === bp)) { update((x) => joinLayoutPointToBranch(x, id, bp)); return; }
          update((x) => translateElements(x, [id], d.x, d.y, "layout"));
        },
      });
      return;
    }
    if (bundle || mate) {
      const id = (bundle ?? mate)!.getAttribute(bundle ? "data-bundle" : "data-mate")!;
      select([id], e.shiftKey || e.metaKey || e.ctrlKey ? "toggle" : "replace");
      return;
    }
    if (node) {
      const id = node.getAttribute("data-node")!;
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      let ids = selection;
      if (additive) { select([id], "toggle"); ids = sel.has(id) ? selection.filter((x) => x !== id) : [...selection, id]; }
      else if (!sel.has(id)) { select([id]); ids = [id]; }
      startDrag(e, api.current, {
        onMove: (d) => setPreview({ key: `${Math.round(d.x / GRID)},${Math.round(d.y / GRID)}`, fn: (x) => translateElements(x, ids, d.x, d.y, "layout") }),
        onUp: (d, _w, target, _ev, moved) => {
          setPreview(null);
          if (!moved) { if (!additive) select([id]); return; }
          const dropOn = target?.closest("[data-node]")?.getAttribute("data-node");
          if (ids.length === 1 && dropOn && dropOn !== id && h.branchPoints.some((b) => b.id === id) && h.branchPoints.some((b) => b.id === dropOn)) {
            update((x) => mergeBranchPoints(x, id, dropOn));
            select([dropOn]);
            return;
          }
          update((x) => translateElements(x, ids, d.x, d.y, "layout"));
        },
      });
    }
  };

  const onDoubleClick = (e: React.MouseEvent, world: Pos) => {
    const t = e.target as Element;
    const lp = t.closest("[data-lp]");
    if (lp) { const id = lp.getAttribute("data-lp")!; update((d) => deleteElements(d, [id])); return; }
    const len = t.closest("[data-length]");
    if (len) { setEditingLength(len.getAttribute("data-length")); return; }
    const bundle = t.closest("[data-bundle]");
    if (bundle) {
      const id = bundle.getAttribute("data-bundle")!;
      const b = h.bundles.find((x) => x.id === id)!;
      const pts = bundlePoints(b);
      let best = 1, bestD = Infinity;
      for (let i = 1; i < pts.length; i++) { const dd = distToSegment(world, pts[i - 1], pts[i]); if (dd < bestD) { bestD = dd; best = i; } }
      update((d) => {
        const x = d.bundles.find((k) => k.id === id)!;
        const list = x.layoutPoints ?? [];
        list.splice(best - 1, 0, { id: makeIdFactory(d)(6), layoutPosition: { x: snap(world.x), y: snap(world.y) } });
        x.layoutPoints = list;
      });
      select([id]);
    }
  };

  const onContextMenu = (e: React.MouseEvent, world: Pos) => {
    const t = e.target as Element;
    const lp = t.closest("[data-lp]");
    if (lp) { const id = lp.getAttribute("data-lp")!; openMenu(e, [{ label: "Delete layout point", danger: true, onClick: () => update((d) => deleteElements(d, [id])) }]); return; }
    const bundle = t.closest("[data-bundle]");
    if (bundle) {
      const id = bundle.getAttribute("data-bundle")!;
      select([id]);
      openMenu(e, [{ label: "Set length…", onClick: () => setEditingLength(id) }, ...bundleMenu(h, id, world)]);
      return;
    }
    const mate = t.closest("[data-mate]");
    if (mate) { const id = mate.getAttribute("data-mate")!; openMenu(e, [{ heading: "Mate" }, { label: "Delete mate", danger: true, onClick: () => update((d) => deleteElements(d, [id])) }]); return; }
    const node = t.closest("[data-node]");
    if (node) {
      const id = node.getAttribute("data-node")!;
      if (!sel.has(id)) select([id]);
      const ref = a.elements.get(id)!;
      if (ref.kind === "connectors") openMenu(e, connectorMenu(h, id));
      else if (ref.kind === "branchPoints") openMenu(e, branchPointMenu(h, id));
      else if (ref.kind === "layoutNotes") openMenu(e, [{ label: "Delete note", danger: true, onClick: () => update((d) => deleteElements(d, [id])) }]);
      else openMenu(e, genericMenu(h, id, ref.kind, ref.kind === "terminals" ? "Terminal" : ref.kind.slice(0, -1)));
      return;
    }
    openMenu(e, addMenuItems(world, "layout"));
  };

  const viewCenter = (): Pos => {
    const svg = api.current?.svg();
    if (!svg || !api.current) return { x: 300, y: 300 };
    const r = svg.getBoundingClientRect();
    return api.current.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };

  const selectedBundle = selection.length === 1 ? h.bundles.find((b) => b.id === selection[0]) : undefined;
  const isEmpty = !h.connectors.length && !h.terminals.length && !h.branchPoints.length;

  return (
    <div className="stage">
      <Canvas ref={api} viewKey="layout" onContextMenu={onContextMenu} onDoubleClick={onDoubleClick}
        overlay={<>
          <div className="palette">
            <button onClick={() => add("branchPoint", viewCenter())}>◉ Branch point</button>
            <button onClick={() => add("connector", viewCenter())}>▭ Connector</button>
            <button onClick={() => add("terminal", viewCenter(), "Ring")}>◎ Terminal</button>
            <button onClick={() => add("layoutNote", viewCenter())}>✎ Note</button>
            <div className="hint">Drag from a node's handle to another node to draw a bundle. Hold Shift to mate.</div>
          </div>
          {selectedBundle && <CrossSection h={h} a={a} bundle={selectedBundle} />}
          <ViewToggles view="layout" />
          {isEmpty && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", color: "#94a3b8" }}>Add connectors in the Schematic view; they appear here for physical routing.</div>}
        </>}>
        <g onPointerDown={onPointerDown}>
          {dh.layoutNotes.map((n) => <LayoutNote key={n.id} n={n} selected={sel.has(n.id)} />)}
          {dh.bundles.map((b) => {
            const pts = bundlePoints(b);
            if (pts.length < 2) return null;
            const d = "M" + pts.map((p) => `${p.x},${p.y}`).join(" L");
            const diam = a.bundleDiameterMm.get(b.id) ?? 0;
            const width = Math.max(6, Math.min(22, diam * 1.5 + 4));
            const covers = (b.partIds ?? []).map((id) => findPart(h, "coveringParts", id)).filter(Boolean) as any[];
            const outer = covers[covers.length - 1];
            const fill = outer?.color ? colorHex(outer.color) : "#94a3b8";
            const selected = sel.has(b.id);
            const lit = hl.bundles.has(b.id);
            const faded = hl.active && !lit && !selected;
            const mid = midOf(pts);
            const len = b.length ? formatLength(toMm(b.length), h.lengthUnit, 1) : undefined;
            const estimated = !b.length;
            return (
              <g key={b.id} opacity={faded ? 0.3 : 1}>
                {selected && <path d={d} stroke="#3b82f6" strokeOpacity={0.35} strokeWidth={width + 9} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
                {lit && !selected && <path d={d} stroke="#f59e0b" strokeOpacity={0.55} strokeWidth={width + 7} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
                <path d={d} stroke={isLight(outer?.color) ? "#64748b" : "#334155"} strokeWidth={width + 2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                <path d={d} stroke={fill} strokeWidth={width} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                {outer?.type === "BraidedSleeve" && <path d={d} stroke="#fff" strokeOpacity={0.25} strokeWidth={width - 2} strokeDasharray="2 3" fill="none" />}
                {outer?.type === "CorrugatedTubing" && <path d={d} stroke="#000" strokeOpacity={0.25} strokeWidth={width - 1} strokeDasharray="1.5 3" fill="none" />}
                <path d={d} stroke="transparent" strokeWidth={width + 12} fill="none" data-bundle={b.id} style={{ cursor: "pointer" }} />
                <g data-length={b.id} style={{ cursor: "text" }}>
                  <rect x={mid.x - 34} y={mid.y - width / 2 - 21} width={68} height={16} rx={4} fill={estimated ? "#fef3c7" : "#fff"} stroke={warned.has(b.id) ? "#d97706" : "#cbd5e1"} />
                  <text x={mid.x} y={mid.y - width / 2 - 13} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 10, fontWeight: 600, fill: estimated ? "#92400e" : "#0f172a", fontStyle: estimated ? "italic" : undefined }}>
                    {len ?? "set length"}
                  </text>
                </g>
                {(b.label || options.showIds) && (
                  <text x={mid.x} y={mid.y + width / 2 + 12} textAnchor="middle" className="svg-muted" style={{ fill: b.labelColor ? colorHex(b.labelColor) : undefined, fontWeight: 600 }}>
                    {[options.showIds ? a.displayIds.get(b.id) : "", b.label].filter(Boolean).join(" · ")}
                  </text>
                )}
                {options.showParts && covers.length > 0 && (
                  <text x={mid.x} y={mid.y + width / 2 + 24} textAnchor="middle" className="svg-muted">{covers.map((c) => partName(c)).join(" + ")}</text>
                )}
                {selected && (b.layoutPoints ?? []).map((lp) => lp.layoutPosition && (
                  <circle key={lp.id} className="lp" data-lp={lp.id} cx={lp.layoutPosition.x} cy={lp.layoutPosition.y} r={6} fill="#fff" stroke="#2563eb" strokeWidth={2} />
                ))}
              </g>
            );
          })}
          {dh.mates.map((m) => {
            const s = center(m.sourceId), t = center(m.targetId);
            if (!s || !t) return null;
            const selected = sel.has(m.id);
            return (
              <g key={m.id}>
                <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={warned.has(m.id) ? "#dc2626" : "#7c3aed"} strokeWidth={selected ? 5 : 3} strokeDasharray="2 5" strokeLinecap="round" />
                <line x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="transparent" strokeWidth={14} data-mate={m.id} style={{ cursor: "pointer" }} />
              </g>
            );
          })}
          {options.showInline && [...dh.splices, ...dh.diodes, ...dh.resistors].map((el) => {
            const loc = a.inlineLocation.get(el.id);
            const lc = loc ? center(loc) : undefined;
            const c = layoutCenter(el);
            const kind = a.elements.get(el.id)!.kind;
            const selected = sel.has(el.id);
            const faded = hl.active && !hl.elements.has(el.id) && !selected;
            return (
              <g key={el.id} data-node={el.id} className="node-hit" opacity={faded ? 0.3 : 1}>
                {lc && <line x1={c.x} y1={c.y} x2={lc.x} y2={lc.y} stroke="#94a3b8" strokeWidth={1.2} strokeDasharray="3 3" markerEnd="url(#arrow)" pointerEvents="none" />}
                <rect x={c.x - 9} y={c.y - 9} width={18} height={18} rx={kind === "splices" ? 9 : 3} fill="#fff" stroke={selected ? "#2563eb" : "#475569"} strokeWidth={selected ? 2.5 : 1.5} />
                <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 8, fontWeight: 700, fill: "#334155" }}>{kind === "splices" ? "S" : kind === "diodes" ? "D" : "R"}</text>
                <text x={c.x} y={c.y - 15} textAnchor="middle" className="svg-muted">{nameOf(a, el.id)}{el.locationId ? "" : " (auto)"}</text>
              </g>
            );
          })}
          {[...dh.connectors, ...dh.terminals, ...dh.branchPoints].map((el) => (
            <LayoutNode key={el.id} id={el.id} a={a} h={dh} selected={sel.has(el.id)} faded={hl.active && !hl.elements.has(el.id) && !sel.has(el.id) && a.elements.get(el.id)?.kind !== "branchPoints"} warn={warned.has(el.id)} showIds={options.showIds} showParts={options.showParts} />
          ))}
          {draw && (
            <path d={`M${draw.start.x},${draw.start.y} L${draw.cur.x},${draw.cur.y}`} stroke={draw.mate ? "#7c3aed" : "#475569"} strokeWidth={draw.mate ? 3 : 8} strokeOpacity={0.6} strokeDasharray={draw.mate ? "2 5" : undefined} strokeLinecap="round" fill="none" pointerEvents="none" />
          )}
          {editingLength && <LengthEditor h={h} id={editingLength} pos={midOf(bundlePoints(h.bundles.find((b) => b.id === editingLength) ?? h.bundles[0]))} onDone={() => setEditingLength(null)} />}
        </g>
      </Canvas>
    </div>
  );
}

function midOf(pts: Pos[]): Pos {
  if (pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + l >= total / 2 && l > 0) {
      const t = (total / 2 - acc) / l;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    acc += l;
  }
  return pts[0];
}

function LayoutNode({ id, a, h, selected, faded, warn, showIds, showParts }: { id: string; a: Analysis; h: Harness; selected: boolean; faded: boolean; warn: boolean; showIds: boolean; showParts: boolean }) {
  const ref = a.elements.get(id)!;
  const el = ref.el;
  const p = el.layoutPosition ?? el.schematicPosition ?? { x: 0, y: 0 };
  const c = { x: p.x + 15, y: p.y + 15 };
  const name = nameOf(a, id);
  const stroke = selected ? "#2563eb" : warn ? "#d97706" : "#0f172a";
  let body;
  let partLabel: string | undefined;
  if (ref.kind === "connectors") {
    const part = findPart(h, "connectorParts", el.partId);
    partLabel = part?.partNumber;
    body = (
      <>
        <rect x={p.x} y={p.y} width={30} height={30} rx={5} fill={part?.color ? colorHex(part.color) : "#475569"} stroke={stroke} strokeWidth={selected ? 3 : 1.5} />
        <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 9, fontWeight: 700, fill: isLight(part?.color) ? "#0f172a" : "#fff" }}>{el.cavities.length}</text>
      </>
    );
  } else if (ref.kind === "terminals") {
    partLabel = findPart(h, "terminalParts", el.partId)?.partNumber;
    body = (
      <>
        <rect x={p.x} y={p.y} width={30} height={30} fill="transparent" />
        <circle cx={c.x} cy={c.y} r={9} fill="#e2e8f0" stroke={stroke} strokeWidth={selected ? 3 : 2.5} />
        <circle cx={c.x} cy={c.y} r={3.5} fill="#fff" stroke={stroke} strokeWidth={1} />
      </>
    );
  } else {
    const boot = (el.partIds ?? []).map((pid: string) => findPart(h, "bootParts", pid) ?? findPart(h, "coveringParts", pid)).find(Boolean);
    partLabel = (el.partIds ?? []).map((pid: string) => partName((findPart(h, "bootParts", pid) ?? findPart(h, "coveringParts", pid)) as any ?? { id: pid })).join(" + ") || undefined;
    body = (
      <>
        <rect x={p.x} y={p.y} width={30} height={30} fill="transparent" />
        <circle cx={c.x} cy={c.y} r={selected ? 9 : 8} fill={boot?.color ? colorHex(boot.color) : "#64748b"} stroke={selected ? "#2563eb" : "#1e293b"} strokeWidth={selected ? 3 : 1.5} />
      </>
    );
  }
  const handle = ref.kind === "branchPoints" ? { x: c.x + 14, y: c.y - 14 } : { x: p.x + 36, y: c.y };
  return (
    <g data-node={id} className="node-hit" opacity={faded ? 0.35 : 1}>
      {body}
      <text x={c.x} y={p.y - 7} textAnchor="middle" className="svg-label" style={{ fontWeight: 600 }}>
        {ref.kind === "branchPoints" && !el.label && !showIds ? "" : name}
        {showIds && el.label ? <tspan className="svg-muted"> {a.displayIds.get(id)}</tspan> : null}
      </text>
      {showParts && partLabel && <text x={c.x} y={p.y + 44} textAnchor="middle" className="svg-muted">{partLabel}</text>}
      <circle className="handle" data-bnode={id} cx={handle.x} cy={handle.y} r={5} fill="#fff" stroke="#334155" strokeWidth={1.5}>
        <title>Drag to draw a bundle (Shift: mate)</title>
      </circle>
    </g>
  );
}

function LayoutNote({ n, selected }: { n: Note; selected: boolean }) {
  const p = n.layoutPosition ?? { x: 0, y: 0 };
  const w = n.width ?? 150;
  return (
    <g data-node={n.id} className="node-hit">
      <rect x={p.x} y={p.y} width={w} height={60} rx={4} fill={colorHex(n.color ?? "Light Yellow")} fillOpacity={0.6} stroke={selected ? "#2563eb" : "#e5d58a"} />
      <foreignObject x={p.x + 6} y={p.y + 4} width={w - 12} height={52} pointerEvents="none">
        <div style={{ fontSize: 11, lineHeight: 1.35, color: "#1f2937", whiteSpace: "pre-wrap", overflow: "hidden", height: "100%" }}>{n.text}</div>
      </foreignObject>
    </g>
  );
}

function LengthEditor({ h, id, pos, onDone }: { h: Harness; id: string; pos: Pos; onDone: () => void }) {
  const update = useStore((s) => s.update);
  const b = h.bundles.find((x) => x.id === id);
  const [v, setV] = useState(b?.length ? `${b.length.value} ${b.length.unit}` : "");
  if (!b) return null;
  let preview = "";
  let parsed: Length | undefined;
  try { parsed = v.trim() ? parseLength(v, h.lengthUnit) : undefined; preview = parsed ? `= ${parsed.value} ${parsed.unit}` : ""; } catch (e) { preview = (e as Error).message; parsed = undefined; }
  const commit = () => {
    update((d) => { const x = d.bundles.find((k) => k.id === id)!; if (parsed) x.length = parsed; else if (!v.trim()) delete x.length; });
    onDone();
  };
  return (
    <foreignObject x={pos.x - 80} y={pos.y - 52} width={160} height={50}>
      <div>
        <input autoFocus className="inline-edit" style={{ height: 26 }} value={v} placeholder={`e.g. 40 + 30 ${h.lengthUnit}`} onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") onDone(); }} onBlur={commit} />
        {preview && <div style={{ fontSize: 11, background: "#fff", padding: "1px 4px", borderRadius: 3, color: parsed ? "#16a34a" : "#dc2626" }}>{preview}</div>}
      </div>
    </foreignObject>
  );
}


function branchPointMenu(h: Harness, id: string) {
  const { update, select } = useStore.getState();
  const parts = [...h.bootParts, ...h.coveringParts];
  return [
    { heading: "Branch point" },
    {
      label: "Assign boot or covering",
      children: [
        ...parts.map((p) => ({ label: partName(p), onClick: () => update((d) => { const x = d.branchPoints.find((k) => k.id === id)!; x.partIds = [...(x.partIds ?? []), p.id]; }) })),
        ...(parts.length ? [] : [{ label: "No boot or covering parts yet", disabled: true }]),
      ],
    },
    { separator: true as const },
    { label: "Delete", kbd: "Del", danger: true, onClick: () => { update((d) => deleteElements(d, [id])); select([]); } },
  ];
}

/** Dropping a bundle's layout point on a branch point splits the bundle there. */
function joinLayoutPointToBranch(h: Harness, lpId: string, bpId: string) {
  const b = h.bundles.find((x) => x.layoutPoints?.some((p) => p.id === lpId));
  if (!b || b.sourceId === bpId || b.targetId === bpId) return;
  const i = b.layoutPoints!.findIndex((p) => p.id === lpId);
  const before = b.layoutPoints!.slice(0, i), after = b.layoutPoints!.slice(i + 1);
  const id = makeIdFactory(h)();
  h.bundles.push({ id, sourceId: bpId, targetId: b.targetId, ...(after.length ? { layoutPoints: after } : {}), ...(b.partIds?.length ? { partIds: [...b.partIds] } : {}) });
  b.targetId = bpId;
  b.layoutPoints = before;
  delete b.length;
}

function mergeBranchPoints(h: Harness, fromId: string, intoId: string) {
  for (const b of h.bundles) {
    if (b.sourceId === fromId) b.sourceId = intoId;
    if (b.targetId === fromId) b.targetId = intoId;
  }
  h.bundles = h.bundles.filter((b) => b.sourceId !== b.targetId);
  for (const el of [...h.splices, ...h.diodes, ...h.resistors]) if (el.locationId === fromId) el.locationId = intoId;
  const from = h.branchPoints.find((b) => b.id === fromId);
  const into = h.branchPoints.find((b) => b.id === intoId);
  if (from?.partIds?.length && into) into.partIds = [...(into.partIds ?? []), ...from.partIds];
  h.branchPoints = h.branchPoints.filter((b) => b.id !== fromId);
}

function CrossSection({ h, a, bundle }: { h: Harness; a: Analysis; bundle: Bundle }) {
  const ids = a.conductorsInBundle.get(bundle.id) ?? [];
  const items: { d: number; color: string; stripe?: string; id: string }[] = [];
  const cablesDone = new Set<string>();
  const inside = new Set(ids);
  for (const id of ids) {
    const c = a.conductorById.get(id)!;
    if ((c.kind === "core" || c.kind === "shield") && c.parentId) {
      const cable = a.elements.get(c.parentId)!.el;
      const all = [...cable.cores, ...(cable.shield ? [cable.shield] : [])];
      if (all.every((k: any) => inside.has(k.id))) {
        if (!cablesDone.has(cable.id)) {
          cablesDone.add(cable.id);
          const part = findPart(h, "cableParts", cable.partId);
          const sumSq = cable.cores.reduce((s: number, k: any) => s + estimateWireDiameter(a.conductorById.get(k.id)?.gaugeMm2) ** 2, 0);
          items.push({ d: Math.sqrt(sumSq) * 1.15 + 1.6, color: part?.color ?? "Black", id: cable.id });
        }
        continue;
      }
    }
    if (c.kind === "shield") continue;
    items.push({ d: estimateWireDiameter(c.gaugeMm2), color: c.color, stripe: c.stripeColor, id });
  }
  const placed = pack(items.map((i) => i.d / 2));
  const diam = a.bundleDiameterMm.get(bundle.id) ?? 0;
  const R = Math.max(diam / 2, 1);
  const scale = 80 / R;
  const select = useStore((s) => s.select);
  return (
    <div className="cross-card">
      <h4><span>{a.displayIds.get(bundle.id)}{bundle.label ? ` · ${bundle.label}` : ""}</span><span>⌀ {diam.toFixed(1)} mm</span></h4>
      <div className="hint-text">{ids.length ? `${items.length} item${items.length > 1 ? "s" : ""} · ${ids.length} conductor${ids.length > 1 ? "s" : ""}` : "No wires are routed through this bundle."}</div>
      {ids.length > 0 && (
        <svg width="206" height="180" viewBox="-103 -90 206 180">
          <circle r={R * scale} fill="#f8fafc" stroke="#94a3b8" strokeDasharray="4 3" />
          {placed.map((p, i) => (
            <g key={items[i].id} onClick={() => select([items[i].id])} style={{ cursor: "pointer" }}>
              <circle cx={p.x * scale} cy={p.y * scale} r={p.r * scale} fill={colorHex(items[i].color)} stroke="#334155" strokeWidth={0.8} />
              {items[i].stripe && <circle cx={p.x * scale} cy={p.y * scale} r={p.r * scale * 0.75} fill="none" stroke={colorHex(items[i].stripe)} strokeWidth={p.r * scale * 0.25} strokeDasharray="3 3" />}
              <circle cx={p.x * scale} cy={p.y * scale} r={p.r * scale * 0.42} fill="#d97706" opacity={0.85} />
            </g>
          ))}
        </svg>
      )}
      <div className="hint-text">Estimated from wire gauges with a 15% packing allowance; coverings excluded.</div>
    </div>
  );
}

/** Greedy circle packing around the origin; good enough to visualise bundle fill. */
function pack(radii: number[]): { x: number; y: number; r: number }[] {
  const order = radii.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r);
  const out: { x: number; y: number; r: number; i: number }[] = [];
  for (const { r, i } of order) {
    if (!out.length) { out.push({ x: 0, y: 0, r, i }); continue; }
    let best: { x: number; y: number } | undefined;
    let bestD = Infinity;
    for (const o of out) {
      for (let k = 0; k < 36; k++) {
        const ang = (k / 36) * Math.PI * 2;
        const x = o.x + Math.cos(ang) * (o.r + r + 0.02), y = o.y + Math.sin(ang) * (o.r + r + 0.02);
        if (out.some((q) => Math.hypot(q.x - x, q.y - y) < q.r + r - 1e-6)) continue;
        const d = Math.hypot(x, y);
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
    }
    out.push({ ...(best ?? { x: 0, y: 0 }), r, i });
  }
  const cx = out.reduce((s, p) => s + p.x, 0) / out.length, cy = out.reduce((s, p) => s + p.y, 0) / out.length;
  return out.sort((a, b) => a.i - b.i).map((p) => ({ x: p.x - cx, y: p.y - cy, r: p.r }));
}
