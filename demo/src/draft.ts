import { createCriteria, emptyChoices, questions, validChoices, type Choices, type QuestionId } from "./model.js";
import type { DemoData } from "./types.js";

export interface Draft {
  choices: Choices;
  edits: Record<string, string>;
  approvedBy: string | null;
}
const IDS = ["AC-01", "AC-02", "AC-03"];
export const newDraft = (): Draft => ({ choices: emptyChoices(), edits: {}, approvedBy: null });
export const criteriaFor = (draft: Draft) => createCriteria(draft.choices).map((c) => ({ ...c, text: draft.edits[c.id] ?? c.text }));
export function changeChoice(draft: Draft, id: QuestionId, value: string | null): Draft {
  const choices = { ...draft.choices, [id]: value };
  if (!validChoices(choices)) throw new Error("Invalid decision");
  if (draft.choices[id] === value) return draft;
  return { choices, edits: {}, approvedBy: null };
}
export function editCriterion(draft: Draft, id: string, text: string): Draft {
  if (!IDS.includes(id) || text.length > 2000) throw new Error("Invalid criterion edit");
  return { ...draft, edits: { ...draft.edits, [id]: text }, approvedBy: null };
}
export function approve(draft: Draft, reviewer: string, acknowledged: boolean): Draft {
  if (!acknowledged || !reviewer.trim() || reviewer.trim().length > 60) throw new Error("Add a reviewer name and acknowledge the review limitations.");
  if (criteriaFor(draft).some((c) => !c.text.trim())) throw new Error("Every criterion needs text before approval.");
  return { ...draft, approvedBy: reviewer.trim() };
}
export function serializeDraft(draft: Draft, commit: string): string {
  // Approval and reviewer names are intentionally not persisted. Reloading requires a fresh review.
  return JSON.stringify({ version: 1, commit, choices: draft.choices, edits: draft.edits });
}
export function restoreDraft(raw: string, commit: string): Draft | null {
  try {
    if (raw.length > 30_000) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const d = value as Record<string, unknown>;
    if (d.version !== 1 || d.commit !== commit || !validChoices(d.choices) || !d.edits || typeof d.edits !== "object" || Array.isArray(d.edits)) return null;
    const edits = d.edits as Record<string, unknown>;
    if (!Object.entries(edits).every(([id, text]) => IDS.includes(id) && typeof text === "string" && text.length <= 2000)) return null;
    return { choices: d.choices, edits: edits as Record<string, string>, approvedBy: null };
  } catch { return null; }
}
const md = (text: string) => text.replace(/([\\`*_{}[\]<>#])/g, "\\$1");
export function exportDraft(draft: Draft, data: DemoData, format: "markdown" | "json" | "issue"): string {
  if (!draft.approvedBy) throw new Error("Review and approve the current draft before export.");
  const criteria = criteriaFor(draft);
  if (criteria.some((c) => !c.text.trim())) throw new Error("A criterion is empty.");
  const decisions = questions.map((q) => ({ question: q.title, answer: q.options.find((o) => o.id === draft.choices[q.id])?.label ?? null }));
  const content = { kind: "scripted-demo", notice: "Browser-only deterministic template. Not model output. Human review does not establish behavioral correctness.", ticket: data.ticket, commit: data.commit, reviewedBy: draft.approvedBy, decisions, criteria, evidence: data.evidence, nonGoals: ["Implementing or executing the proposed change", "Background retry and digest scheduling changes"], assumption: "This demo focuses on the immediate notification dispatch path; retry queues and digests need separate investigation." };
  if (format === "json") return JSON.stringify(content, null, 2);
  return [
    "# Notification pause — implementation brief", "", "> SCRIPTED DEMO — deterministic template, not model output. Review does not prove behavioral correctness.", "",
    `Ticket: ${md(data.ticket)}`, `Source commit: ${data.commit}`, `Reviewed by: ${md(draft.approvedBy)}`, "",
    "## Decisions and open questions", ...decisions.map((d) => `- ${md(d.question)} **${md(d.answer ?? "UNRESOLVED")}**`), "",
    "## Proposed acceptance criteria", ...criteria.flatMap((c) => [`${format === "issue" ? "- [ ]" : "-"} **${c.id}** ${md(c.text)}`, `  - Proposed test: ${md(c.test)}`, `  - Evidence: ${c.evidenceId}${c.blockedBy.length ? `; blocked by: ${c.blockedBy.join(", ")}` : ""}`]), "",
    "## Observed fixture excerpts", ...data.evidence.map((e) => `- **${e.id}**: ${md(e.label)}. [${e.path}:${e.startLine}–${e.endLine}](${e.sourceUrl}) · SHA-256: ${e.sha256}`), "",
    "## Assumption / non-goals", content.assumption, "No code has been implemented or tested by this demo. Generated test descriptions are proposals, not executed tests.", "",
  ].join("\n");
}
