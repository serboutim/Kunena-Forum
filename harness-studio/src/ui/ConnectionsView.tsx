import { useMemo, useState } from "react";
import { colorHex } from "../model/colors";
import { connectionRows, connectionsToCsv } from "../model/connections";
import { assignPart, findConductor } from "../model/ops";
import { PART_COLORS } from "../model/types";
import { partName } from "../model/validation";
import { useStore } from "../store";
import { downloadText } from "./files";
import { analysisOf, computeHighlight } from "./hooks";

export function ConnectionsView() {
  const h = useStore((s) => s.h);
  const selection = useStore((s) => s.selection);
  const highlightNets = useStore((s) => s.options.highlightNets);
  const fileName = useStore((s) => s.fileName);
  const { select, update } = useStore.getState();
  const { a } = analysisOf(h);
  const [filter, setFilter] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const rows = useMemo(() => connectionRows(h, a), [h, a]);
  const hl = useMemo(() => computeHighlight(a, selection, highlightNets), [a, selection, highlightNets]);
  const sel = new Set(selection);
  const q = filter.trim().toLowerCase();
  const shown = rows.filter((r) => (!onlyIssues || r.status.some((s) => s !== "Est. length")) && (!q || [r.id, r.from, r.to, r.fromSignal, r.toSignal, r.color, r.part, r.cable].some((v) => v.toLowerCase().includes(q))));
  const totalMm = rows.reduce((s, r) => s + (r.lengthMm ?? 0), 0);

  return (
    <div className="table-view">
      <div className="table-toolbar">
        <h2>Connections</h2>
        <input className="input" style={{ width: 260 }} placeholder="Filter by wire, connector, signal, part…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <label className="check"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only rows with issues</label>
        <span style={{ flex: 1 }} />
        <span className="hint-text">{rows.length} conductors · {(totalMm / 1000).toFixed(2)} m of wire</span>
        <button className="btn" onClick={() => downloadText(connectionsToCsv(h, a), fileName.replace(/\.harness$/, "") + " - connections.csv", "text/csv")}>Export CSV</button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Wire</th><th>From</th><th>Signal</th><th>To</th><th>Signal</th><th>Color</th><th>Part</th><th>Gauge</th><th className="num">Length</th><th>Twisted with</th><th>Cable</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const c = r.conductor;
            const isWire = c.kind === "wire" || c.kind === "twisted";
            const cls = sel.has(c.id) ? "sel" : hl.conductors.has(c.id) ? "hl" : "";
            return (
              <tr key={c.id} className={cls} onClick={(e) => select([c.id], e.shiftKey || e.metaKey || e.ctrlKey ? "toggle" : "replace")}>
                <td className="mono"><b>{r.id}</b></td>
                <td>{r.from}</td>
                <td className="hint-text">{r.fromSignal}</td>
                <td>{r.to}</td>
                <td className="hint-text">{r.toSignal}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="cell-swatch" style={{ background: colorHex(c.color), boxShadow: c.stripeColor ? `inset 0 -4px 0 ${colorHex(c.stripeColor)}` : undefined }} />
                    {c.kind === "shield" ? "Shield" : (
                      <select className="select" style={{ width: 110 }} value={c.color} disabled={!!c.partId || c.kind === "core"} title={c.partId ? "Colour comes from the assigned part" : c.kind === "core" ? "Core colour comes from the cable" : ""}
                        onChange={(e) => update((d) => { const w = findConductor(d, c.id); if (w) w.color = e.target.value; })}>
                        {PART_COLORS.map((col) => <option key={col}>{col}</option>)}
                      </select>
                    )}
                    {r.color.includes("/") && <span className="hint-text">{r.color}</span>}
                  </span>
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  {isWire ? (
                    <select className="select" style={{ width: 150 }} value={c.partId ?? ""} onChange={(e) => update((d) => assignPart(d, c.id, e.target.value || undefined))}>
                      <option value="">— No Part —</option>
                      {h.wireParts.map((p) => <option key={p.id} value={p.id}>{partName(p)}</option>)}
                    </select>
                  ) : r.part}
                </td>
                <td>{r.gauge}</td>
                <td className="num">{r.length}</td>
                <td>{r.twistedWith}</td>
                <td>{r.cable}</td>
                <td>{r.status.map((s) => <span key={s} className={`badge ${s === "NO ROUTE" ? "error" : s === "No Part" || s === "Open" ? "warning" : "info"}`} style={{ marginRight: 4 }}>{s}</span>)}</td>
              </tr>
            );
          })}
          {!shown.length && <tr><td colSpan={12} style={{ textAlign: "center", padding: 30, color: "#94a3b8" }}>{rows.length ? "No connections match the filter." : "No wires yet. Draw some in the Schematic view."}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
