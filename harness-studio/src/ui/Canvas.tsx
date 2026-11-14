import { type ReactNode, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Pos } from "../model/types";

export interface Camera { x: number; y: number; k: number }
const cameras = new Map<string, Camera>();

export interface CanvasApi {
  toWorld: (clientX: number, clientY: number) => Pos;
  svg: () => SVGSVGElement | null;
  fit: (bounds: { x: number; y: number; w: number; h: number }) => void;
  zoomBy: (f: number) => void;
}

interface Props {
  viewKey: string;
  children: ReactNode;
  onBackgroundPointerDown?: (e: React.PointerEvent, world: Pos) => boolean | void;
  onContextMenu?: (e: React.MouseEvent, world: Pos) => void;
  onDoubleClick?: (e: React.MouseEvent, world: Pos) => void;
  overlay?: ReactNode;
}

/** An SVG canvas with wheel zoom and drag-to-pan on empty space. World units are the 30-unit grid. */
export const Canvas = forwardRef<CanvasApi, Props>(function Canvas({ viewKey, children, onBackgroundPointerDown, onContextMenu, onDoubleClick, overlay }, ref) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [cam, setCam] = useState<Camera>(() => cameras.get(viewKey) ?? { x: -40, y: -40, k: 1 });
  const [panning, setPanning] = useState(false);
  useEffect(() => { cameras.set(viewKey, cam); }, [cam, viewKey]);

  const toWorld = useCallback((clientX: number, clientY: number): Pos => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: cam.x + (clientX - r.left) / cam.k, y: cam.y + (clientY - r.top) / cam.k };
  }, [cam]);

  useImperativeHandle(ref, () => ({
    toWorld,
    svg: () => svgRef.current,
    fit: (b) => {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r || !b.w || !b.h) return;
      const k = Math.min(2, Math.max(0.2, Math.min((r.width - 120) / b.w, (r.height - 120) / b.h)));
      setCam({ k, x: b.x - (r.width / k - b.w) / 2, y: b.y - (r.height / k - b.h) / 2 });
    },
    zoomBy: (f) => {
      const r = svgRef.current!.getBoundingClientRect();
      setCam((c) => zoomAt(c, f, r.width / 2, r.height / 2));
    },
  }), [toWorld]);

  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2) {
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        setCam((c) => zoomAt(c, f, e.clientX - r.left, e.clientY - r.top));
      } else {
        setCam((c) => ({ ...c, x: c.x + e.deltaX / c.k, y: c.y + e.deltaY / c.k }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const target = e.target as Element;
    const onBackground = target === svgRef.current || target.classList.contains("bg");
    if (e.button === 1 || (e.button === 0 && onBackground)) {
      if (e.button === 0 && onBackgroundPointerDown?.(e, toWorld(e.clientX, e.clientY)) === true) return;
      const start = { x: e.clientX, y: e.clientY, cam };
      let moved = false;
      setPanning(true);
      const move = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 3) moved = true;
        setCam({ ...start.cam, x: start.cam.x - (ev.clientX - start.x) / start.cam.k, y: start.cam.y - (ev.clientY - start.y) / start.cam.k });
      };
      const up = () => {
        setPanning(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (!moved && e.button === 0) svgRef.current?.dispatchEvent(new CustomEvent("bgclick", { bubbles: false }));
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }
  };

  const r = svgRef.current?.getBoundingClientRect();
  const vw = (r?.width ?? 1200) / cam.k, vh = (r?.height ?? 800) / cam.k;

  return (
    <>
      <svg
        ref={svgRef}
        className={`canvas${panning ? " panning" : ""}`}
        viewBox={`${cam.x} ${cam.y} ${vw} ${vh}`}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu?.(e, toWorld(e.clientX, e.clientY)); }}
        onDoubleClick={(e) => onDoubleClick?.(e, toWorld(e.clientX, e.clientY))}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id={`grid-${viewKey}`} width="30" height="30" patternUnits="userSpaceOnUse">
            <circle cx="0" cy="0" r="1.1" fill="#d5dae1" />
          </pattern>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>
        <rect className="bg" x={cam.x - 10} y={cam.y - 10} width={vw + 20} height={vh + 20} fill={`url(#grid-${viewKey})`} />
        {children}
      </svg>
      {overlay}
      <div className="zoom-controls">
        <button title="Zoom in" onClick={() => r && setCam((c) => zoomAt(c, 1.25, r.width / 2, r.height / 2))}>+</button>
        <button title="Zoom out" onClick={() => r && setCam((c) => zoomAt(c, 0.8, r.width / 2, r.height / 2))}>−</button>
      </div>
    </>
  );
});

function zoomAt(c: Camera, f: number, sx: number, sy: number): Camera {
  const k = Math.min(4, Math.max(0.15, c.k * f));
  const wx = c.x + sx / c.k, wy = c.y + sy / c.k;
  return { k, x: wx - sx / k, y: wy - sy / k };
}

/** Starts a window-level drag; `onMove` receives world deltas, `onUp` the element under the pointer. */
export function startDrag(
  e: React.PointerEvent | PointerEvent,
  api: CanvasApi,
  handlers: { onMove?: (d: Pos, world: Pos, ev: PointerEvent) => void; onUp?: (d: Pos, world: Pos, target: Element | null, ev: PointerEvent, moved: boolean) => void },
) {
  const start = api.toWorld(e.clientX, e.clientY);
  const sx = e.clientX, sy = e.clientY;
  let moved = false;
  const move = (ev: PointerEvent) => {
    if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true;
    const w = api.toWorld(ev.clientX, ev.clientY);
    handlers.onMove?.({ x: w.x - start.x, y: w.y - start.y }, w, ev);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    const w = api.toWorld(ev.clientX, ev.clientY);
    handlers.onUp?.({ x: w.x - start.x, y: w.y - start.y }, w, document.elementFromPoint(ev.clientX, ev.clientY), ev, moved);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

export function useBackgroundClick(api: React.RefObject<CanvasApi>, fn: () => void) {
  useEffect(() => {
    const svg = api.current?.svg();
    if (!svg) return;
    svg.addEventListener("bgclick", fn);
    return () => svg.removeEventListener("bgclick", fn);
  });
}
