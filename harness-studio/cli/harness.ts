#!/usr/bin/env -S npx tsx
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { analyze, endpointLabel, nameOf, splitKey } from "../src/model/analysis.ts";
import { bomToCsv, bomTotal, buildBom } from "../src/model/bom.ts";
import { connectionRows, connectionsToCsv, wiringTable } from "../src/model/connections.ts";
import { harnessToText, parseHarness } from "../src/model/io.ts";
import type { Harness } from "../src/model/types.ts";
import { formatLength } from "../src/model/units.ts";
import { partName, validate } from "../src/model/validation.ts";
import { demoHarness } from "../src/samples/demo.ts";

const USAGE = `Harness Studio CLI - inspect and check .harness files

Usage: harness <command> <file.harness> [options]

Commands:
  info <file>                 Summary: counts, units, total wire length, BOM cost
  validate <file>             List errors, warnings and info. Exits 1 when errors exist
  connections <file>          Connections table (every wire, core and shield)
  wiring <file> <component>   Wiring table for one connector/terminal (label, display ID or id)
  nets <file>                 Electrical nets with their endpoints and signals
  bom <file>                  Bill of materials with totals
  format <file> [out]         Re-save in canonical .harness v1.3 form (in place by default)
  demo <out>                  Write the demo harness to a file

Options:
  --json                      Machine-readable JSON output
  --csv                       CSV output (connections, bom)
`;

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
  return rows.map((r, n) => {
    const line = r.map((c, i) => (c ?? "").padEnd(widths[i])).join("  ").trimEnd();
    return n === 0 ? `${line}\n${widths.map((w) => "-".repeat(w)).join("  ")}` : line;
  }).join("\n");
}

function load(file: string | undefined): Harness {
  if (!file) fail("Missing file argument.");
  try {
    return parseHarness(readFileSync(file, "utf8"));
  } catch (err) {
    fail(`Could not read ${file}: ${(err as Error).message}`);
  }
}

function fail(msg: string): never {
  process.stderr.write(`${msg}\n\n${USAGE}`);
  process.exit(2);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((x) => x.startsWith("--")));
const [cmd, file, extra] = args.filter((x) => !x.startsWith("--"));
const json = flags.has("--json");
const csv = flags.has("--csv");
const out = (s: string) => process.stdout.write(s.endsWith("\n") ? s : `${s}\n`);

switch (cmd) {
  case "info": {
    const h = load(file);
    const a = analyze(h);
    const issues = validate(h, a);
    const bom = buildBom(h, a);
    const wireMm = a.conductors.reduce((s, c) => s + (a.routes.get(c.id)?.lengthMm ?? 0), 0);
    const info = {
      title: h.title ?? basename(file!), lengthUnit: h.lengthUnit, gaugeUnit: h.gaugeUnit, currency: h.currency,
      connectors: h.connectors.length, terminals: h.terminals.length, splices: h.splices.length, diodes: h.diodes.length,
      resistors: h.resistors.length, conductors: a.conductors.length, cables: h.cables.length, bundles: h.bundles.length,
      branchPoints: h.branchPoints.length, mates: h.mates.length, nets: a.nets.length,
      totalWireLength: formatLength(wireMm, h.lengthUnit), bomTotal: bomTotal(bom),
      errors: issues.filter((i) => i.severity === "error").length, warnings: issues.filter((i) => i.severity === "warning").length,
    };
    if (json) out(JSON.stringify(info, null, 2));
    else out(Object.entries(info).map(([k, v]) => `${k.padEnd(16)} ${k === "bomTotal" ? `${h.currency}${(v as number).toFixed(2)}` : v}`).join("\n"));
    break;
  }
  case "validate": {
    const h = load(file);
    const issues = validate(h, analyze(h));
    if (json) out(JSON.stringify(issues, null, 2));
    else if (!issues.length) out("No issues found.");
    else out(issues.map((i) => `${i.severity.toUpperCase().padEnd(7)} ${i.code.padEnd(18)} ${i.message}`).join("\n"));
    process.exitCode = issues.some((i) => i.severity === "error") ? 1 : 0;
    break;
  }
  case "connections": {
    const h = load(file);
    const a = analyze(h);
    const rows = connectionRows(h, a);
    if (csv) out(connectionsToCsv(h, a));
    else if (json) out(JSON.stringify(rows.map(({ conductor: _c, ...r }) => r), null, 2));
    else out(table([["ID", "From", "Signal", "To", "Signal", "Color", "Gauge", "Length", "Part", "Status"],
      ...rows.map((r) => [r.id, r.from, r.fromSignal, r.to, r.toSignal, r.color, r.gauge, r.length, r.part, r.status.join(", ")])]));
    break;
  }
  case "wiring": {
    const h = load(file);
    const a = analyze(h);
    if (!extra) fail("Missing component argument.");
    const target = [...h.connectors, ...h.terminals].find((c) => c.id === extra || c.label === extra || a.displayIds.get(c.id) === extra);
    if (!target) fail(`No connector or terminal named "${extra}".`);
    const rows = wiringTable(h, a, target.id);
    if (json) out(JSON.stringify(rows, null, 2));
    else out(`${nameOf(a, target.id)}\n\n${table([["Cavity", "Signal", "Destination", "Wire", "Color", "Length"], ...rows.map((r) => [r.cavity, r.signal, r.destination, r.wire, r.color, r.length])])}`);
    break;
  }
  case "nets": {
    const h = load(file);
    const a = analyze(h);
    const nets = a.nets.map((n) => ({
      name: n.name, signals: n.signals,
      endpoints: n.endpoints.map((k) => endpointLabel(a, splitKey(k))),
      conductors: n.conductors.map((c) => a.conductorById.get(c)?.displayId ?? c),
    }));
    if (json) out(JSON.stringify(nets, null, 2));
    else out(nets.map((n) => `${n.name}${n.signals.length > 1 ? `  (signals: ${n.signals.join(", ")})` : ""}\n  ${n.endpoints.join(", ")}\n  via ${n.conductors.join(", ") || "-"}`).join("\n\n"));
    break;
  }
  case "bom": {
    const h = load(file);
    const rows = buildBom(h, analyze(h));
    if (csv) out(bomToCsv(h, rows));
    else if (json) out(JSON.stringify(rows.map((r) => ({ partId: r.partId, kind: r.kind, part: partName(r.part), partNumber: r.part.partNumber, quantity: r.quantity, unit: r.unit, unitPrice: r.unitPrice, total: r.total, incomplete: r.incomplete, usedBy: r.usedBy })), null, 2));
    else {
      const money = (n?: number) => (n === undefined ? "" : `${h.currency}${n.toFixed(n !== 0 && Math.abs(n) < 0.1 ? 5 : 2)}`);
      out(table([["Part", "Kind", "Qty", "Unit", "Price", "Total"], ...rows.map((r) => [partName(r.part), r.kind.replace(/Parts$/, ""), `${r.quantity}${r.incomplete ? "*" : ""}`, r.unit, money(r.unitPrice), money(r.total)])]));
      out(`\nTotal ${money(bomTotal(rows))}${rows.some((r) => r.incomplete) ? "\n* some lengths are unknown (unrouted wires or bundles without a length)" : ""}`);
    }
    break;
  }
  case "format": {
    const h = load(file);
    writeFileSync(extra ?? file!, harnessToText(h));
    out(`Wrote ${extra ?? file}`);
    break;
  }
  case "demo": {
    if (!file) fail("Missing output file.");
    writeFileSync(file, harnessToText(demoHarness()));
    out(`Wrote ${file}`);
    break;
  }
  case undefined:
  case "help":
    out(USAGE);
    break;
  default:
    fail(`Unknown command "${cmd}".`);
}
