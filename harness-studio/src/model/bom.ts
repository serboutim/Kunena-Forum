import { type Analysis, findPart } from "./analysis";
import type { CoveringPart, Harness, PartBase, PartConfiguration, PartKind } from "./types";
import { ACCESSORY_KIND, PART_KINDS, PART_KIND_LABEL } from "./types";
import { cavityLoad, configurationOf } from "./validation";
import { MM_PER, fromMm, round, toMm } from "./units";

export interface BomRow {
  partId: string;
  kind: PartKind;
  part: PartBase;
  quantity: number;
  /** "ea" for counted parts, otherwise the harness length unit. */
  unit: string;
  unitPrice?: number;
  total?: number;
  usedBy: string[];
  /** Some uses have no known length (unrouted wire or bundle without a length). */
  incomplete: boolean;
}

export function buildBom(h: Harness, a: Analysis): BomRow[] {
  const rows = new Map<string, BomRow>();
  const kindOf = new Map<string, PartKind>();
  for (const k of PART_KINDS) for (const p of h[k] as PartBase[]) kindOf.set(p.id, k);

  const count = (partId: string | undefined, qty: number, usedBy: string) => {
    if (!partId) return;
    const kind = kindOf.get(partId);
    if (!kind) return;
    const part = findPart<PartBase>(h, kind, partId)!;
    const r = rows.get(partId) ?? { partId, kind, part, quantity: 0, unit: "ea", usedBy: [], incomplete: false };
    r.quantity += qty;
    if (!r.usedBy.includes(usedBy)) r.usedBy.push(usedBy);
    rows.set(partId, r);
  };
  const length = (partId: string | undefined, mm: number | undefined, usedBy: string) => {
    if (!partId) return;
    const kind = kindOf.get(partId);
    if (!kind) return;
    const part = findPart<PartBase>(h, kind, partId)!;
    const r = rows.get(partId) ?? { partId, kind, part, quantity: 0, unit: h.lengthUnit, usedBy: [], incomplete: false };
    r.unit = h.lengthUnit;
    if (mm === undefined) r.incomplete = true; else r.quantity += fromMm(mm, h.lengthUnit);
    if (!r.usedBy.includes(usedBy)) r.usedBy.push(usedBy);
    rows.set(partId, r);
  };
  const accessories = (part: { configurations?: PartConfiguration[] } | undefined, cfgId: string | undefined, usedBy: string) => {
    for (const acc of configurationOf(part, cfgId)?.accessories ?? []) {
      if (!acc.partId || ["ContactPart", "CavityPlugPart", "CavitySealPart"].includes(acc.type)) continue;
      if (ACCESSORY_KIND[acc.type] === "coveringParts") {
        const cov = findPart<CoveringPart>(h, "coveringParts", acc.partId);
        if (cov && !cov.isFixedLength) continue;
      }
      count(acc.partId, 1, usedBy);
    }
  };
  const id = (x: string) => a.displayIds.get(x) ?? x;

  for (const c of h.connectors) {
    if (c.excludeFromBom) continue;
    const part = findPart(h, "connectorParts", c.partId);
    count(c.partId, 1, id(c.id));
    accessories(part, c.configurationId, id(c.id));
    for (const cv of [...c.cavities, ...(c.shell ? [c.shell] : [])]) {
      const load = cavityLoad(h, a, c, cv);
      if (load.contact) count(load.contact.id, 1, id(c.id));
      if (load.plug) count(load.plug.id, 1, id(c.id));
      if (cv.cavitySealPartId) count(cv.cavitySealPartId, 1, id(c.id));
    }
  }
  const singles: [keyof Harness, keyof Harness][] = [["terminals", "terminalParts"], ["splices", "spliceParts"], ["diodes", "diodeParts"], ["resistors", "resistorParts"]];
  for (const [k, pk] of singles) {
    for (const el of h[k] as any[]) {
      if (el.excludeFromBom) continue;
      count(el.partId, 1, id(el.id));
      accessories(findPart(h, pk, el.partId), el.configurationId, id(el.id));
    }
  }
  for (const c of a.conductors) {
    if (c.kind !== "wire" && c.kind !== "twisted") continue;
    if ((c.raw as any).excludeFromBom) continue;
    length(c.partId, a.routes.get(c.id)?.lengthMm, c.displayId);
  }
  for (const cable of h.cables) {
    if (cable.excludeFromBom) continue;
    length(cable.partId, a.cableLengthMm.get(cable.id), id(cable.id));
  }
  for (const b of h.bundles) {
    for (const pid of b.partIds ?? []) {
      const cov = findPart<CoveringPart>(h, "coveringParts", pid);
      if (cov && !cov.isFixedLength) length(pid, toMm(b.length), id(b.id));
      else count(pid, 1, id(b.id));
    }
  }
  for (const bp of h.branchPoints) for (const pid of bp.partIds ?? []) count(pid, 1, id(bp.id));
  for (const g of h.groups) if (g.partId && !g.excludeFromBom) count(g.partId, 1, g.name ?? g.id);

  const out = [...rows.values()];
  for (const r of out) {
    if (r.unit === "ea") {
      r.unitPrice = r.part.price;
    } else {
      const ppl = r.part.pricePerLength;
      if (ppl) r.unitPrice = ppl.price * (MM_PER[h.lengthUnit] / MM_PER[ppl.unit]);
      else if (r.part.price !== undefined) r.unitPrice = r.part.price;
      r.quantity = round(r.quantity, 3);
    }
    if (r.unitPrice !== undefined) r.total = round(r.unitPrice * r.quantity, 4);
  }
  const kindOrder = new Map(PART_KINDS.map((k, i) => [k, i]));
  return out.sort((x, y) => (kindOrder.get(x.kind)! - kindOrder.get(y.kind)!) || (x.part.partNumber ?? "").localeCompare(y.part.partNumber ?? ""));
}

export function bomTotal(rows: BomRow[]): number {
  return round(rows.reduce((s, r) => s + (r.total ?? 0), 0), 2);
}

export function bomToCsv(h: Harness, rows: BomRow[]): string {
  const header = ["Type", "Part Number", "Internal Part No.", "Manufacturer", "Description", "Quantity", "Unit", `Unit Price (${h.currency})`, `Total (${h.currency})`, "Used By"];
  const lines = rows.map((r) => [
    PART_KIND_LABEL[r.kind], r.part.partNumber ?? "", r.part.internalPartNumber ?? "", r.part.manufacturer ?? "", r.part.description ?? "",
    r.quantity + (r.incomplete ? "+" : ""), r.unit, r.unitPrice ?? "", r.total ?? "", r.usedBy.join(" "),
  ]);
  return toCsv([header, ...lines]);
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((v) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n") + "\n";
}
