import type { DemoData, DemoEvidence } from "./types.js";
import { element, button } from "./dom.js";
import { questions, createCriteria } from "./model.js";
import { newDraft, changeChoice, criteriaFor, editCriterion, approve, serializeDraft, restoreDraft, exportDraft } from "./draft.js";

const app = document.querySelector<HTMLElement>("#app")!;
const steps = document.querySelector<HTMLElement>(".steps")!;
let draft = newDraft();
const STORAGE_KEY = "readyspec-static-demo-v1";
let notice = "";
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
  const updateCount = () => { summary.textContent = `${Object.values(draft.choices).filter(Boolean).length} of 3 decisions resolved · ${createCriteria(draft.choices).filter((c) => c.blockedBy.length).length} criteria still blocked`; };
  intro.append(element("p", "code-note", "Changing a decision resets edited criteria and clears review approval, keeping the proposed brief consistent with your answers."));
  questions.forEach((q, index) => {
    const field = element("fieldset", "question"); field.append(element("legend", "", `0${index + 1} / ${q.title}`), element("p", "code-note", q.why));
    const link = button("Inspect related evidence ↗", "text-button", () => { selectedEvidence = q.evidenceId; setStage(0); }); field.append(link);
    const options = element("div", "answer-options");
    [...q.options, { id: "", label: "Leave unresolved", detail: "Keep the question visible and its criterion blocked." }].forEach((o) => {
      const label = element("label", "answer-option"); const radio = element("input", ""); radio.type = "radio"; radio.name = q.id; radio.value = o.id; radio.checked = (draft.choices[q.id] ?? "") === o.id;
      radio.addEventListener("change", () => { draft = changeChoice(draft, q.id, o.id || null); updateCount(); });
      const copy = element("span", "", o.label); copy.append(element("small", "", o.detail)); label.append(radio, copy); options.append(label);
    });
    field.append(options); panel.append(field);
  });
  updateCount(); const footer = element("div", "panel-footer"); footer.append(summary, button("Review the brief →", "button primary", () => setStage(2))); panel.append(footer); return panel;
}
function briefPanel() {
  const panel = element("div", "decision-panel"); panel.append(heading("A plan shaped by your decisions."), element("p", "code-note", "Predefined demo template · proposed acceptance criteria · not model output"));
  const open = questions.filter((q) => !draft.choices[q.id]);
  if (open.length) panel.append(element("p", "open-note", `Unresolved: ${open.map((q) => q.title).join(" ")} These dependencies remain in exported briefs.`));
  panel.append(element("p", "code-note", "Assumed scope: immediate dispatch only. Retry queues and digests require separate investigation; no implementation or test execution occurs here."));
  const reviewStatus = element("p", "review-status"); reviewStatus.setAttribute("role", "status");
  const downloads = element("div", "export-actions");
  const updateReview = () => {
    reviewStatus.textContent = draft.approvedBy ? `Demo review recorded by ${draft.approvedBy}. Downloads are enabled.` : "Draft · review the current criteria before exporting.";
    downloads.querySelectorAll("button").forEach((b) => { b.disabled = !draft.approvedBy; });
  };
  criteriaFor(draft).forEach((criterion) => {
    const card = element("article", "criterion"); card.append(element("span", `tag${criterion.blockedBy.length ? " unresolved" : ""}`, criterion.blockedBy.length ? `${criterion.id} · unresolved dependencies` : `${criterion.id} · proposed`));
    const label = element("label", "edit-label", `${criterion.id} acceptance criterion`); label.htmlFor = `edit-${criterion.id}`;
    const edit = element("textarea", "criterion-edit"); edit.id = label.htmlFor; edit.value = criterion.text; edit.maxLength = 2000; edit.rows = 3;
    edit.addEventListener("input", () => { draft = editCriterion(draft, criterion.id, edit.value); updateReview(); });
    card.append(label, edit, element("p", "code-note", `Proposed test: ${criterion.test}`));
    card.append(button("Trace to source ↗", "text-button", () => { selectedEvidence = criterion.evidenceId; setStage(0); })); panel.append(card);
  });
  const review = element("section", "review-box"); review.append(element("h4", "", "Review before handoff"), element("p", "code-note", "Links and identifiers cannot prove behavioral correctness. This demo records your acknowledgement only; it does not run the full app's verifier."));
  const nameLabel = element("label", "edit-label", "Reviewer name or initials"); nameLabel.htmlFor = "reviewer";
  const name = element("input", "search"); name.id = "reviewer"; name.maxLength = 60; name.placeholder = "e.g. NK"; name.autocomplete = "off";
  const acknowledgeLabel = element("label", "acknowledge"); const acknowledge = element("input", ""); acknowledge.type = "checkbox";
  acknowledgeLabel.append(acknowledge, document.createTextNode("I reviewed this scripted brief, including unresolved decisions, and understand it does not prove correctness."));
  const approveButton = button("Record demo review", "button primary", () => {
    try { draft = approve(draft, name.value, acknowledge.checked); updateReview(); }
    catch (error) { reviewStatus.textContent = (error as Error).message; }
  });
  const invalidateReview = () => { draft = { ...draft, approvedBy: null }; updateReview(); };
  acknowledge.addEventListener("change", invalidateReview); name.addEventListener("input", invalidateReview);
  review.append(nameLabel, name, acknowledgeLabel, approveButton, reviewStatus);
  ([ ["Markdown", "markdown", "md"], ["JSON", "json", "json"], ["Issue checklist", "issue", "md"] ] as const).forEach(([label, format, extension]) => {
    downloads.append(button(`Download ${label} ↓`, "button", () => {
      try {
        const blob = new Blob([exportDraft(draft, data, format)], { type: format === "json" ? "application/json" : "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob); const link = element("a", ""); link.href = url; link.download = `readyspec-demo-${format}.${extension}`; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        reviewStatus.textContent = "Download requested. The exported brief is labelled as a scripted demo.";
      } catch (error) { reviewStatus.textContent = (error as Error).message; }
    }));
  });
  updateReview(); review.append(downloads); panel.append(review); return panel;
}
function render() {
  renderNav();
  const toolbar = element("div", "draft-toolbar");
  const status = element("p", "draft-notice", notice || "Decisions stay in this tab unless you save a draft on this device."); status.setAttribute("role", "status");
  const actions = element("div", "draft-actions");
  actions.append(button("Save on this device", "text-button", () => {
    try { localStorage.setItem(STORAGE_KEY, serializeDraft(draft, data.commit)); notice = "Draft saved on this device. Reviewer names and approval are not saved."; }
    catch { notice = "Browser storage is unavailable. You can still finish and download this brief."; }
    status.textContent = notice;
  }), button("Reset demo", "text-button", () => {
    if (!window.confirm("Clear this demo's answers, edits, and saved draft? Download a reviewed brief first if you want to keep it.")) return;
    draft = newDraft();
    try { localStorage.removeItem(STORAGE_KEY); notice = "Demo reset. Saved draft removed."; }
    catch { notice = "This tab was reset, but browser storage could not be cleared."; }
    setStage(0);
  }));
  toolbar.append(status, actions);
  app.replaceChildren(toolbar, stage === 0 ? evidencePanel() : stage === 1 ? decisionsPanel() : briefPanel());
}
async function start() {
  const response = await fetch(new URL("./evidence.json", import.meta.url));
  if (!response.ok) throw new Error("Evidence could not be loaded");
  data = await response.json() as DemoData;
  if (data.kind !== "scripted-demo" || data.version !== 1 || data.evidence.length !== 4) throw new Error("Unsupported demo data");
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const restored = restoreDraft(raw, data.commit);
      if (restored) { draft = restored; notice = "Saved draft restored. Review approval must be recorded again before export."; }
      else notice = "The saved draft is incompatible with this demo version. Started a fresh draft.";
    }
  } catch { notice = "Browser storage is unavailable. This demo still works in the current tab."; }
  render();
}
start().catch(() => { app.replaceChildren(element("p", "empty", "The demo assets could not load. Refresh to retry, or open the source repository above.")); });
