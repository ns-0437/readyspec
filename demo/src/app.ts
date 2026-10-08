import type { DemoData } from "./types.js";

const app = document.querySelector<HTMLElement>("#app")!;
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
async function start() {
  const response = await fetch(new URL("./evidence.json", import.meta.url));
  if (!response.ok) throw new Error("Evidence could not be loaded");
  const data = await response.json() as DemoData;
  if (data.kind !== "scripted-demo" || data.version !== 1 || !Array.isArray(data.evidence)) throw new Error("Unsupported demo data");
  const panel = element("div", "evidence-layout");
  panel.id = "evidence-panel";
  const list = element("aside", "file-list");
  list.append(element("p", "eyebrow", "PUBLIC FIXTURE / 4 EXCERPTS"));
  for (const e of data.evidence) list.append(element("p", "file-row", e.path));
  const viewer = element("section", "code-viewer");
  const e = data.evidence[0]!;
  viewer.append(element("p", "code-title", e.path), element("h3", "observation", e.label));
  const pre = element("pre", "code");
  pre.textContent = e.text;
  viewer.append(pre, element("p", "code-note", "Observed: security is eligible before category preferences are checked. This does not guarantee successful delivery."));
  const link = element("a", "source-link", "Read this excerpt on GitHub ↗");
  link.href = e.sourceUrl;
  viewer.append(link);
  panel.append(list, viewer);
  app.replaceChildren(panel);
}
start().catch(() => {
  app.replaceChildren(element("p", "empty", "The demo assets could not load. Refresh to retry, or open the source repository above."));
});
