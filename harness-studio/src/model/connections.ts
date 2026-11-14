import { type Analysis, type Conductor, endpointKey, endpointLabel, findPart, nameOf, twistedWith } from "./analysis";
import { colorCode } from "./colors";
import type { Harness } from "./types";
import { toCsv } from "./bom";
import { formatGauge, formatLength } from "./units";

export interface ConnectionRow {
  conductor: Conductor;
  id: string;
  from: string;
  fromSignal: string;
  to: string;
  toSignal: string;
  color: string;
  part: string;
  gauge: string;
  length: string;
  lengthMm?: number;
  twistedWith: string;
  cable: string;
  status: string[];
}

export function connectionRows(h: Harness, a: Analysis): ConnectionRow[] {
  const sig = (cp?: { id: string; handle: string }) => (cp ? a.effectiveSignal.get(endpointKey(cp)) ?? "" : "");
  return a.conductors.map((c) => {
    const route = a.routes.get(c.id);
    const status: string[] = [];
    if ((c.kind === "wire" || c.kind === "twisted") && !c.partId) status.push("No Part");
    const drainAtOneEnd = c.kind === "shield" && !!(c.source || c.target);
    if (!c.source || !c.target) { if (!drainAtOneEnd) status.push("Open"); }
    else if (route?.noRoute) status.push("NO ROUTE");
    else if (route?.estimated) status.push("Est. length");
    let part = "";
    let gauge = "";
    if (c.kind === "core" || c.kind === "shield") {
      const cable = a.elements.get(c.parentId!)!.el;
      const cp = findPart(h, "cableParts", cable.partId);
      part = cp?.partNumber ?? "";
      gauge = c.kind === "core" ? formatGauge(cp?.cores?.[c.index]?.gauge) : "";
    } else {
      const wp = findPart(h, "wireParts", c.partId);
      part = wp?.partNumber ?? "";
      gauge = formatGauge(wp?.gauge);
    }
    return {
      conductor: c,
      id: c.displayId,
      from: endpointLabel(a, c.source),
      fromSignal: sig(c.source),
      to: endpointLabel(a, c.target),
      toSignal: sig(c.target),
      color: colorCode(c.color, c.stripeColor),
      part,
      gauge: gauge === "—" ? "" : gauge,
      length: route && !route.noRoute ? formatLength(route.lengthMm, h.lengthUnit) : "",
      lengthMm: route?.lengthMm,
      twistedWith: twistedWith(a, h, c).join(" "),
      cable: c.parentId && (c.kind === "core" || c.kind === "shield") ? nameOf(a, c.parentId) : "",
      status,
    };
  }).sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true }));
}

export function connectionsToCsv(h: Harness, a: Analysis): string {
  const rows = connectionRows(h, a);
  return toCsv([
    ["Wire", "From", "From Signal", "To", "To Signal", "Color", "Part", "Gauge", "Length", "Twisted With", "Cable", "Status"],
    ...rows.map((r) => [r.id, r.from, r.fromSignal, r.to, r.toSignal, r.color, r.part, r.gauge, r.length, r.twistedWith, r.cable, r.status.join("; ")]),
  ]);
}

export interface WiringTableRow { cavity: string; signal: string; destination: string; wire: string; color: string; gauge: string; length: string }

/** One row per conductor ending on a component, as in the on-canvas wiring table. */
export function wiringTable(h: Harness, a: Analysis, componentId: string): WiringTableRow[] {
  const ref = a.elements.get(componentId);
  if (!ref) return [];
  const handles: { handle: string; label: string }[] = [];
  if (ref.kind === "connectors") {
    for (const cv of [...ref.el.cavities, ...(ref.el.shell ? [ref.el.shell] : [])]) handles.push({ handle: cv.id, label: a.designations.get(cv.id) ?? "" });
  } else if (ref.kind === "terminals") handles.push({ handle: "Terminal", label: "" });
  else if (ref.kind === "splices") handles.push({ handle: "Splice", label: "" });
  else handles.push({ handle: "Left", label: "L" }, { handle: "Right", label: "R" });
  const rows: WiringTableRow[] = [];
  const conns = connectionRows(h, a);
  for (const { handle, label } of handles) {
    const key = `${componentId}::${handle}`;
    const ids = a.connections.get(key) ?? [];
    const signal = a.effectiveSignal.get(key) ?? "";
    const cav = a.cavities.get(handle)?.cavity;
    if (!ids.length) {
      rows.push({ cavity: label, signal: cav?.notConnected ? "N/C" : signal, destination: "", wire: "", color: "", gauge: "", length: "" });
      continue;
    }
    for (const id of ids) {
      const r = conns.find((x) => x.conductor.id === id)!;
      const c = r.conductor;
      const other = c.source && endpointKey(c.source) === key ? c.target : c.source;
      const otherSig = other ? a.effectiveSignal.get(endpointKey(other)) : undefined;
      rows.push({
        cavity: label, signal, destination: other ? `${endpointLabel(a, other)}${otherSig ? ` (${otherSig})` : ""}` : "",
        wire: r.id, color: r.color, gauge: r.gauge, length: r.length,
      });
    }
  }
  return rows;
}
