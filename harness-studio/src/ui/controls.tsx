import { type ReactNode, useEffect, useState } from "react";
import { colorHex } from "../model/colors";
import type { Gauge, GaugeUnit, Length, LengthUnit, PartBase } from "../model/types";
import { PART_COLORS } from "../model/types";
import { LengthParseError, formatGauge, parseGauge, parseLengthExpression } from "../model/units";
import { partName } from "../model/validation";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field"><label>{label}</label><div>{children}</div></div>;
}

/** A text input that commits on blur or Enter rather than on every keystroke. */
export function TextInput({ value, onCommit, placeholder, multiline, className }: { value: string | undefined; onCommit: (v: string) => void; placeholder?: string; multiline?: boolean; className?: string }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  const commit = () => { if (v !== (value ?? "")) onCommit(v); };
  if (multiline) return <textarea className={`input ${className ?? ""}`} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} />;
  return (
    <input className={`input ${className ?? ""}`} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") { setV(value ?? ""); } }} />
  );
}

export function NumberInput({ value, onCommit, placeholder, step }: { value: number | undefined; onCommit: (v: number | undefined) => void; placeholder?: string; step?: number }) {
  const [v, setV] = useState(value === undefined ? "" : String(value));
  useEffect(() => setV(value === undefined ? "" : String(value)), [value]);
  const commit = () => {
    const n = v.trim() === "" ? undefined : Number(v);
    if (n !== undefined && !Number.isFinite(n)) { setV(value === undefined ? "" : String(value)); return; }
    if (n !== value) onCommit(n);
  };
  return <input className="input" type="number" step={step ?? "any"} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

export function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = (n: number) => { const c = Math.max(min, Math.min(max, Math.round(n))); if (c !== value) onChange(c); else setV(String(value)); };
  return (
    <span className="stepper">
      <button onClick={() => commit(value - 1)} disabled={value <= min}>−</button>
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => commit(Number(v) || min)} onKeyDown={(e) => e.key === "Enter" && commit(Number(v) || min)} />
      <button onClick={() => commit(value + 1)} disabled={value >= max}>+</button>
    </span>
  );
}

export function ColorSelect({ value, onChange, allowNone }: { value: string | undefined; onChange: (c: string | undefined) => void; allowNone?: boolean }) {
  return (
    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span className="cell-swatch" style={{ background: value ? colorHex(value) : "transparent", width: 18, height: 18 }} />
      <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
        {allowNone && <option value="">None</option>}
        {PART_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
        {value && !(PART_COLORS as readonly string[]).includes(value) && <option value={value}>{value}</option>}
      </select>
    </span>
  );
}

export function PartSelect({ parts, value, onChange, onCreate, placeholder = "No part" }: { parts: PartBase[]; value: string | undefined; onChange: (id: string | undefined) => void; onCreate?: () => void; placeholder?: string }) {
  return (
    <select className="select" value={value ?? ""} onChange={(e) => {
      if (e.target.value === "__new") onCreate?.();
      else onChange(e.target.value || undefined);
    }}>
      <option value="">{placeholder}</option>
      {parts.map((p) => (
        <option key={p.id} value={p.id}>{partName(p)}{p.internalPartNumber ? ` [${p.internalPartNumber}]` : ""}{p.manufacturer ? ` — ${p.manufacturer}` : ""}</option>
      ))}
      {onCreate && <option value="__new">+ Create new part…</option>}
    </select>
  );
}

/** Length field accepting calculations (`40 + 30 + 40`, `5' 3"`), showing the result while typing. */
export function LengthInput({ value, unit, onCommit, placeholder = "Not set" }: { value: Length | undefined; unit: LengthUnit; onCommit: (l: Length | undefined) => void; placeholder?: string }) {
  const show = (l?: Length) => (l ? `${l.value} ${l.unit}` : "");
  const [v, setV] = useState(show(value));
  useEffect(() => setV(show(value)), [value]);
  let preview: string | undefined;
  let error: string | undefined;
  let parsed: Length | undefined;
  if (v.trim()) {
    try { parsed = parseLengthExpression(v, unit); preview = `= ${parsed.value} ${parsed.unit}`; } catch (e) { error = e instanceof LengthParseError ? e.message : "Invalid length"; }
  }
  const commit = () => {
    if (!v.trim()) { if (value) onCommit(undefined); return; }
    if (parsed && (parsed.value !== value?.value || parsed.unit !== value?.unit)) onCommit(parsed);
  };
  const isPlain = parsed && v.trim() === show(parsed);
  return (
    <div>
      <input className={`input${error ? " invalid" : ""}`} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); } }} />
      {preview && !isPlain && <div className="preview">{preview}</div>}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

export function GaugeInput({ value, unit, onCommit }: { value: Gauge | undefined; unit: GaugeUnit; onCommit: (g: Gauge | undefined) => void }) {
  const show = (g?: Gauge) => (g ? formatGauge(g) : "");
  const [v, setV] = useState(show(value));
  useEffect(() => setV(show(value)), [value]);
  const parsed = v.trim() ? parseGauge(v, unit) : undefined;
  const commit = () => {
    if (!v.trim()) { if (value) onCommit(undefined); return; }
    if (parsed) onCommit(parsed); else setV(show(value));
  };
  return <input className={`input${v.trim() && !parsed ? " invalid" : ""}`} value={v} placeholder={unit === "AWG" ? "e.g. 18 AWG" : "e.g. 0.75 mm²"} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <header><h2>{title}</h2><button className="btn small" onClick={onClose}>✕</button></header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}
