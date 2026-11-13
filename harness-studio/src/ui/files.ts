export function downloadText(text: string, fileName: string, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0]);
    input.click();
  });
}

/** Serialises the visible canvas to a standalone SVG file, inlining the styles the drawing relies on. */
export function exportSvg(svg: SVGSVGElement, fileName: string) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(".handle, .wire-hit, .lp").forEach((n) => n.remove());
  const bg = clone.querySelector("rect.bg");
  bg?.setAttribute("fill", "#ffffff");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = ".svg-label{font:11px Inter,Arial,sans-serif;fill:#0f172a}.svg-muted{font:10px Inter,Arial,sans-serif;fill:#64748b}text{font-family:Inter,Arial,sans-serif}";
  clone.insertBefore(style, clone.firstChild);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  downloadText(new XMLSerializer().serializeToString(clone), fileName, "image/svg+xml");
}
