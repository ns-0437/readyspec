import type { BriefContent } from "./schemas";

/** Pure helpers for editing a brief draft in the UI. No I/O, no React. */

export type ListKey = "existingBehavior" | "acceptanceCriteria" | "components" | "steps" | "tests" | "risks" | "assumptions" | "openQuestions";

/** Field that holds the editable text for each list. */
export const TEXT_FIELD: Record<ListKey, string> = {
  existingBehavior: "statement",
  acceptanceCriteria: "text",
  components: "role",
  steps: "text",
  tests: "description",
  risks: "text",
  assumptions: "text",
  openQuestions: "text",
};

export function setItemText(brief: BriefContent, key: ListKey, id: string, value: string): BriefContent {
  const field = TEXT_FIELD[key];
  return { ...brief, [key]: (brief[key] as { id: string }[]).map((x) => (x.id === id ? { ...x, [field]: value } : x)) } as BriefContent;
}

const without = (ids: string[], id: string) => ids.filter((x) => x !== id);

/**
 * Remove an item and every reference to it, so the draft stays structurally valid and any
 * resulting gap (for example a criterion left without a test) is surfaced by verification
 * rather than hidden by a dangling id.
 */
export function removeItem(brief: BriefContent, key: ListKey, id: string): BriefContent {
  const next: BriefContent = { ...brief, [key]: (brief[key] as { id: string }[]).filter((x) => x.id !== id) } as BriefContent;
  switch (key) {
    case "components":
      next.acceptanceCriteria = next.acceptanceCriteria.map((c) => ({ ...c, componentIds: without(c.componentIds, id) }));
      next.steps = next.steps.map((s) => ({ ...s, componentIds: without(s.componentIds, id) }));
      break;
    case "tests":
      next.acceptanceCriteria = next.acceptanceCriteria.map((c) => ({ ...c, testIds: without(c.testIds, id) }));
      break;
    case "acceptanceCriteria":
      next.tests = next.tests.map((t) => ({ ...t, criterionIds: without(t.criterionIds, id) }));
      next.steps = next.steps.map((s) => ({ ...s, criterionIds: without(s.criterionIds, id) }));
      break;
    case "openQuestions":
      next.acceptanceCriteria = next.acceptanceCriteria.map((c) => ({ ...c, dependsOnOpen: without(c.dependsOnOpen, id) }));
      break;
    default:
      break;
  }
  return next;
}

export function setScopeItem(brief: BriefContent, side: "inScope" | "outOfScope", index: number, value: string): BriefContent {
  return { ...brief, scope: { ...brief.scope, [side]: brief.scope[side].map((s, i) => (i === index ? value : s)) } };
}

export function removeScopeItem(brief: BriefContent, side: "inScope" | "outOfScope", index: number): BriefContent {
  return { ...brief, scope: { ...brief.scope, [side]: brief.scope[side].filter((_, i) => i !== index) } };
}

/** The editable portion of a Brief (drops status, approval, revision, producedBy). */
export function contentOf(brief: BriefContent & Record<string, unknown>): BriefContent {
  const { title, requestedOutcome, scope, existingBehavior, decisions, openQuestions, acceptanceCriteria, components, steps, tests, risks, assumptions } = brief;
  return { title, requestedOutcome, scope, existingBehavior, decisions, openQuestions, acceptanceCriteria, components, steps, tests, risks, assumptions };
}

const LIST_KEYS: ListKey[] = ["existingBehavior", "acceptanceCriteria", "components", "steps", "tests", "risks", "assumptions", "openQuestions"];

const LIST_LABEL: Record<ListKey, [one: string, many: string]> = {
  existingBehavior: ["existing-behavior item", "existing-behavior items"],
  acceptanceCriteria: ["acceptance criterion", "acceptance criteria"],
  components: ["component", "components"],
  steps: ["step", "steps"],
  tests: ["test", "tests"],
  risks: ["risk", "risks"],
  assumptions: ["assumption", "assumptions"],
  openQuestions: ["open question", "open questions"],
};

/**
 * A short, human-readable summary of what changed between two brief drafts -- not a full diff,
 * just enough to answer "did I mean to do that?" before saving over an unsaved-edits warning.
 * Compares each list by id (added / removed / edited in place, where "edited" catches any field
 * change on a surviving item, not just its text) and flags scope/title/outcome text changes.
 */
export function summarizeChanges(before: BriefContent, after: BriefContent): string[] {
  const notes: string[] = [];
  if (before.title !== after.title) notes.push("title edited");
  if (before.requestedOutcome !== after.requestedOutcome) notes.push("requested outcome edited");
  for (const side of ["inScope", "outOfScope"] as const) {
    if (JSON.stringify(before.scope[side]) !== JSON.stringify(after.scope[side])) notes.push(`${side === "inScope" ? "in-scope" : "out-of-scope"} list changed`);
  }
  for (const key of LIST_KEYS) {
    const beforeItems = before[key] as { id: string }[];
    const afterItems = after[key] as { id: string }[];
    const beforeById = new Map(beforeItems.map((x) => [x.id, x]));
    const afterIds = new Set(afterItems.map((x) => x.id));
    const added = afterItems.filter((x) => !beforeById.has(x.id)).length;
    const removed = beforeItems.filter((x) => !afterIds.has(x.id)).length;
    const edited = afterItems.filter((x) => beforeById.has(x.id) && JSON.stringify(beforeById.get(x.id)) !== JSON.stringify(x)).length;
    const [one, many] = LIST_LABEL[key];
    if (added) notes.push(`${added} ${added === 1 ? one : many} added`);
    if (removed) notes.push(`${removed} ${removed === 1 ? one : many} removed`);
    if (edited) notes.push(`${edited} ${edited === 1 ? one : many} edited`);
  }
  return notes;
}
