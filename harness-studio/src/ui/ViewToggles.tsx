import { type ViewOptions, useStore } from "../store";

const ITEMS: { key: keyof ViewOptions; label: string; title: string; views: string[] }[] = [
  { key: "showIds", label: "IDs", title: "Show component IDs (I)", views: ["schematic", "layout"] },
  { key: "showWarnings", label: "Warnings", title: "Show warnings", views: ["schematic", "layout"] },
  { key: "highlightNets", label: "Nets", title: "Highlight whole nets", views: ["schematic", "layout"] },
  { key: "dashUnrouted", label: "Dash unrouted", title: "Dash wires with no route through bundles", views: ["schematic"] },
  { key: "showParts", label: "Parts", title: "Show part numbers", views: ["layout"] },
  { key: "showInline", label: "Inline", title: "Show splices, diodes and resistors", views: ["layout"] },
];

export function ViewToggles({ view }: { view: "schematic" | "layout" }) {
  const options = useStore((s) => s.options);
  const setOption = useStore((s) => s.setOption);
  return (
    <div className="view-toggles">
      {ITEMS.filter((i) => i.views.includes(view)).map((i) => (
        <button key={i.key} title={i.title} className={options[i.key] ? "on" : ""} onClick={() => setOption(i.key, !options[i.key])}>{i.label}</button>
      ))}
    </div>
  );
}
