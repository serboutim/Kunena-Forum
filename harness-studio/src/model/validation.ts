import { type Analysis, endpointLabel, findPart, nameOf } from "./analysis";
import type {
  Cavity, CavityPartRule, ConfigurationAccessory, Connector, ConnectorPart, ContactPart, CoveringPart, Harness,
  PartBase, PartConfiguration, PartKind, Terminal, TerminalPart,
} from "./types";
import { PART_KINDS } from "./types";
import { formatMm2, gaugeToMm2, toMm } from "./units";

export type Severity = "error" | "warning" | "info";
export interface Issue { severity: Severity; code: string; message: string; targetIds: string[] }

export function configurationOf(part: { configurations?: PartConfiguration[] } | undefined, configurationId?: string): PartConfiguration | undefined {
  const cfgs = part?.configurations ?? [];
  return cfgs.find((c) => c.id === configurationId) ?? cfgs[0];
}

function ruleMatches(rule: CavityPartRule | undefined, connected: boolean, gaugeMm2: number | undefined, part: PartBase | undefined, defaultApply: "connected" | "unconnected"): boolean {
  const apply = rule?.apply ?? defaultApply;
  if (apply === "never") return false;
  if ((apply === "connected") !== connected) return false;
  if (!connected) return true;
  const min = rule?.gaugeFromPart ? part?.minGauge : rule?.minGauge;
  const max = rule?.gaugeFromPart ? part?.maxGauge : rule?.maxGauge;
  if (!min && !max) return true;
  if (gaugeMm2 === undefined) return false;
  const lo = gaugeToMm2(min), hi = gaugeToMm2(max);
  return (lo === undefined || gaugeMm2 >= lo - 1e-6) && (hi === undefined || gaugeMm2 <= hi + 1e-6);
}

/** Total conductor area (mm²) ending in a cavity, or undefined when any conductor there has no gauge. */
export function cavityGaugeMm2(a: Analysis, connectorId: string, cavityId: string): number | undefined {
  const ids = a.connections.get(`${connectorId}::${cavityId}`) ?? [];
  if (!ids.length) return undefined;
  let sum = 0;
  for (const id of ids) {
    const g = a.conductorById.get(id)?.gaugeMm2;
    if (g === undefined) return undefined;
    sum += g;
  }
  return sum;
}

export function isCavityConnected(a: Analysis, connector: Connector, cavity: Cavity): boolean {
  if ((a.connections.get(`${connector.id}::${cavity.id}`) ?? []).length) return true;
  return (a.mated.get(connector.id) ?? []).length > 0 && !cavity.notConnected;
}

export interface CavityLoad { contact?: ContactPart; plug?: PartBase; fromConfiguration: boolean }

/** Which contact or cavity plug is loaded in a cavity: its own override, else the first configuration rule that matches. */
export function cavityLoad(h: Harness, a: Analysis, connector: Connector, cavity: Cavity): CavityLoad {
  if (cavity.contactPartId) return { contact: findPart(h, "contactParts", cavity.contactPartId), fromConfiguration: false };
  if (cavity.cavityPlugPartId) return { plug: findPart(h, "cavityPlugParts", cavity.cavityPlugPartId), fromConfiguration: false };
  const part = findPart<ConnectorPart>(h, "connectorParts", connector.partId);
  const cfg = configurationOf(part, connector.configurationId);
  const connected = !cavity.notConnected && isCavityConnected(a, connector, cavity);
  const gauge = cavityGaugeMm2(a, connector.id, cavity.id);
  const accs: ConfigurationAccessory[] = cfg?.accessories ?? [];
  if (connected) {
    for (const acc of accs) {
      if (acc.type !== "ContactPart" || !acc.partId) continue;
      const p = findPart<ContactPart>(h, "contactParts", acc.partId);
      if (ruleMatches(acc.rule, true, gauge, p, "connected")) return { contact: p, fromConfiguration: true };
    }
  } else {
    for (const acc of accs) {
      if (acc.type !== "CavityPlugPart" || !acc.partId) continue;
      const p = findPart(h, "cavityPlugParts", acc.partId);
      if (ruleMatches(acc.rule, false, undefined, p, "unconnected")) return { plug: p, fromConfiguration: true };
    }
  }
  return { fromConfiguration: false };
}

function inRange(mm2: number, part: PartBase): boolean {
  const lo = gaugeToMm2(part.minGauge), hi = gaugeToMm2(part.maxGauge);
  return (lo === undefined || mm2 >= lo * 0.98) && (hi === undefined || mm2 <= hi * 1.02);
}

const TERMINAL_MATES: Record<string, { compatible: string[]; checksSize: boolean; maxOne: boolean; cavity?: boolean }> = {
  Ferrule: { compatible: [], checksSize: false, maxOne: true, cavity: true },
  Ring: { compatible: ["Ring", "Spade"], checksSize: true, maxOne: false },
  Spade: { compatible: ["Spade", "Ring"], checksSize: true, maxOne: false },
  QuickConnectMale: { compatible: ["QuickConnectFemale"], checksSize: true, maxOne: true },
  QuickConnectFemale: { compatible: ["QuickConnectMale"], checksSize: true, maxOne: true },
  Loose: { compatible: [], checksSize: false, maxOne: true, cavity: true },
};

export function validate(h: Harness, a: Analysis): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, code: string, message: string, ...targetIds: string[]) => issues.push({ severity, code, message, targetIds });
  const unit = h.gaugeUnit;

  // Dangling references
  for (const c of a.conductors) {
    for (const cp of [c.source, c.target]) {
      if (!cp) continue;
      const ref = a.elements.get(cp.id);
      if (!ref) add("error", "dangling", `${c.displayId} references a missing component (${cp.id})`, c.id);
      else if (ref.kind === "connectors" && !a.cavities.has(cp.handle)) add("error", "dangling", `${c.displayId} references a missing cavity on ${nameOf(a, cp.id)}`, c.id);
    }
  }
  for (const b of h.bundles) {
    for (const id of [b.sourceId, b.targetId]) if (!a.elements.has(id)) add("error", "dangling", `${a.displayIds.get(b.id)} ends on a missing component (${id})`, b.id);
  }

  // Connectors
  for (const c of h.connectors) {
    const name = nameOf(a, c.id);
    const part = findPart<ConnectorPart>(h, "connectorParts", c.partId);
    if (c.partId && !part) add("error", "missing-part", `${name} is assigned a part that does not exist`, c.id);
    if (part?.numberOfCavities !== undefined && part.numberOfCavities !== c.cavities.length) {
      add("warning", "cavity-count", `${name} has ${c.cavities.length} cavities but part ${part.partNumber ?? ""} has ${part.numberOfCavities}`, c.id);
    }
    if (part && c.shell && part.hasShell === false) add("warning", "shell", `${name} has a shell but its part does not`, c.id);
    for (const cv of [...c.cavities, ...(c.shell ? [c.shell] : [])]) {
      const ids = a.connections.get(`${c.id}::${cv.id}`) ?? [];
      const des = a.designations.get(cv.id);
      if (cv.notConnected && ids.length) add("error", "nc-connected", `${name}:${des} is marked N/C but has connections`, c.id);
      if (!ids.length && !cv.notConnected && !cv.signal && !a.mated.has(c.id) && cv !== c.shell) {
        add("info", "unconnected-cavity", `${name}:${des} is unconnected (mark it N/C if intentional)`, c.id);
      }
      if (!ids.length) continue;
      const load = cavityLoad(h, a, c, cv);
      const gauge = cavityGaugeMm2(a, c.id, cv.id);
      if (load.contact && gauge !== undefined && !inRange(gauge, load.contact)) {
        add("warning", "contact-gauge", `${name}:${des} carries ${formatMm2(gauge, unit)}, outside contact ${load.contact.partNumber ?? ""} range`, c.id, ...ids);
      }
    }
  }

  // Terminals and splices
  for (const t of h.terminals) {
    const part = findPart<TerminalPart>(h, "terminalParts", t.partId);
    const ids = a.connections.get(`${t.id}::Terminal`) ?? [];
    if (part?.type && part.type !== t.type) add("warning", "terminal-type", `${nameOf(a, t.id)} is a ${t.type} but its part is a ${part.type}`, t.id);
    const gauge = sumGauge(a, ids);
    if (part && gauge !== undefined && !inRange(gauge, part)) add("warning", "terminal-gauge", `${nameOf(a, t.id)} carries ${formatMm2(gauge, unit)}, outside its part's gauge range`, t.id, ...ids);
  }
  for (const s of h.splices) {
    const ids = a.connections.get(`${s.id}::Splice`) ?? [];
    if (ids.length < 2) add("warning", "splice-wires", `${nameOf(a, s.id)} joins fewer than two conductors`, s.id);
    const part = findPart(h, "spliceParts", s.partId);
    const gauge = sumGauge(a, ids);
    if (part && gauge !== undefined && !inRange(gauge, part)) add("warning", "splice-gauge", `${nameOf(a, s.id)} carries ${formatMm2(gauge, unit)}, outside its part's gauge range`, s.id, ...ids);
  }

  // Conductors
  for (const c of a.conductors) {
    if (!c.source || !c.target) {
      if (c.kind !== "shield" || (!c.source && !c.target)) add(c.kind === "shield" ? "info" : "warning", "open-end", `${c.displayId} is not connected at both ends`, c.id);
      continue;
    }
    if (c.source.id === c.target.id && c.source.handle === c.target.handle) add("error", "self-loop", `${c.displayId} connects a point to itself`, c.id);
    if ((c.kind === "wire" || c.kind === "twisted") && !c.partId) add("info", "no-part", `${c.displayId} has no part (No Part)`, c.id);
    if (c.partId) {
      const p = findPart(h, "wireParts", c.partId);
      if (!p) add("error", "missing-part", `${c.displayId} is assigned a part that does not exist`, c.id);
      else if ((p.color && p.color !== c.color) || (p.stripeColor ?? undefined) !== (c.stripeColor ?? undefined)) {
        add("warning", "color-mismatch", `${c.displayId} colour does not match part ${p.partNumber ?? ""}`, c.id);
      }
    }
    const r = a.routes.get(c.id);
    if (r?.noRoute && h.bundles.length) add("warning", "no-route", `${c.displayId} (${endpointLabel(a, c.source)} → ${endpointLabel(a, c.target)}) has NO ROUTE through the bundles`, c.id);
  }
  if (!h.bundles.length && a.conductors.some((c) => c.source && c.target && c.source.id !== c.target.id)) {
    add("info", "no-layout", "No bundles drawn yet: open the Layout view to route wires and calculate lengths");
  }

  // Bundle coverings
  for (const b of h.bundles) {
    const d = a.bundleDiameterMm.get(b.id) ?? 0;
    for (const pid of b.partIds ?? []) {
      const cov = findPart<CoveringPart>(h, "coveringParts", pid);
      if (!cov) { add("error", "missing-part", `${a.displayIds.get(b.id)} references a missing covering`, b.id); continue; }
      const max = toMm(cov.maxDiameter), min = toMm(cov.minDiameter);
      if (max !== undefined && d > max) add("warning", "covering-size", `${a.displayIds.get(b.id)} is ~${d.toFixed(1)} mm across, larger than covering ${cov.partNumber ?? ""} (max ${max} mm)`, b.id);
      if (min !== undefined && d > 0 && d < min && cov.type === "HeatShrink") add("info", "covering-size", `${a.displayIds.get(b.id)} is ~${d.toFixed(1)} mm across; heat shrink ${cov.partNumber ?? ""} recovers only to ${min} mm`, b.id);
    }
  }

  // Mates
  for (const m of h.mates) {
    const sa = a.elements.get(m.sourceId), sb = a.elements.get(m.targetId);
    if (!sa || !sb) { add("error", "dangling", "A mate references a missing component", m.id); continue; }
    if (sa.kind === "connectors" && sb.kind === "connectors") {
      const ca = sa.el as Connector, cb = sb.el as Connector;
      if (ca.cavities.length !== cb.cavities.length) add("error", "mate-cavities", `Cavities do not match: ${nameOf(a, ca.id)} (${ca.cavities.length}) ↔ ${nameOf(a, cb.id)} (${cb.cavities.length})`, m.id, ca.id, cb.id);
      const ga = findPart<ConnectorPart>(h, "connectorParts", ca.partId)?.gender, gb = findPart<ConnectorPart>(h, "connectorParts", cb.partId)?.gender;
      if (ga && gb && ga === gb) add("error", "mate-gender", `Genders do not match: ${nameOf(a, ca.id)} and ${nameOf(a, cb.id)} are both ${ga}`, m.id, ca.id, cb.id);
    } else {
      const term = (sa.kind === "terminals" ? sa.el : sb.el) as Terminal;
      const other = sa.kind === "terminals" ? sb : sa;
      const rule = TERMINAL_MATES[term.type];
      if (other.kind === "connectors") {
        if (!rule?.cavity) add("error", "mate-terminal", `${nameOf(a, term.id)} (${term.type}) cannot mate into a connector cavity`, m.id);
      } else if (other.kind === "terminals") {
        const t2 = other.el as Terminal;
        if (!rule?.compatible.includes(t2.type)) add("error", "mate-terminal", `${nameOf(a, term.id)} (${term.type}) cannot mate with ${nameOf(a, t2.id)} (${t2.type})`, m.id);
        else if (rule.checksSize) {
          const s1 = findPart<TerminalPart>(h, "terminalParts", term.partId)?.size, s2 = findPart<TerminalPart>(h, "terminalParts", t2.partId)?.size;
          if (s1 && s2 && JSON.stringify(s1) !== JSON.stringify(s2)) add("error", "mate-size", `${nameOf(a, term.id)} and ${nameOf(a, t2.id)} have different sizes`, m.id);
        }
      }
      if (rule?.maxOne && (a.mated.get(term.id) ?? []).length > 1) add("error", "mate-count", `${nameOf(a, term.id)} (${term.type}) can only mate once`, m.id);
    }
  }

  // Unused parts
  const used = usedPartIds(h);
  for (const kind of PART_KINDS) {
    for (const p of h[kind] as PartBase[]) if (!used.has(p.id)) add("info", "unused-part", `${partName(p)} is Not Used`, p.id);
  }
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((x, y) => order[x.severity] - order[y.severity]);
}

function sumGauge(a: Analysis, ids: string[]): number | undefined {
  if (!ids.length) return undefined;
  let s = 0;
  for (const id of ids) {
    const g = a.conductorById.get(id)?.gaugeMm2;
    if (g === undefined) return undefined;
    s += g;
  }
  return s;
}

export function partName(p: PartBase): string {
  return p.partNumber || p.description || p.id;
}

export function usedPartIds(h: Harness): Set<string> {
  const used = new Set<string>();
  const addCfg = (part: { configurations?: PartConfiguration[] } | undefined) => {
    for (const cfg of part?.configurations ?? []) for (const acc of cfg.accessories ?? []) if (acc.partId) used.add(acc.partId);
  };
  for (const c of h.connectors) {
    if (c.partId) { used.add(c.partId); addCfg(findPart(h, "connectorParts", c.partId)); }
    for (const cv of [...c.cavities, ...(c.shell ? [c.shell] : [])]) {
      for (const k of ["contactPartId", "cavityPlugPartId", "cavitySealPartId"] as const) if (cv[k]) used.add(cv[k] as string);
    }
  }
  for (const k of ["terminals", "splices", "diodes", "resistors"] as const) {
    const partKind: Record<string, PartKind> = { terminals: "terminalParts", splices: "spliceParts", diodes: "diodeParts", resistors: "resistorParts" };
    for (const el of h[k]) if (el.partId) { used.add(el.partId); addCfg(findPart(h, partKind[k], el.partId)); }
  }
  for (const w of h.wires) if (w.partId) used.add(w.partId);
  for (const t of h.twistedWires) for (const w of t.wires) if (w.partId) used.add(w.partId);
  for (const c of h.cables) if (c.partId) used.add(c.partId);
  for (const b of h.bundles) for (const p of b.partIds ?? []) used.add(p);
  for (const b of h.branchPoints) for (const p of b.partIds ?? []) used.add(p);
  for (const g of h.groups) if (g.partId) used.add(g.partId);
  return used;
}
