import type { Gauge, GaugeUnit, Length, LengthUnit } from "./types";

export const MM_PER: Record<LengthUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8, yd: 914.4 };

export function toMm(l: Length | undefined): number | undefined {
  if (!l || !Number.isFinite(l.value)) return undefined;
  return l.value * (MM_PER[l.unit] ?? 1);
}

export function fromMm(mm: number, unit: LengthUnit): number {
  return mm / MM_PER[unit];
}

export function formatLength(mm: number | undefined, unit: LengthUnit, digits = 0): string {
  if (mm === undefined || !Number.isFinite(mm)) return "—";
  const v = fromMm(mm, unit);
  const d = unit === "mm" ? digits : Math.max(digits, unit === "cm" ? 1 : 2);
  return `${round(v, d)} ${unit}`;
}

export function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

const UNIT_ALIASES: Record<string, LengthUnit> = {
  mm: "mm", cm: "cm", m: "m", in: "in", '"': "in", "″": "in", ft: "ft", "'": "ft", "′": "ft", yd: "yd",
};

interface Val { v: number; length: boolean; units: Set<LengthUnit> }

export class LengthParseError extends Error {}

/**
 * Evaluates a length expression such as `40 + 30 + 40`, `5' 3"`, `(10 + 20) cm` or `1200 / 4`.
 * Plain numbers are in `defaultUnit` unless they scale a length; the result keeps a unit only when
 * every length in the expression uses it.
 */
export function parseLengthExpression(input: string, defaultUnit: LengthUnit): Length {
  const tokens = tokenize(input);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  const promote = (a: Val): Val => (a.length ? a : { v: a.v * MM_PER[defaultUnit], length: true, units: new Set([defaultUnit]) });
  const union = (a: Val, b: Val) => new Set([...a.units, ...b.units]);

  const add = (a: Val, b: Val, sign: 1 | -1): Val => {
    if (!a.length && !b.length) return { v: a.v + sign * b.v, length: false, units: new Set() };
    const pa = promote(a), pb = promote(b);
    return { v: pa.v + sign * pb.v, length: true, units: union(pa, pb) };
  };

  function expr(): Val {
    let left = term();
    for (;;) {
      const t = peek();
      if (t?.kind === "op" && (t.value === "+" || t.value === "-")) {
        next();
        left = add(left, term(), t.value === "+" ? 1 : -1);
      } else if (t && (t.kind === "num" || (t.kind === "paren" && t.value === "("))) {
        left = add(left, term(), 1); // juxtaposition: 5' 3" or 1m 20cm
      } else return left;
    }
  }

  function term(): Val {
    let left = factor();
    for (;;) {
      const t = peek();
      if (t?.kind === "op" && (t.value === "*" || t.value === "/")) {
        next();
        const right = factor();
        if (t.value === "*") {
          if (left.length && right.length) throw new LengthParseError("Cannot multiply two lengths");
          left = { v: left.v * right.v, length: left.length || right.length, units: union(left, right) };
        } else {
          if (right.length) throw new LengthParseError("Cannot divide by a length");
          if (right.v === 0) throw new LengthParseError("Division by zero");
          left = { v: left.v / right.v, length: left.length, units: left.units };
        }
      } else return left;
    }
  }

  function factor(): Val {
    const t = next();
    if (!t) throw new LengthParseError("Unexpected end of input");
    if (t.kind === "op" && t.value === "-") {
      const f = factor();
      return { ...f, v: -f.v };
    }
    if (t.kind === "paren" && t.value === "(") {
      const inner = expr();
      const close = next();
      if (!close || close.kind !== "paren" || close.value !== ")") throw new LengthParseError("Missing )");
      return withUnit(inner);
    }
    if (t.kind === "num") return withUnit({ v: Number(t.value), length: false, units: new Set() });
    throw new LengthParseError(`Unexpected '${t.value}'`);
  }

  function withUnit(val: Val): Val {
    const t = peek();
    if (t?.kind === "unit") {
      next();
      const u = UNIT_ALIASES[t.value];
      if (val.length) throw new LengthParseError("Unit applied twice");
      return { v: val.v * MM_PER[u], length: true, units: new Set([u]) };
    }
    return val;
  }

  if (tokens.length === 0) throw new LengthParseError("Empty length");
  const result = promote(expr());
  if (i < tokens.length) throw new LengthParseError(`Unexpected '${tokens[i].value}'`);
  const unit: LengthUnit = result.units.size === 1 ? [...result.units][0] : defaultUnit;
  return { value: round(fromMm(result.v, unit), 6), unit };
}

type Token = { kind: "num" | "op" | "paren" | "unit"; value: string };

function tokenize(input: string): Token[] {
  const out: Token[] = [];
  const s = input.trim().toLowerCase();
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (num) { out.push({ kind: "num", value: num[0] }); i += num[0].length; continue; }
    if ("+-*/x×".includes(c)) {
      out.push({ kind: "op", value: c === "x" || c === "×" ? "*" : c });
      i++;
      continue;
    }
    if (c === "(" || c === ")") { out.push({ kind: "paren", value: c }); i++; continue; }
    const unit = /^(mm|cm|yd|ft|in|m|"|'|″|′)/.exec(s.slice(i));
    if (unit) { out.push({ kind: "unit", value: unit[0] }); i += unit[0].length; continue; }
    throw new LengthParseError(`Unexpected '${c}'`);
  }
  return out;
}

// ---------- Gauges ----------

export function awgToMm2(awg: number): number {
  const d = 0.127 * 92 ** ((36 - awg) / 39);
  return (Math.PI / 4) * d * d;
}

export function mm2ToAwg(mm2: number): number {
  const d = Math.sqrt((4 * mm2) / Math.PI);
  return 36 - 39 * (Math.log(d / 0.127) / Math.log(92));
}

const MM2_PER_CMIL = 0.000506707479;

export function gaugeToMm2(g: Gauge | undefined): number | undefined {
  if (!g || !Number.isFinite(g.value)) return undefined;
  switch (g.unit) {
    case "AWG": return awgToMm2(g.value);
    case "cmil": return g.value * MM2_PER_CMIL;
    case "kcmil": return g.value * 1000 * MM2_PER_CMIL;
    default: return g.value;
  }
}

export function mm2ToGauge(mm2: number, unit: GaugeUnit): Gauge {
  switch (unit) {
    case "AWG": return { value: round(mm2ToAwg(mm2), 1), unit };
    case "cmil": return { value: round(mm2 / MM2_PER_CMIL, 0), unit };
    case "kcmil": return { value: round(mm2 / MM2_PER_CMIL / 1000, 2), unit };
    default: return { value: round(mm2, 2), unit: "Metric" };
  }
}

export function formatGauge(g: Gauge | undefined): string {
  if (!g) return "—";
  if (g.unit === "Metric" || g.unit === "mm²") return `${g.value} mm²`;
  return `${g.value} ${g.unit}`;
}

export function formatMm2(mm2: number | undefined, unit: GaugeUnit): string {
  if (mm2 === undefined) return "—";
  return formatGauge(mm2ToGauge(mm2, unit));
}

export function parseGauge(input: string, defaultUnit: GaugeUnit): Gauge | undefined {
  const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(awg|mm²|mm2|mm\^2|cmil|kcmil|kmil)?\s*$/i.exec(input);
  if (!m) return undefined;
  const value = Number(m[1]);
  const u = (m[2] ?? "").toLowerCase();
  if (u === "awg") return { value, unit: "AWG" };
  if (u.startsWith("mm")) return { value, unit: "Metric" };
  if (u === "cmil") return { value, unit: "cmil" };
  if (u === "kcmil" || u === "kmil") return { value, unit: "kcmil" };
  return { value, unit: defaultUnit };
}

/** Typical outside diameter (mm) of a thin-wall automotive/aerospace wire of the given conductor area. */
export function estimateWireDiameter(mm2: number | undefined): number {
  const area = mm2 ?? 0.5;
  const conductor = Math.sqrt((4 * area) / Math.PI) * 1.15;
  const insulation = Math.max(0.2, 0.18 + 0.06 * Math.sqrt(area) * 2);
  return conductor + 2 * insulation;
}
