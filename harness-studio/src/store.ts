import { produce } from "immer";
import { create } from "zustand";
import { harnessToText, parseHarness } from "./model/io";
import { type Harness, emptyHarness } from "./model/types";
import { demoHarness } from "./samples/demo";

export type View = "schematic" | "layout" | "connections" | "parts";

export interface ViewOptions {
  showIds: boolean;
  showWarnings: boolean;
  highlightNets: boolean;
  showParts: boolean;
  showInline: boolean;
  dashUnrouted: boolean;
}

interface State {
  h: Harness;
  past: Harness[];
  future: Harness[];
  fileName: string;
  view: View;
  selection: string[];
  options: ViewOptions;
  toast?: string;
  update: (fn: (h: Harness) => void) => void;
  replace: (h: Harness, fileName?: string) => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[], mode?: "replace" | "toggle" | "add") => void;
  setView: (v: View) => void;
  setOption: <K extends keyof ViewOptions>(k: K, v: ViewOptions[K]) => void;
  notify: (msg: string) => void;
}

const STORAGE_KEY = "harness-studio:document";
const MAX_HISTORY = 200;

function loadInitial(): { h: Harness; fileName: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const { text, fileName } = JSON.parse(raw);
      return { h: parseHarness(text), fileName: fileName ?? "Untitled.harness" };
    }
  } catch { /* fall through to demo */ }
  return { h: demoHarness(), fileName: "Demo Harness.harness" };
}

const initial = typeof localStorage === "undefined" ? { h: emptyHarness(), fileName: "Untitled.harness" } : loadInitial();

export const useStore = create<State>((set, get) => ({
  h: initial.h,
  past: [],
  future: [],
  fileName: initial.fileName,
  view: "schematic",
  selection: [],
  options: { showIds: true, showWarnings: true, highlightNets: true, showParts: false, showInline: true, dashUnrouted: true },
  update: (fn) => {
    const { h, past } = get();
    if (h.readOnly) { get().notify("This harness is read-only (Settings → Read-only)"); return; }
    const next = produce(h, fn);
    if (next === h) return;
    set({ h: next, past: [...past.slice(-MAX_HISTORY + 1), h], future: [] });
  },
  replace: (h, fileName) => set({ h, past: [], future: [], selection: [], ...(fileName ? { fileName } : {}) }),
  undo: () => {
    const { past, h, future } = get();
    if (!past.length) return;
    set({ h: past[past.length - 1], past: past.slice(0, -1), future: [h, ...future] });
  },
  redo: () => {
    const { past, h, future } = get();
    if (!future.length) return;
    set({ h: future[0], past: [...past, h], future: future.slice(1) });
  },
  select: (ids, mode = "replace") => {
    const cur = get().selection;
    if (mode === "replace") set({ selection: ids });
    else if (mode === "add") set({ selection: [...new Set([...cur, ...ids])] });
    else {
      const s = new Set(cur);
      for (const id of ids) s.has(id) ? s.delete(id) : s.add(id);
      set({ selection: [...s] });
    }
  },
  setView: (view) => set({ view }),
  setOption: (k, v) => set({ options: { ...get().options, [k]: v } }),
  notify: (msg) => {
    set({ toast: msg });
    setTimeout(() => { if (get().toast === msg) set({ toast: undefined }); }, 2600);
  },
}));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((s, prev) => {
  if (s.h === prev.h && s.fileName === prev.fileName) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ text: harnessToText(s.h), fileName: s.fileName })); } catch { /* storage full or disabled */ }
  }, 300);
});
