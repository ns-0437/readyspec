import type { DemoData, DemoEvidence } from "./types.js";
import { element, button } from "./dom.js";
import { questions, emptyChoices, createCriteria } from "./model.js";

const app = document.querySelector<HTMLElement>("#app")!;
const steps = document.querySelector<HTMLElement>(".steps")!;
const choices = emptyChoices();
let data: DemoData;
let stage = 0;
let selectedEvidence = "delivery";

function setStage(next: number) {
  stage = next;
  render();
  app.querySelector<HTMLElement>("h3")?.focus();
}
function heading(text: string) { const h = element("h3", "panel-title", text); h.tabIndex = -1; return h; }
function renderNav() {
  const labels = [["Find the evidence", "See what exists today"], ["Resolve the ambiguity", "Make the product decisions"], ["Review the brief", "Trace criteria to code"]];
  steps.replaceChildren();
  labels.forEach(([title, sub], i) => {
    const b = button("", `step${i === stage ? " active" : ""}`, () => setStage(i));
    if (stage === i) b.setAttribute("aria-current", "step");
    const copy = element("div", "", title); copy.append(element("small", "", sub));
    b.append(element("span", "", `0${i + 1}`), copy);
    steps.append(b);
  });
}
function source(e: DemoEvidence): HTMLElement {
  const viewer = element("section", "code-viewer");
  viewer.append(element("p", "code-title", `${e.path} : ${e.startLine}–${e.endLine}`), heading(e.label));
  const pre = element("pre", "code");
  pre.tabIndex = 0;
  pre.setAttribute("aria-label", `Source excerpt from ${e.path}`);
  e.text.split("\n").forEach((line, i) => {
    const row = element("span", "code-line");
    const number = element("span", "line-number", String(e.startLine + i)); number.setAttribute("aria-hidden", "true");
    row.append(number, document.createTextNode(line)); pre.append(row);
  });
  const link = element("a", "source-link", "View pinned source on GitHub ↗"); link.href = e.sourceUrl;
  const hash = element("details", "hash-details");
  hash.append(element("summary", "", "Inspect excerpt fingerprint"), element("p", "hash", `SHA-256 ${e.sha256}`), element("p", "code-note", `Source commit ${data.commit}. A matching hash identifies these lines; it does not verify the meaning of a claim.`));
  viewer.append(pre, link, hash);
  return viewer;
}
function evidencePanel() {
  const panel = element("div", "evidence-layout"); panel.id = "evidence-panel";
  const sidebar = element("aside", "file-list");
  sidebar.append(element("p", "eyebrow", "BUNDLED EVIDENCE / 4 EXCERPTS"));
  const label = element("label", "search-label", "Filter excerpts"); label.htmlFor = "evidence-search";
  const search = element("input", "search"); search.id = "evidence-search"; search.type = "search"; search.placeholder = "File, symbol, or phrase…";
  const list = element("div", "excerpt-list");
  const display = element("div", "evidence-display");
  const showSource = () => display.replaceChildren(source(data.evidence.find((e) => e.id === selectedEvidence)!));
  const drawList = () => {
    const query = search.value.trim().toLowerCase();
    const matches = data.evidence.filter((e) => `${e.path} ${e.text} ${e.label}`.toLowerCase().includes(query));
    list.replaceChildren();
    if (!matches.length) list.append(element("p", "code-note", "No matching excerpts. Try “security” or clear the filter."));
    matches.forEach((e) => {
      const b = button("", `file-button${e.id === selectedEvidence ? " selected" : ""}`, () => { selectedEvidence = e.id; showSource(); drawList(); list.querySelector<HTMLButtonElement>(".selected")?.focus(); });
      b.setAttribute("aria-pressed", String(e.id === selectedEvidence));
      b.append(element("span", "file-name", e.path.split("/").at(-1)), element("small", "", `L${e.startLine}–${e.endLine} · ${e.id === "tests" ? "test coverage" : "existing behavior"}`));
      list.append(b);
    });
  };
  search.addEventListener("input", drawList);
  sidebar.append(label, search, list, element("p", "sidebar-note", "Four curated excerpts, generated from the checked-in fixture at build time. This browser demo does not search your repository."));
  drawList(); showSource(); panel.append(sidebar, display);
  const wrap = element("div", ""); wrap.append(panel);
  const footer = element("div", "panel-footer");
  footer.append(element("p", "code-note", "The code shows the security exception. The ticket does not say whether to preserve it."), button("Resolve the ambiguity →", "button primary", () => setStage(1)));
  wrap.append(footer); return wrap;
}
function decisionsPanel() {
  const panel = element("div", "decision-panel");
  const intro = element("div", "panel-intro"); intro.append(heading("Three decisions the ticket leaves open."), element("p", "code-note", "Choose an answer or leave it unresolved. Each choice updates the proposed brief; this is deterministic demo logic, not generated advice."));
  panel.append(intro);
  const summary = element("p", "decision-count"); summary.setAttribute("role", "status");
  const updateCount = () => { summary.textContent = `${Object.values(choices).filter(Boolean).length} of 3 decisions resolved · ${createCriteria(choices).filter((c) => c.blockedBy.length).length} criteria still blocked`; };
  questions.forEach((q, index) => {
    const field = element("fieldset", "question"); field.append(element("legend", "", `0${index + 1} / ${q.title}`), element("p", "code-note", q.why));
    const link = button("Inspect related evidence ↗", "text-button", () => { selectedEvidence = q.evidenceId; setStage(0); }); field.append(link);
    const options = element("div", "answer-options");
    [...q.options, { id: "", label: "Leave unresolved", detail: "Keep the question visible and its criterion blocked." }].forEach((o) => {
      const label = element("label", "answer-option"); const radio = element("input", ""); radio.type = "radio"; radio.name = q.id; radio.value = o.id; radio.checked = (choices[q.id] ?? "") === o.id;
      radio.addEventListener("change", () => { choices[q.id] = o.id || null; updateCount(); });
      const copy = element("span", "", o.label); copy.append(element("small", "", o.detail)); label.append(radio, copy); options.append(label);
    });
    field.append(options); panel.append(field);
  });
  updateCount(); const footer = element("div", "panel-footer"); footer.append(summary, button("Review the brief →", "button primary", () => setStage(2))); panel.append(footer); return panel;
}
function briefPanel() {
  const panel = element("div", "decision-panel"); panel.append(heading("A plan shaped by your decisions."), element("p", "code-note", "Predefined demo template · proposed acceptance criteria · not model output"));
  createCriteria(choices).forEach((criterion) => {
    const card = element("article", "criterion"); card.append(element("span", `tag${criterion.blockedBy.length ? " unresolved" : ""}`, criterion.blockedBy.length ? `${criterion.id} · unresolved dependencies` : `${criterion.id} · proposed`), element("h4", "", criterion.text), element("p", "code-note", `Proposed test: ${criterion.test}`));
    card.append(button("Trace to source ↗", "text-button", () => { selectedEvidence = criterion.evidenceId; setStage(0); })); panel.append(card);
  });
  panel.append(element("p", "code-note", "Review and export controls are available in the full local application.")); return panel;
}
function render() { renderNav(); app.replaceChildren(stage === 0 ? evidencePanel() : stage === 1 ? decisionsPanel() : briefPanel()); }
async function start() {
  const response = await fetch(new URL("./evidence.json", import.meta.url));
  if (!response.ok) throw new Error("Evidence could not be loaded");
  data = await response.json() as DemoData;
  if (data.kind !== "scripted-demo" || data.version !== 1 || data.evidence.length !== 4) throw new Error("Unsupported demo data");
  render();
}
start().catch(() => { app.replaceChildren(element("p", "empty", "The demo assets could not load. Refresh to retry, or open the source repository above.")); });
