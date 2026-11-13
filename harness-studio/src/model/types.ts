export const FORMAT_VERSION = 1.3;

export const PART_COLORS = [
  "Black", "Brown", "Red", "Orange", "Yellow", "Green", "Blue", "Violet", "Gray", "White",
  "Pink", "Tan", "Maroon", "Light Yellow", "Light Green", "Light Blue", "Light Gray",
  "Transparent", "Shield",
] as const;
export type PartColor = (typeof PART_COLORS)[number] | (string & {});

export const TERMINAL_TYPES = ["Ferrule", "Ring", "Spade", "QuickConnectMale", "QuickConnectFemale", "Loose"] as const;
export type TerminalType = (typeof TERMINAL_TYPES)[number];

export const LENGTH_UNITS = ["mm", "cm", "m", "in", "ft", "yd"] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

export const GAUGE_UNITS = ["AWG", "Metric", "cmil", "kcmil"] as const;
export type GaugeUnit = (typeof GAUGE_UNITS)[number];

export const CURRENCIES = ["$", "€", "£", "¥", "₹"] as const;

export const COVERING_TYPES = ["HeatShrink", "CorrugatedTubing", "SpiralWrap", "Tape", "Tubing", "BraidedSleeve", "Other"] as const;
export type CoveringType = (typeof COVERING_TYPES)[number];

export interface Pos { x: number; y: number }
export interface Length { value: number; unit: LengthUnit }
export interface Gauge { value: number; unit: GaugeUnit | "mm²" | "AWG" }

export interface ConnectionPoint { id: string; handle: string }

export interface LayoutPoint { id: string; schematicPosition?: Pos; layoutPosition?: Pos }

export const RESERVED_HANDLES = ["Terminal", "Splice", "Left", "Right"] as const;

interface Base { id: string; [extra: string]: unknown }

export interface Cavity extends Base {
  signal?: string;
  propagate?: boolean;
  global?: boolean;
  notConnected?: boolean;
  contactPartId?: string;
  cavityPlugPartId?: string;
  cavitySealPartId?: string | null;
}

export interface CrossFlow extends Base {
  label?: string;
  schematicPosition?: Pos;
  layoutPosition?: Pos;
  partId?: string;
  configurationId?: string;
  excludeFromBom?: boolean;
  idNumber?: number;
}

export interface Connector extends CrossFlow {
  cavities: Cavity[];
  shell?: Cavity;
  width?: number;
  rotated?: boolean;
}

export interface Terminal extends CrossFlow {
  type: TerminalType;
  signal?: string;
  propagate?: boolean;
  global?: boolean;
  width?: number;
  rotated?: boolean;
}

export interface Splice extends CrossFlow { locationId?: string }
export interface Diode extends CrossFlow { locationId?: string; anodeOnRight?: boolean; rotated?: boolean }
export interface Resistor extends CrossFlow { locationId?: string; rotated?: boolean }

export interface ConductorProps {
  color: PartColor;
  stripeColor?: PartColor;
  identColors?: PartColor[];
  identLabel?: string;
}

export interface Wire extends Base, ConductorProps {
  source: ConnectionPoint;
  target: ConnectionPoint;
  partId?: string;
  excludeFromBom?: boolean;
  layoutPoints?: LayoutPoint[];
  idNumber?: number;
}

export interface CableCore extends Base, ConductorProps {
  source?: ConnectionPoint;
  target?: ConnectionPoint;
  sourceLayoutPoints?: LayoutPoint[];
  targetLayoutPoints?: LayoutPoint[];
  twistedWithNext?: boolean;
}

export interface Cable extends Base {
  label?: string;
  schematicPosition: Pos;
  rotated?: boolean;
  partId?: string;
  cores: CableCore[];
  shield?: CableCore;
  excludeFromBom?: boolean;
  idNumber?: number;
}

export interface SplitWire extends CableCore { partId?: string; excludeFromBom?: boolean }

export interface TwistedWires extends Base {
  label?: string;
  schematicPosition: Pos;
  rotated?: boolean;
  wires: SplitWire[];
  idNumber?: number;
}

export interface Bundle extends Base {
  sourceId: string;
  targetId: string;
  length?: Length;
  label?: string;
  labelColor?: PartColor;
  partIds?: string[];
  layoutPoints?: LayoutPoint[];
  idNumber?: number;
}

export interface BranchPoint extends Base {
  label?: string;
  layoutPosition: Pos;
  partIds?: string[];
  idNumber?: number;
}

export interface Mate extends Base { sourceId: string; targetId: string; targetCavityId?: string }

export interface Note extends Base {
  text: string;
  schematicPosition?: Pos;
  layoutPosition?: Pos;
  color?: PartColor;
  width?: number;
  alignment?: "Left" | "Center" | "Right";
  verticalAlignment?: "Top" | "Middle" | "Bottom";
}

/** Group metadata. Members are kept flattened in the document under qualified ids (`<groupId>-<localId>`). */
export interface GroupMeta extends Base {
  name?: string;
  locked?: boolean;
  views?: "Schematic" | "Layout" | "Both";
  partId?: string;
  excludeFromBom?: boolean;
  link?: Record<string, unknown>;
  parentGroupId?: string;
  memberIds: string[];
}

// ---------- Parts ----------

export interface PartBase extends Base {
  partNumber?: string;
  internalPartNumber?: string;
  manufacturer?: string;
  description?: string;
  url?: string;
  color?: PartColor;
  price?: number;
  pricePerLength?: { price: number; unit: LengthUnit };
  minGauge?: Gauge;
  maxGauge?: Gauge;
}

export type AccessoryType =
  | "LockPart" | "DustCoverPart" | "BackshellPart" | "BootPart" | "MountPart"
  | "CoveringPart" | "ContactPart" | "CavityPlugPart" | "CavitySealPart";

export interface CavityPartRule {
  apply?: "connected" | "unconnected" | "never";
  minGauge?: Gauge;
  maxGauge?: Gauge;
  gaugeFromPart?: boolean;
  [extra: string]: unknown;
}

export interface ConfigurationAccessory { id: string; type: AccessoryType; partId?: string; rule?: CavityPartRule }
export interface PartConfiguration { id: string; name?: string; accessories?: ConfigurationAccessory[] }

export type DesignationStrategy =
  | { type: "sequential" }
  | { type: "alphabetical"; skippedLetters?: string[] }
  | { type: "custom"; labels: string[] }
  | { type: "grid"; rows: number; columns: number; rowLabels?: { type: string }; columnLabels?: { type: string } };

export interface WirePart extends PartBase { gauge?: Gauge; stripeColor?: PartColor; insulation?: Length; diameter?: Length }
export interface ConnectorPart extends PartBase {
  gender?: "Male" | "Female";
  numberOfCavities?: number;
  hasShell?: boolean;
  designationStrategy?: DesignationStrategy;
  configurations?: PartConfiguration[];
}
export interface TerminalPart extends PartBase { type?: TerminalType; size?: Length | string; configurations?: PartConfiguration[] }
export interface ContactPart extends PartBase { gender?: "Pin" | "Socket"; type?: "Crimp" | "Solder" | "Other" }
export interface CoveringPart extends PartBase {
  type?: CoveringType;
  minDiameter?: Length;
  maxDiameter?: Length;
  isFixedLength?: boolean;
  length?: Length;
}
export interface CableCorePart { id: string; color: PartColor; stripeColor?: PartColor; gauge?: Gauge; twistedWithNext?: boolean }
export interface CablePart extends PartBase { shielded?: boolean; cores?: CableCorePart[] }

export const PART_KINDS = [
  "wireParts", "connectorParts", "terminalParts", "spliceParts", "contactParts", "cableParts",
  "coveringParts", "diodeParts", "resistorParts", "groupParts", "lockParts", "dustCoverParts",
  "backshellParts", "bootParts", "cavitySealParts", "cavityPlugParts", "mountParts",
] as const;
export type PartKind = (typeof PART_KINDS)[number];

export const PART_KIND_LABEL: Record<PartKind, string> = {
  wireParts: "Wire", connectorParts: "Connector", terminalParts: "Terminal", spliceParts: "Splice",
  contactParts: "Contact", cableParts: "Cable", coveringParts: "Covering", diodeParts: "Diode",
  resistorParts: "Resistor", groupParts: "Group", lockParts: "Lock", dustCoverParts: "Dust cover",
  backshellParts: "Backshell", bootParts: "Boot", cavitySealParts: "Cavity seal",
  cavityPlugParts: "Cavity plug", mountParts: "Mount",
};

export const ACCESSORY_KIND: Record<AccessoryType, PartKind> = {
  LockPart: "lockParts", DustCoverPart: "dustCoverParts", BackshellPart: "backshellParts",
  BootPart: "bootParts", MountPart: "mountParts", CoveringPart: "coveringParts",
  ContactPart: "contactParts", CavityPlugPart: "cavityPlugParts", CavitySealPart: "cavitySealParts",
};

export const COMPONENT_KINDS = [
  "connectors", "terminals", "splices", "diodes", "resistors", "wires", "cables", "twistedWires",
  "bundles", "branchPoints", "mates", "schematicNotes", "layoutNotes",
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export interface HarnessSettings {
  title?: string;
  currency: string;
  lengthUnit: LengthUnit;
  gaugeUnit: GaugeUnit;
  readOnly?: boolean;
  idNumbers?: { numbering: "CanvasPosition" | "Static"; lastIdNumbers?: Record<string, number> };
}

/** In-memory harness: the v1.3 document with groups flattened and every array present. */
export interface Harness extends HarnessSettings {
  connectors: Connector[];
  terminals: Terminal[];
  splices: Splice[];
  diodes: Diode[];
  resistors: Resistor[];
  wires: Wire[];
  cables: Cable[];
  twistedWires: TwistedWires[];
  bundles: Bundle[];
  branchPoints: BranchPoint[];
  mates: Mate[];
  schematicNotes: Note[];
  layoutNotes: Note[];
  groups: GroupMeta[];
  wireParts: WirePart[];
  connectorParts: ConnectorPart[];
  terminalParts: TerminalPart[];
  spliceParts: PartBase[];
  contactParts: ContactPart[];
  cableParts: CablePart[];
  coveringParts: CoveringPart[];
  diodeParts: PartBase[];
  resistorParts: PartBase[];
  groupParts: PartBase[];
  lockParts: PartBase[];
  dustCoverParts: PartBase[];
  backshellParts: PartBase[];
  bootParts: PartBase[];
  cavitySealParts: PartBase[];
  cavityPlugParts: PartBase[];
  mountParts: PartBase[];
  /** Unrecognised top-level fields, preserved on save. */
  extra: Record<string, unknown>;
}

export type CrossFlowKind = "connectors" | "terminals" | "splices" | "diodes" | "resistors";
export const CROSS_FLOW_KINDS: CrossFlowKind[] = ["connectors", "terminals", "splices", "diodes", "resistors"];
export type InlineKind = "splices" | "diodes" | "resistors";

export function emptyHarness(): Harness {
  return {
    currency: "$", lengthUnit: "mm", gaugeUnit: "AWG",
    connectors: [], terminals: [], splices: [], diodes: [], resistors: [], wires: [], cables: [],
    twistedWires: [], bundles: [], branchPoints: [], mates: [], schematicNotes: [], layoutNotes: [],
    groups: [],
    wireParts: [], connectorParts: [], terminalParts: [], spliceParts: [], contactParts: [], cableParts: [],
    coveringParts: [], diodeParts: [], resistorParts: [], groupParts: [], lockParts: [], dustCoverParts: [],
    backshellParts: [], bootParts: [], cavitySealParts: [], cavityPlugParts: [], mountParts: [],
    extra: {},
  };
}
