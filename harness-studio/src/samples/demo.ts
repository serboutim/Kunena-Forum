import { parseHarness } from "../model/io";
import type { Harness } from "../model/types";

const AWG = (value: number) => ({ value, unit: "AWG" });
const mm = (value: number) => ({ value, unit: "mm" });

/** A small engine-sensor harness that exercises every view. */
export const DEMO_DOCUMENT = {
  version: 1.3,
  title: "Engine Sensor Harness",
  lengthUnit: "mm",
  gaugeUnit: "AWG",
  connectors: [
    {
      id: "ecu", label: "ECU", schematicPosition: { x: 60, y: 60 }, layoutPosition: { x: 60, y: 240 }, partId: "cp-ecu",
      cavities: [
        { id: "ecu1", signal: "+12V" }, { id: "ecu2", signal: "GND" }, { id: "ecu3", signal: "CAN H" }, { id: "ecu4", signal: "CAN L" },
        { id: "ecu5", signal: "TPS SIG" }, { id: "ecu6", signal: "5V REF" }, { id: "ecu7", signal: "SENSOR GND" }, { id: "ecu8", notConnected: true },
      ],
    },
    {
      id: "tps", label: "TPS", schematicPosition: { x: 720, y: 30 }, layoutPosition: { x: 810, y: 60 }, partId: "cp-tps",
      cavities: [{ id: "tps1" }, { id: "tps2" }, { id: "tps3" }],
    },
    {
      id: "dash", label: "DASH", schematicPosition: { x: 720, y: 240 }, layoutPosition: { x: 810, y: 390 }, partId: "cp-dash",
      cavities: [{ id: "dash1" }, { id: "dash2" }, { id: "dash3" }, { id: "dash4" }],
    },
  ],
  terminals: [
    { id: "batp", label: "BAT+", type: "Ring", schematicPosition: { x: 720, y: 450 }, layoutPosition: { x: 300, y: 450 }, partId: "tp-m8", width: 120 },
    { id: "chassis", label: "CHASSIS", type: "Ring", schematicPosition: { x: 720, y: 510 }, layoutPosition: { x: 570, y: 480 }, partId: "tp-m6", width: 120 },
  ],
  splices: [{ id: "gsp", label: "GND", schematicPosition: { x: 480, y: 480 }, layoutPosition: { x: 540, y: 330 }, partId: "sp-butt" }],
  resistors: [{ id: "term", label: "TERM", schematicPosition: { x: 960, y: 270 }, layoutPosition: { x: 900, y: 330 }, rotated: true, locationId: "dash", partId: "rp-120" }],
  wires: [
    { id: "w-bat", color: "Red", partId: "wp-16rd", source: { id: "ecu", handle: "ecu1" }, target: { id: "batp", handle: "Terminal" } },
    { id: "w-dpwr", color: "Red", partId: "wp-20rd", source: { id: "ecu", handle: "ecu1" }, target: { id: "dash", handle: "dash3" } },
    { id: "w-g1", color: "Black", partId: "wp-20bk", source: { id: "ecu", handle: "ecu2" }, target: { id: "gsp", handle: "Splice" } },
    { id: "w-g2", color: "Black", partId: "wp-20bk", source: { id: "dash", handle: "dash4" }, target: { id: "gsp", handle: "Splice" } },
    { id: "w-g3", color: "Black", partId: "wp-16bk", source: { id: "gsp", handle: "Splice" }, target: { id: "chassis", handle: "Terminal" } },
    { id: "w-t1", color: "Green", partId: "wp-20gn", source: { id: "term", handle: "Left" }, target: { id: "dash", handle: "dash1" } },
    { id: "w-t2", color: "White", stripeColor: "Green", partId: "wp-20wh", source: { id: "term", handle: "Right" }, target: { id: "dash", handle: "dash2" } },
  ],
  twistedWires: [
    {
      id: "can", label: "CAN", schematicPosition: { x: 420, y: 240 },
      wires: [
        { id: "can-h", color: "Green", partId: "wp-20gn", source: { id: "ecu", handle: "ecu3" }, target: { id: "dash", handle: "dash1" } },
        { id: "can-l", color: "White", stripeColor: "Green", partId: "wp-20wh", source: { id: "ecu", handle: "ecu4" }, target: { id: "dash", handle: "dash2" } },
      ],
    },
  ],
  cables: [
    {
      id: "tpscable", label: "TPS CABLE", schematicPosition: { x: 420, y: 30 }, partId: "cab-3s",
      cores: [
        { id: "k1", color: "Red", source: { id: "ecu", handle: "ecu6" }, target: { id: "tps", handle: "tps1" } },
        { id: "k2", color: "White", source: { id: "ecu", handle: "ecu5" }, target: { id: "tps", handle: "tps2" } },
        { id: "k3", color: "Black", source: { id: "ecu", handle: "ecu7" }, target: { id: "tps", handle: "tps3" } },
      ],
      shield: { id: "k-sh", color: "Shield", source: { id: "ecu", handle: "ecu7" } },
    },
  ],
  branchPoints: [
    { id: "bp1", label: "FIREWALL", layoutPosition: { x: 300, y: 240 } },
    { id: "bp2", layoutPosition: { x: 540, y: 240 }, partIds: ["boot-y"] },
  ],
  bundles: [
    { id: "b1", sourceId: "ecu", targetId: "bp1", length: mm(400), partIds: ["cov-braid"] },
    { id: "b2", sourceId: "bp1", targetId: "batp", length: mm(300), partIds: ["cov-hs"] },
    { id: "b3", sourceId: "bp1", targetId: "bp2", length: mm(250), partIds: ["cov-braid"] },
    { id: "b4", sourceId: "bp2", targetId: "tps", length: mm(350), partIds: ["cov-corr"] },
    { id: "b5", sourceId: "bp2", targetId: "dash", length: mm(600), partIds: ["cov-corr"] },
    { id: "b6", sourceId: "bp2", targetId: "chassis", length: mm(200) },
  ],
  schematicNotes: [
    { id: "n1", text: "Twist CAN pair ≥ 33 twists/m. Termination resistor sits in the DASH backshell.", schematicPosition: { x: 60, y: 420 }, color: "Light Yellow", width: 270 },
  ],
  wireParts: [
    { id: "wp-16rd", partNumber: "TXL-16-RD", manufacturer: "Generic", description: "TXL wire 16 AWG red", color: "Red", gauge: AWG(16), pricePerLength: { price: 0.32, unit: "m" } },
    { id: "wp-16bk", partNumber: "TXL-16-BK", manufacturer: "Generic", description: "TXL wire 16 AWG black", color: "Black", gauge: AWG(16), pricePerLength: { price: 0.32, unit: "m" } },
    { id: "wp-20rd", partNumber: "TXL-20-RD", manufacturer: "Generic", description: "TXL wire 20 AWG red", color: "Red", gauge: AWG(20), pricePerLength: { price: 0.18, unit: "m" } },
    { id: "wp-20bk", partNumber: "TXL-20-BK", manufacturer: "Generic", description: "TXL wire 20 AWG black", color: "Black", gauge: AWG(20), pricePerLength: { price: 0.18, unit: "m" } },
    { id: "wp-20gn", partNumber: "TXL-20-GN", manufacturer: "Generic", description: "TXL wire 20 AWG green", color: "Green", gauge: AWG(20), pricePerLength: { price: 0.18, unit: "m" } },
    { id: "wp-20wh", partNumber: "TXL-20-WH/GN", manufacturer: "Generic", description: "TXL wire 20 AWG white/green", color: "White", stripeColor: "Green", gauge: AWG(20), pricePerLength: { price: 0.2, unit: "m" } },
  ],
  cableParts: [
    {
      id: "cab-3s", partNumber: "SC-3x22-S", manufacturer: "Generic", description: "3 core 22 AWG shielded sensor cable", color: "Black", shielded: true,
      cores: [{ id: "c1", color: "Red", gauge: AWG(22) }, { id: "c2", color: "White", gauge: AWG(22) }, { id: "c3", color: "Black", gauge: AWG(22) }],
      pricePerLength: { price: 1.45, unit: "m" },
    },
  ],
  connectorParts: [
    {
      id: "cp-ecu", partNumber: "HSG-8F", manufacturer: "Generic", description: "8-way sealed receptacle", color: "Gray", gender: "Female", numberOfCavities: 8, price: 3.8,
      configurations: [{ id: "cfg-ecu", accessories: [{ id: "a1", type: "ContactPart", partId: "ct-sock" }, { id: "a2", type: "CavityPlugPart", partId: "plug" }, { id: "a3", type: "LockPart", partId: "lock-8" }] }],
    },
    {
      id: "cp-tps", partNumber: "HSG-3M", manufacturer: "Generic", description: "3-way sensor plug", color: "Black", gender: "Male", numberOfCavities: 3, price: 1.6,
      designationStrategy: { type: "alphabetical" },
      configurations: [{ id: "cfg-tps", accessories: [{ id: "a4", type: "ContactPart", partId: "ct-pin" }] }],
    },
    {
      id: "cp-dash", partNumber: "HSG-4F", manufacturer: "Generic", description: "4-way receptacle", color: "Gray", gender: "Female", numberOfCavities: 4, price: 2.1,
      configurations: [{ id: "cfg-dash", accessories: [{ id: "a5", type: "ContactPart", partId: "ct-sock" }, { id: "a6", type: "BackshellPart", partId: "bs-4" }] }],
    },
  ],
  contactParts: [
    { id: "ct-sock", partNumber: "CT-S-2016", manufacturer: "Generic", description: "Socket contact 20–16 AWG", gender: "Socket", type: "Crimp", minGauge: AWG(22), maxGauge: AWG(16), price: 0.22 },
    { id: "ct-pin", partNumber: "CT-P-2016", manufacturer: "Generic", description: "Pin contact 22–16 AWG", gender: "Pin", type: "Crimp", minGauge: AWG(22), maxGauge: AWG(16), price: 0.2 },
  ],
  cavityPlugParts: [{ id: "plug", partNumber: "CP-SEAL", manufacturer: "Generic", description: "Cavity plug", price: 0.05 }],
  lockParts: [{ id: "lock-8", partNumber: "WL-8", manufacturer: "Generic", description: "Wedgelock 8-way", price: 0.3 }],
  backshellParts: [{ id: "bs-4", partNumber: "BS-4", manufacturer: "Generic", description: "Backshell 4-way", price: 1.1 }],
  terminalParts: [
    { id: "tp-m8", partNumber: "RT-M8-1614", manufacturer: "Generic", description: "Ring terminal M8, 16–14 AWG", type: "Ring", size: mm(8), minGauge: AWG(16), maxGauge: AWG(14), price: 0.25 },
    { id: "tp-m6", partNumber: "RT-M6-1614", manufacturer: "Generic", description: "Ring terminal M6, 16–14 AWG", type: "Ring", size: mm(6), minGauge: AWG(16), maxGauge: AWG(14), price: 0.22 },
  ],
  spliceParts: [{ id: "sp-butt", partNumber: "SPL-2212", manufacturer: "Generic", description: "Solder sleeve splice 22–12 AWG", minGauge: AWG(22), maxGauge: AWG(12), price: 0.4 }],
  resistorParts: [{ id: "rp-120", partNumber: "RES-120R-0W5", manufacturer: "Generic", description: "120 Ω 0.5 W axial", resistance: 120, resistanceUnit: "ohm", power: 0.5, powerUnit: "W", price: 0.08 }],
  coveringParts: [
    { id: "cov-braid", partNumber: "PET-BRAID-13", manufacturer: "Generic", description: "PET braided sleeve 13 mm", type: "BraidedSleeve", color: "Black", minDiameter: mm(6), maxDiameter: mm(20), isFixedLength: false, pricePerLength: { price: 0.9, unit: "m" } },
    { id: "cov-corr", partNumber: "CT-10", manufacturer: "Generic", description: "Corrugated split tubing 10 mm", type: "CorrugatedTubing", color: "Black", minDiameter: mm(0), maxDiameter: mm(10), isFixedLength: false, pricePerLength: { price: 0.6, unit: "m" } },
    { id: "cov-hs", partNumber: "HS-6-2", manufacturer: "Generic", description: "Heat shrink 6 mm 2:1", type: "HeatShrink", color: "Red", minDiameter: mm(3), maxDiameter: mm(6), isFixedLength: false, pricePerLength: { price: 0.5, unit: "m" } },
  ],
  bootParts: [{ id: "boot-y", partNumber: "YB-3", manufacturer: "Generic", description: "Moulded Y-boot", color: "Black", price: 1.2 }],
};

export function demoHarness(): Harness {
  return parseHarness(DEMO_DOCUMENT);
}
