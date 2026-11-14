const HEX: Record<string, string> = {
  Black: "#1f2937",
  Brown: "#8b5a2b",
  Red: "#dc2626",
  Orange: "#f97316",
  Yellow: "#facc15",
  Green: "#16a34a",
  Blue: "#2563eb",
  Violet: "#7c3aed",
  Gray: "#6b7280",
  White: "#f8fafc",
  Pink: "#f472b6",
  Tan: "#d2b48c",
  Maroon: "#7f1d1d",
  "Light Yellow": "#fef08a",
  "Light Green": "#86efac",
  "Light Blue": "#93c5fd",
  "Light Gray": "#d1d5db",
  Transparent: "#e5e7eb",
  Shield: "#9ca3af",
};

export function colorHex(c: string | undefined): string {
  if (!c) return "#1f2937";
  if (c.startsWith("#")) return c;
  return HEX[c] ?? "#6b7280";
}

/** Whether the colour needs a dark outline to be visible on a light canvas. */
export function isLight(c: string | undefined): boolean {
  return ["White", "Light Yellow", "Light Gray", "Transparent", "Yellow", "Light Green", "Light Blue", "Tan"].includes(c ?? "");
}

const ABBREV: Record<string, string> = {
  Black: "BK", Brown: "BN", Red: "RD", Orange: "OG", Yellow: "YE", Green: "GN", Blue: "BU",
  Violet: "VT", Gray: "GY", White: "WH", Pink: "PK", Tan: "TN", Maroon: "MN", "Light Yellow": "LY",
  "Light Green": "LG", "Light Blue": "LB", "Light Gray": "LGY", Transparent: "TR", Shield: "SH",
};

export function colorCode(color: string | undefined, stripe?: string): string {
  const a = ABBREV[color ?? ""] ?? color ?? "";
  return stripe ? `${a}/${ABBREV[stripe] ?? stripe}` : a;
}
