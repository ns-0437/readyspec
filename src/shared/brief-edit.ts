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
