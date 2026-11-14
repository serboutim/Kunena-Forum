import { analysisOf } from "./hooks";
import type { MenuItem } from "./ContextMenu";
import {
  type AddKind, addComponent, addPart, addSpliceOnWires, assignPart, deleteElements, findConductor, insertCavityBelow,
  makeCable, makeIdFactory, moveCavity, partKindForElement, setCableCoreCount, setCavityCount, splitBundle, toggleShell, twistTogether,
} from "../model/ops";
import type { Cavity, Harness, Pos, TerminalType } from "../model/types";
import { PART_KIND_LABEL, TERMINAL_TYPES } from "../model/types";
import { partName } from "../model/validation";
import { useStore } from "../store";

const st = () => useStore.getState();

export function deleteSelection() {
  const { selection, update, select } = st();
  if (!selection.length) return;
  update((h) => deleteElements(h, selection));
  select([]);
}

const ROTATABLE = ["connectors", "terminals", "diodes", "resistors", "cables", "twistedWires"] as const;

export function rotateSelection() {
  const { selection, update } = st();
  update((h) => {
    for (const k of ROTATABLE) for (const el of h[k] as any[]) if (selection.includes(el.id)) el.rotated = !el.rotated;
  });
}

export function selectNetOfSelection() {
  const { h, selection, select } = st();
  const { a } = analysisOf(h);
  const ids = new Set<string>();
  for (const id of selection) for (const c of a.netOfConductor.get(id)?.conductors ?? []) ids.add(c);
  if (ids.size) select([...ids]);
}

export function add(kind: AddKind, at: Pos, terminalType?: TerminalType) {
  let id = "";
  st().update((h) => { id = addComponent(h, kind, at, { terminalType }); });
  if (id) st().select([id]);
}

export function addMenuItems(at: Pos, view: "schematic" | "layout"): MenuItem[] {
  const items: MenuItem[] = [
    { heading: "Add" },
    { label: "Connector", onClick: () => add("connector", at) },
    { label: "Terminal", onClick: () => undefined, children: TERMINAL_TYPES.map((t) => ({ label: terminalLabel(t), onClick: () => add("terminal", at, t) })) },
  ];
  if (view === "schematic") {
    items.push(
      { label: "Splice", onClick: () => add("splice", at) },
      { label: "Diode", onClick: () => add("diode", at) },
      { label: "Resistor", onClick: () => add("resistor", at) },
      { label: "Cable", onClick: () => add("cable", at) },
      { label: "Twisted wires", onClick: () => add("twistedWires", at) },
      { label: "Note", onClick: () => add("schematicNote", at) },
    );
  } else {
    items.push({ label: "Branch point", onClick: () => add("branchPoint", at) }, { label: "Note", onClick: () => add("layoutNote", at) });
  }
  return items;
}

export function terminalLabel(t: string): string {
  return ({ QuickConnectMale: "Male quick connect", QuickConnectFemale: "Female quick connect", Loose: "Loose wire end" } as Record<string, string>)[t] ?? t;
}

/** "Assign part" submenu for any component that takes a part. */
export function assignPartItems(h: Harness, elementId: string, kind: string): MenuItem[] {
  const pk = partKindForElement(kind);
  if (!pk) return [];
  const parts = h[pk] as any[];
  return [{
    label: "Assign part",
    children: [
      ...parts.map((p) => ({ label: partName(p) + (p.manufacturer ? ` — ${p.manufacturer}` : ""), onClick: () => st().update((d) => assignPart(d, elementId, p.id)) })),
      ...(parts.length ? [{ separator: true } as MenuItem] : []),
      { label: `Create new ${PART_KIND_LABEL[pk].toLowerCase()} part`, onClick: () => createPartFrom(elementId, kind) },
      { label: "Unassign part", onClick: () => st().update((d) => assignPart(d, elementId, undefined)) },
    ],
  }];
}

/** Creates a part pre-filled from the component (cavity count, colour, cores) and assigns it. */
export function createPartFrom(elementId: string, kind: string) {
  const pk = partKindForElement(kind);
  if (!pk) return;
  st().update((h) => {
    const fields: Record<string, unknown> = {};
    const c = h.connectors.find((x) => x.id === elementId);
    if (c) Object.assign(fields, { numberOfCavities: c.cavities.length, hasShell: !!c.shell, description: `${c.cavities.length}-way connector` });
    const t = h.terminals.find((x) => x.id === elementId);
    if (t) fields.type = t.type;
    const w = findConductor(h, elementId);
    if (w) Object.assign(fields, { color: w.color, ...(w.stripeColor ? { stripeColor: w.stripeColor } : {}) });
    const cable = h.cables.find((x) => x.id === elementId);
    if (cable) Object.assign(fields, { shielded: !!cable.shield, cores: cable.cores.map((k) => ({ id: makeIdFactory(h)(), color: k.color, ...(k.stripeColor ? { stripeColor: k.stripeColor } : {}) })) });
    const id = addPart(h, pk, fields);
    assignPart(h, elementId, id);
  });
}

export function connectorMenu(h: Harness, id: string): MenuItem[] {
  const c = h.connectors.find((x) => x.id === id)!;
  const u = st().update;
  return [
    { heading: "Connector" },
    { label: "Add cavity", onClick: () => u((d) => setCavityCount(d, id, c.cavities.length + 1)) },
    { label: "Remove last cavity", disabled: c.cavities.length <= 1, onClick: () => u((d) => setCavityCount(d, id, c.cavities.length - 1)) },
    { label: c.shell ? "Remove shell" : "Add shell", onClick: () => u((d) => toggleShell(d, id)) },
    { label: "Rotate", kbd: "R", onClick: () => u((d) => { const x = d.connectors.find((k) => k.id === id)!; x.rotated = !x.rotated; }) },
    ...assignPartItems(h, id, "connectors"),
    { separator: true },
    { label: "Delete", kbd: "Del", danger: true, onClick: () => { u((d) => deleteElements(d, [id])); st().select([]); } },
  ];
}

export function cavityMenu(h: Harness, connectorId: string, cavity: Cavity): MenuItem[] {
  const u = st().update;
  const { a } = analysisOf(h);
  const connected = (a.connections.get(`${connectorId}::${cavity.id}`) ?? []).length > 0;
  const edit = (fn: (cv: Cavity) => void) => u((d) => {
    const c = d.connectors.find((x) => x.id === connectorId)!;
    const cv = c.cavities.find((x) => x.id === cavity.id) ?? (c.shell?.id === cavity.id ? c.shell : undefined);
    if (cv) fn(cv);
  });
  return [
    { heading: `Cavity ${a.designations.get(cavity.id) ?? ""}` },
    { label: "Move cavity up", onClick: () => u((d) => moveCavity(d, connectorId, cavity.id, -1)) },
    { label: "Move cavity down", onClick: () => u((d) => moveCavity(d, connectorId, cavity.id, 1)) },
    { label: "Add cavity below", onClick: () => u((d) => insertCavityBelow(d, connectorId, cavity.id)) },
    cavity.notConnected
      ? { label: "Clear not connected", onClick: () => edit((cv) => { delete cv.notConnected; }) }
      : { label: "Mark as not connected", disabled: connected, onClick: () => edit((cv) => { cv.notConnected = true; }) },
    { separator: true },
    { label: cavity.propagate === false ? "Propagate signal" : "Do not propagate", disabled: !cavity.signal, onClick: () => edit((cv) => { if (cv.propagate === false) delete cv.propagate; else cv.propagate = false; }) },
    { label: cavity.global ? "Make signal local" : "Make signal global", disabled: !cavity.signal, onClick: () => edit((cv) => { if (cv.global) delete cv.global; else cv.global = true; }) },
    { separator: true },
    { label: "Delete cavity", danger: true, onClick: () => u((d) => deleteElements(d, [cavity.id])) },
  ];
}

export function conductorMenu(h: Harness, id: string): MenuItem[] {
  const u = st().update;
  const { selection } = st();
  const wireIds = (selection.includes(id) ? selection : [id]).filter((x) => h.wires.some((w) => w.id === x));
  const c = findConductor(h, id);
  const isWire = h.wires.some((w) => w.id === id) || h.twistedWires.some((t) => t.wires.some((w) => w.id === id));
  const setAll = (fn: (w: any) => void) => u((d) => { for (const x of selection.includes(id) ? selection : [id]) { const w = findConductor(d, x); if (w) fn(w); } });
  return [
    { heading: wireIds.length > 1 ? `${wireIds.length} wires` : "Wire" },
    { label: "Color", children: [{ colors: (col) => setAll((w) => { w.color = col ?? "Black"; delete w.partId; }), selected: c?.color }] },
    { label: "Stripe", children: [{ colors: (col) => setAll((w) => { if (col) w.stripeColor = col; else delete w.stripeColor; delete w.partId; }), selected: c?.stripeColor, allowNone: true }] },
    ...(isWire ? [{
      label: "Assign part",
      children: [
        ...h.wireParts.map((p) => ({ label: partName(p), onClick: () => u((d) => { for (const x of selection.includes(id) ? selection : [id]) assignPart(d, x, p.id); }) })),
        ...(h.wireParts.length ? [{ separator: true } as MenuItem] : []),
        { label: "Create new wire part", onClick: () => createPartFrom(id, "wires") },
        { label: "Unassign part", onClick: () => u((d) => { for (const x of selection.includes(id) ? selection : [id]) assignPart(d, x, undefined); }) },
      ],
    } as MenuItem] : []),
    { label: "Select wires on net", kbd: "S", onClick: () => { st().select([id]); selectNetOfSelection(); } },
    { label: "Delete all layout points", onClick: () => setAll((w) => { delete w.layoutPoints; delete w.sourceLayoutPoints; delete w.targetLayoutPoints; }) },
    { separator: true },
    { label: wireIds.length > 1 ? "Make cable" : "Make cable from wire", disabled: !wireIds.length, onClick: () => { let cid; u((d) => { cid = makeCable(d, wireIds); }); if (cid) st().select([cid]); } },
    { label: "Twist together", disabled: wireIds.length < 2, onClick: () => { let tid; u((d) => { tid = twistTogether(d, wireIds); }); if (tid) st().select([tid]); } },
    { label: "Add splice", disabled: !wireIds.length, onClick: () => { let sid; u((d) => { sid = addSpliceOnWires(d, wireIds); }); if (sid) st().select([sid]); } },
    { separator: true },
    { label: "Delete", kbd: "Del", danger: true, onClick: () => { u((d) => deleteElements(d, selection.includes(id) ? selection : [id])); st().select([]); } },
  ];
}

export function cableMenu(h: Harness, id: string): MenuItem[] {
  const c = h.cables.find((x) => x.id === id);
  const u = st().update;
  if (!c) return [];
  return [
    { heading: "Cable" },
    { label: "Add core", disabled: c.cores.length >= 64, onClick: () => u((d) => setCableCoreCount(d, id, c.cores.length + 1)) },
    { label: "Remove last core", disabled: c.cores.length <= 1, onClick: () => u((d) => setCableCoreCount(d, id, c.cores.length - 1)) },
    { label: c.shield ? "Remove shield" : "Add shield", onClick: () => u((d) => { const x = d.cables.find((k) => k.id === id)!; if (x.shield) delete x.shield; else x.shield = { id: makeIdFactory(d)(), color: "Shield" }; }) },
    { label: "Twist all cores", onClick: () => u((d) => { const x = d.cables.find((k) => k.id === id)!; x.cores.forEach((k, i) => { if (i % 2 === 0 && i < x.cores.length - 1) k.twistedWithNext = true; else delete k.twistedWithNext; }); }) },
    { label: "Rotate", kbd: "R", onClick: () => u((d) => { const x = d.cables.find((k) => k.id === id)!; x.rotated = !x.rotated; }) },
    ...assignPartItems(h, id, "cables"),
    { separator: true },
    { label: "Delete", danger: true, onClick: () => { u((d) => deleteElements(d, [id])); st().select([]); } },
  ];
}

export function genericMenu(h: Harness, id: string, kind: string, title: string): MenuItem[] {
  const u = st().update;
  const rotatable = (ROTATABLE as readonly string[]).includes(kind);
  return [
    { heading: title },
    ...(rotatable ? [{ label: "Rotate", kbd: "R", onClick: () => u((d) => { const x = (d as any)[kind].find((k: any) => k.id === id); x.rotated = !x.rotated; }) } as MenuItem] : []),
    ...(kind === "diodes" ? [{ label: "Flip direction", onClick: () => u((d) => { const x = d.diodes.find((k) => k.id === id)!; x.anodeOnRight = !x.anodeOnRight; }) } as MenuItem] : []),
    ...assignPartItems(h, id, kind),
    { separator: true },
    { label: "Delete", kbd: "Del", danger: true, onClick: () => { u((d) => deleteElements(d, [id])); st().select([]); } },
  ];
}

export function bundleMenu(h: Harness, id: string, at: Pos): MenuItem[] {
  const u = st().update;
  const b = h.bundles.find((x) => x.id === id);
  if (!b) return [];
  return [
    { heading: "Bundle" },
    { label: "Add branch point here", onClick: () => { let bp; u((d) => { bp = splitBundle(d, id, at); }); if (bp) st().select([bp]); } },
    { label: "Add layout point here", onClick: () => u((d) => { const x = d.bundles.find((k) => k.id === id)!; x.layoutPoints = [...(x.layoutPoints ?? []), { id: makeIdFactory(d)(), layoutPosition: { x: Math.round(at.x / 30) * 30, y: Math.round(at.y / 30) * 30 } }]; }) },
    { label: "Delete all layout points", disabled: !b.layoutPoints?.length, onClick: () => u((d) => { delete d.bundles.find((k) => k.id === id)!.layoutPoints; }) },
    {
      label: "Assign covering",
      children: [
        ...h.coveringParts.map((p) => ({ label: partName(p), onClick: () => u((d) => { const x = d.bundles.find((k) => k.id === id)!; x.partIds = [...(x.partIds ?? []), p.id]; }) })),
        ...(h.coveringParts.length ? [{ separator: true } as MenuItem] : []),
        { label: "Create new covering part", onClick: () => u((d) => { const pid = addPart(d, "coveringParts", { description: "Covering" }); const x = d.bundles.find((k) => k.id === id)!; x.partIds = [...(x.partIds ?? []), pid]; }) },
      ],
    },
    { separator: true },
    { label: "Delete", kbd: "Del", danger: true, onClick: () => { u((d) => deleteElements(d, [id])); st().select([]); } },
  ];
}
