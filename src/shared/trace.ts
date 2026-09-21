import type { Brief, BriefContent, Decision, EvidenceItem } from "./schemas";

export interface CriterionTrace {
  criterionId: string;
  evidence: EvidenceItem[];
  components: BriefContent["components"];
  tests: BriefContent["tests"];
  steps: BriefContent["steps"];
  decisions: Pick<Decision, "questionId" | "question" | "answer" | "source">[];
  openQuestions: BriefContent["openQuestions"];
  risks: BriefContent["risks"];
}

/**
 * Everything connected to one acceptance criterion: the code evidence it builds on, the
 * components it touches, its proposed tests, the steps that deliver it, the human decisions it
 * relies on and the questions still open. Pure; used by the UI inspector and the exports.
 */
export function traceCriterion(brief: Brief | BriefContent, evidence: EvidenceItem[], criterionId: string): CriterionTrace | null {
  const c = brief.acceptanceCriteria.find((x) => x.id === criterionId);
  if (!c) return null;
  const evById = new Map(evidence.map((e) => [e.id, e]));
  const components = brief.components.filter((k) => c.componentIds.includes(k.id));
  const evidenceIds = new Set([...c.evidenceIds, ...components.flatMap((k) => k.evidenceIds)]);
  return {
    criterionId,
    evidence: [...evidenceIds].map((id) => evById.get(id)).filter((e): e is EvidenceItem => !!e),
    components,
    tests: brief.tests.filter((t) => c.testIds.includes(t.id) || t.criterionIds.includes(c.id)),
    steps: brief.steps.filter((s) => s.criterionIds.includes(c.id)),
    decisions: brief.decisions.filter((d) => c.decisionRefs.includes(d.questionId)),
    openQuestions: brief.openQuestions.filter((q) => c.dependsOnOpen.includes(q.id)),
    risks: brief.risks.filter((r) => r.evidenceIds.some((id) => c.evidenceIds.includes(id))),
  };
}
