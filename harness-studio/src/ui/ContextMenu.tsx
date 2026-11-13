import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { colorHex } from "../model/colors";
import { PART_COLORS } from "../model/types";

export type MenuItem =
  | { label: string; onClick?: () => void; kbd?: string; danger?: boolean; disabled?: boolean; children?: MenuItem[] }
  | { separator: true }
  | { heading: string }
  | { colors: (c: string | undefined) => void; selected?: string; allowNone?: boolean }
  | { custom: ReactNode };

interface MenuState { x: number; y: number; items: MenuItem[] | null; open: (x: number, y: number, items: MenuItem[]) => void; close: () => void }

export const useMenu = create<MenuState>((set) => ({
  x: 0, y: 0, items: null,
  open: (x, y, items) => set({ x, y, items }),
  close: () => set({ items: null }),
}));

export function openMenu(e: { clientX: number; clientY: number }, items: MenuItem[]) {
  useMenu.getState().open(e.clientX, e.clientY, items.filter(Boolean));
}

export function ContextMenu() {
  const { x, y, items, close } = useMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y, items]);
  useEffect(() => {
    if (!items) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("pointerdown", down, true); window.removeEventListener("keydown", key); };
  }, [items, close]);
  if (!items) return null;
  return (
    <div ref={ref} className="ctx" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={items} close={close} />
    </div>
  );
}

export function MenuList({ items, close }: { items: MenuItem[]; close: () => void }) {
  return (
    <>
      {items.map((it, i) => {
        if ("separator" in it) return <div key={i} className="msep" />;
        if ("heading" in it) return <div key={i} className="mlabel">{it.heading}</div>;
        if ("custom" in it) return <div key={i}>{it.custom}</div>;
        if ("colors" in it) return <ColorGrid key={i} selected={it.selected} allowNone={it.allowNone} onPick={(c) => { it.colors(c); close(); }} />;
        return (
          <button
            key={i}
            className={`mi${it.danger ? " danger" : ""}`}
            disabled={it.disabled}
            onClick={() => { if (it.children) return; it.onClick?.(); close(); }}
          >
            <span>{it.label}</span>
            {it.kbd && <span className="kbd">{it.kbd}</span>}
            {it.children && <span className="kbd">▸</span>}
            {it.children && (
              <div className="submenu ctx" style={{ position: "absolute" }}>
                <MenuList items={it.children} close={close} />
              </div>
            )}
          </button>
        );
      })}
    </>
  );
}

export function ColorGrid({ selected, onPick, allowNone }: { selected?: string; onPick: (c: string | undefined) => void; allowNone?: boolean }) {
  return (
    <div className="color-grid">
      {allowNone && (
        <button className={`swatch${!selected ? " sel" : ""}`} title="None" onClick={() => onPick(undefined)}
          style={{ background: "linear-gradient(135deg,#fff 45%,#dc2626 45%,#dc2626 55%,#fff 55%)" }} />
      )}
      {PART_COLORS.map((c) => (
        <button key={c} className={`swatch${selected === c ? " sel" : ""}`} title={c} onClick={() => onPick(c)}
          style={{ background: c === "Shield" ? "repeating-linear-gradient(45deg,#9ca3af 0 3px,#e5e7eb 3px 6px)" : colorHex(c) }} />
      ))}
    </div>
  );
}
