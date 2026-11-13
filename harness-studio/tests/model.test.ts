import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, designationLabels, endpointLabel } from "../src/model/analysis";
import { buildBom } from "../src/model/bom";
import { connectionRows } from "../src/model/connections";
import { parseHarness, serializeHarness } from "../src/model/io";
import { emptyHarness } from "../src/model/types";
import { awgToMm2, mm2ToAwg, parseLengthExpression } from "../src/model/units";
import { validate } from "../src/model/validation";

const example = JSON.parse(readFileSync(new URL("./fixtures/docs-example.harness", import.meta.url), "utf8"));

describe("length expressions", () => {
  const p = (s: string, u: "mm" | "in" = "mm") => parseLengthExpression(s, u);
  it("adds plain numbers in the default unit", () => expect(p("40 + 30 + 40")).toEqual({ value: 110, unit: "mm" }));
  it("mixes units into the default unit", () => expect(p("30 + 20cm")).toEqual({ value: 230, unit: "mm" }));
  it("keeps a shared unit", () => expect(p("30cm + 20cm")).toEqual({ value: 50, unit: "cm" }));
  it("scales by plain numbers", () => {
    expect(p("2 * 30cm")).toEqual({ value: 60, unit: "cm" });
    expect(p("1200 / 4")).toEqual({ value: 300, unit: "mm" });
    expect(p("2 x 30cm")).toEqual({ value: 60, unit: "cm" });
  });
  it("rejects length × length", () => expect(() => p("10cm * 2cm")).toThrow());
  it("adds juxtaposed lengths", () => {
    expect(p(`5' 3"`, "in")).toEqual({ value: 63, unit: "in" });
    expect(p("1m 20cm")).toEqual({ value: 1200, unit: "mm" });
  });
  it("supports brackets with a unit", () => expect(p("(10 + 20) cm")).toEqual({ value: 30, unit: "cm" }));
});

describe("gauges", () => {
  it("converts AWG to mm² and back", () => {
    expect(awgToMm2(18)).toBeCloseTo(0.823, 2);
    expect(mm2ToAwg(awgToMm2(22))).toBeCloseTo(22, 5);
  });
});

describe("designations", () => {
  it("supports the documented strategies", () => {
    expect(designationLabels({ type: "sequential" }, 3)).toEqual(["1", "2", "3"]);
    expect(designationLabels({ type: "alphabetical", skippedLetters: ["I", "O"] }, 10)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "J", "K"]);
    expect(designationLabels({ type: "grid", rows: 2, columns: 3, rowLabels: { type: "alphabetical" }, columnLabels: { type: "sequential" } }, 6)).toEqual(["A1", "A2", "A3", "B1", "B2", "B3"]);
  });
});

describe("docs example harness", () => {
  const h = parseHarness(example);
  const a = analyze(h);

  it("flattens groups with qualified ids", () => {
    expect(h.terminals.map((t) => t.id).sort()).toEqual(["Lc1JP9-bnx1", "Lc1JP9-rBx6"]);
    expect(h.groups[0].memberIds.sort()).toEqual(["Lc1JP9-bnx1", "Lc1JP9-rBx6"]);
  });

  it("round-trips through serialize", () => {
    const out = serializeHarness(h) as any;
    expect(out.version).toBe(1.3);
    expect(out.groups[0].document.terminals.map((t: any) => t.id).sort()).toEqual(["bnx1", "rBx6"]);
    expect(out.wires.length).toBe(example.wires.length);
    expect(out.bundles.find((b: any) => b.id === "un8Y").sourceId).toBe("Lc1JP9-rBx6");
    const again = analyze(parseHarness(out));
    expect(again.conductors.length).toBe(a.conductors.length);
  });

  it("numbers components by canvas position", () => {
    expect(a.displayIds.get("liFLYR")).toBe("C1");
    expect(a.displayIds.get("o-ob")).toBe("C2");
    expect([...a.displayIds.values()].filter((v) => /^W\d+$/.test(v)).length).toBe(example.wires.length + 3);
  });

  it("routes wires through bundles and sums lengths", () => {
    const r = a.routes.get("OVWs")!;
    expect(r.noRoute).toBe(false);
    expect(r.lengthMm).toBe(30 + 200 + 150);
    expect(a.routes.get("aIpnUw")!.lengthMm).toBe(380);
  });

  it("propagates signals along nets and through mates", () => {
    expect(a.effectiveSignal.get("o-ob::MHZ6")).toBe("5V");
    expect(a.effectiveSignal.get("liFLYR::a_yeAK")).toBe("SIG 1");
  });

  it("produces connections, BOM and validation without errors", () => {
    const rows = connectionRows(h, a);
    expect(rows.length).toBe(a.conductors.length);
    expect(endpointLabel(a, { id: "ldgd", handle: "Biby" })).toMatch(/^Controller:/);
    const bom = buildBom(h, a);
    expect(bom.length).toBeGreaterThan(5);
    const issues = validate(h, a);
    expect(issues.filter((i) => i.code === "dangling")).toEqual([]);
  });
});

describe("validation rules", () => {
  it("flags mate cavity and gender mismatches", () => {
    const h = emptyHarness();
    h.connectorParts.push({ id: "p1", gender: "Male", numberOfCavities: 2 }, { id: "p2", gender: "Male", numberOfCavities: 3 });
    h.connectors.push(
      { id: "a", partId: "p1", cavities: [{ id: "a1" }, { id: "a2" }], schematicPosition: { x: 0, y: 0 }, layoutPosition: { x: 0, y: 0 } },
      { id: "b", partId: "p2", cavities: [{ id: "b1" }, { id: "b2" }, { id: "b3" }], schematicPosition: { x: 300, y: 0 }, layoutPosition: { x: 300, y: 0 } },
    );
    h.mates.push({ id: "m", sourceId: "a", targetId: "b" });
    const codes = validate(h, analyze(h)).map((i) => i.code);
    expect(codes).toContain("mate-cavities");
    expect(codes).toContain("mate-gender");
  });

  it("flags contact gauge out of range and NO ROUTE", () => {
    const h = emptyHarness();
    h.wireParts.push({ id: "w14", color: "Red", gauge: { value: 14, unit: "AWG" } });
    h.contactParts.push({ id: "k", minGauge: { value: 22, unit: "AWG" }, maxGauge: { value: 18, unit: "AWG" } });
    h.connectors.push(
      { id: "a", cavities: [{ id: "a1", contactPartId: "k" }], schematicPosition: { x: 0, y: 0 }, layoutPosition: { x: 0, y: 0 } },
      { id: "b", cavities: [{ id: "b1" }], schematicPosition: { x: 300, y: 0 }, layoutPosition: { x: 300, y: 0 } },
      { id: "c", cavities: [{ id: "c1" }], schematicPosition: { x: 600, y: 0 }, layoutPosition: { x: 600, y: 0 } },
    );
    h.wires.push({ id: "w", color: "Red", partId: "w14", source: { id: "a", handle: "a1" }, target: { id: "b", handle: "b1" } });
    h.bundles.push({ id: "bb", sourceId: "b", targetId: "c", length: { value: 1, unit: "m" } });
    const codes = validate(h, analyze(h)).map((i) => i.code);
    expect(codes).toContain("contact-gauge");
    expect(codes).toContain("no-route");
  });
});
