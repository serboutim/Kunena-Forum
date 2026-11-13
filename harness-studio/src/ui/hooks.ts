import { useEffect, useRef, useState } from "react";
import { type Analysis, analyze } from "../model/analysis";
import type { Harness } from "../model/types";
import { type Issue, validate } from "../model/validation";
import { useStore } from "../store";

const cache = new WeakMap<Harness, { a: Analysis; issues: Issue[] }>();

export function analysisOf(h: Harness): { a: Analysis; issues: Issue[] } {
  let hit = cache.get(h);
  if (!hit) {
    const a = analyze(h);
    hit = { a, issues: validate(h, a) };
    cache.set(h, hit);
  }
  return hit;
}

export function useAnalysis() {
  const h = useStore((s) => s.h);
  return { h, ...analysisOf(h) };
}

export interface Highlight {
  conductors: Set<string>;
  elements: Set<string>;
  bundles: Set<string>;
  active: boolean;
}

/** What to emphasise for the current selection: its net, the wires on a component, or the wires in a bundle. */
export function computeHighlight(a: Analysis, selection: string[], nets: boolean): Highlight {
  const conductors = new Set<string>();
  const elements = new Set<string>();
  const bundles = new Set<string>();
  for (const id of selection) {
    const c = a.conductorById.get(id);
    if (c) {
      if (nets) for (const x of a.netOfConductor.get(id)?.conductors ?? []) conductors.add(x);
      conductors.add(id);
      continue;
    }
    const ref = a.elements.get(id);
    if (ref?.kind === "bundles") { for (const x of a.conductorsInBundle.get(id) ?? []) conductors.add(x); continue; }
    if (ref?.kind === "cables") { for (const k of [...ref.el.cores, ...(ref.el.shield ? [ref.el.shield] : [])]) conductors.add(k.id); continue; }
    if (ref?.kind === "twistedWires") { for (const k of ref.el.wires) conductors.add(k.id); continue; }
    if (ref && ["connectors", "terminals", "splices", "diodes", "resistors"].includes(ref.kind)) {
      for (const [key, ids] of a.connections) if (key.startsWith(`${id}::`)) ids.forEach((x) => conductors.add(x));
      continue;
    }
    if (!ref && !a.cavities.has(id)) {
      for (const [eid, r] of a.elements) {
        if (r.el.partId === id || (Array.isArray(r.el.partIds) && r.el.partIds.includes(id))) {
          elements.add(eid);
          if (r.kind === "bundles") bundles.add(eid);
          if (r.kind === "cables") for (const k of r.el.cores) conductors.add(k.id);
        }
      }
      for (const c of a.conductors) if (c.partId === id) conductors.add(c.id);
      continue;
    }
    const cav = a.cavities.get(id);
    if (cav) {
      const key = `${cav.connector.id}::${id}`;
      const net = a.netOfEndpoint.get(key);
      if (nets && net) net.conductors.forEach((x) => conductors.add(x));
      else (a.connections.get(key) ?? []).forEach((x) => conductors.add(x));
    }
  }
  for (const id of conductors) {
    const c = a.conductorById.get(id)!;
    for (const cp of [c.source, c.target]) if (cp) elements.add(cp.id);
    if (c.parentId) elements.add(c.parentId);
    for (const b of a.routes.get(id)?.bundleIds ?? []) bundles.add(b);
  }
  return { conductors, elements, bundles, active: conductors.size > 0 || elements.size > 0 };
}

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
