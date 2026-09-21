import type {
  BriefContent,
  Decision,
  EvidenceItem,
  Question,
  SupportResult,
  VerificationIssue,
  VerificationReport,
} from "@/shared/schemas";
import { verifyEvidenceRef } from "@/server/repository/evidence";
import type { Snapshot } from "@/server/repository/types";
import { assessSupport } from "./support";

export interface VerifyInput {
  brief: BriefContent;
  revision: number;
  evidence: EvidenceItem[];
  snapshot: Snapshot;
  questions: Question[];
  decisions: Decision[];
  /** Model-judge results to merge in (supplementary; never gates approval). */
  modelSupport?: SupportResult[];
}

const PROPOSAL_LANGUAGE = /\b(should|will be|needs? to|must be|to be added|add a|we should|propose|recommend)\b/i;

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const id of ids) (seen.has(id) ? out : seen).add(id);
  return [...out];
}

/**
 * Deterministic verification (no model). Checks that citations resolve in the pinned snapshot,
 * that cited code mentions what claims mention, that every criterion connects to a test and a
 * component, and that deferred decisions were not silently resolved.
 */
export function verifyBrief(input: VerifyInput): VerificationReport {
  const { brief, evidence, snapshot } = input;
  const issues: VerificationIssue[] = [];
  const err = (code: string, message: string, itemId: string | null = null) => issues.push({ severity: "error", code, message, itemId });
  const warn = (code: string, message: string, itemId: string | null = null) => issues.push({ severity: "warning", code, message, itemId });

  const evById = new Map(evidence.map((e) => [e.id, e]));

  /* ---- citations ---- */
  const cited = new Set<string>();
  const collect = (ids: string[]) => ids.forEach((i) => cited.add(i));
  brief.existingBehavior.forEach((o) => collect(o.evidenceIds));
  brief.acceptanceCriteria.forEach((c) => collect(c.evidenceIds));
  brief.components.forEach((c) => collect(c.evidenceIds));
  brief.risks.forEach((r) => collect(r.evidenceIds));
  const invalid: { evidenceId: string; reason: string }[] = [];
  let valid = 0;
  for (const id of cited) {
    const item = evById.get(id);
    if (!item) {
      invalid.push({ evidenceId: id, reason: "unknown evidence id (not in this session's evidence set)" });
      err("unknown-evidence-id", `Cited evidence ${id} does not exist in this session.`, id);
      continue;
    }
    const check = verifyEvidenceRef(snapshot, item);
    if (check.ok) valid++;
    else {
      invalid.push({ evidenceId: id, reason: check.reason });
      err("invalid-citation", `Evidence ${id} (${item.path}:${item.startLine}-${item.endLine}) is invalid: ${check.reason}.`, id);
    }
  }

  /* ---- ids ---- */
  const idGroups: [string, string[]][] = [
    ["observation", brief.existingBehavior.map((o) => o.id)],
    ["criterion", brief.acceptanceCriteria.map((c) => c.id)],
    ["component", brief.components.map((c) => c.id)],
    ["step", brief.steps.map((s) => s.id)],
    ["test", brief.tests.map((t) => t.id)],
    ["risk", brief.risks.map((r) => r.id)],
    ["assumption", brief.assumptions.map((a) => a.id)],
    ["open question", brief.openQuestions.map((q) => q.id)],
  ];
  for (const [label, ids] of idGroups) for (const d of dupes(ids)) err("duplicate-id", `Duplicate ${label} id ${d}.`, d);

  const componentIds = new Set(brief.components.map((c) => c.id));
  const testIds = new Set(brief.tests.map((t) => t.id));
  const criterionIds = new Set(brief.acceptanceCriteria.map((c) => c.id));
  const openIds = new Set(brief.openQuestions.map((q) => q.id));

  /* ---- observed claims ---- */
  for (const o of brief.existingBehavior) {
    if (o.evidenceIds.length === 0) err("observed-without-evidence", `Observed statement ${o.id} cites no evidence; it must be evidence-backed or reclassified as unresolved/assumed.`, o.id);
    if (PROPOSAL_LANGUAGE.test(o.statement)) warn("observed-sounds-proposed", `Observed statement ${o.id} reads like a proposal; keep observations to what the code does today.`, o.id);
  }

  /* ---- criteria ---- */
  let criteriaWithTest = 0;
  for (const c of brief.acceptanceCriteria) {
    const goodTests = c.testIds.filter((t) => testIds.has(t));
    if (goodTests.length > 0) criteriaWithTest++;
    else err("criterion-without-test", `Criterion ${c.id} has no proposed test.`, c.id);
    for (const t of c.testIds) if (!testIds.has(t)) err("dangling-reference", `Criterion ${c.id} references unknown test ${t}.`, c.id);
    for (const k of c.componentIds) if (!componentIds.has(k)) err("dangling-reference", `Criterion ${c.id} references unknown component ${k}.`, c.id);
    for (const o of c.dependsOnOpen) if (!openIds.has(o)) err("dangling-reference", `Criterion ${c.id} depends on unknown open question ${o}.`, c.id);
    if (c.componentIds.length === 0) warn("criterion-without-component", `Criterion ${c.id} names no affected component.`, c.id);
    if (c.evidenceIds.length === 0) warn("criterion-without-evidence", `Criterion ${c.id} is not tied to any existing code (fine for a wholly new behavior, but confirm).`, c.id);
    for (const q of c.decisionRefs) {
      if (!input.decisions.some((d) => d.questionId === q && d.source !== "deferred")) warn("decision-ref-unrecorded", `Criterion ${c.id} relies on question ${q}, which has no recorded answer.`, c.id);
    }
  }
  for (const t of brief.tests) {
    for (const k of t.criterionIds) if (!criterionIds.has(k)) err("dangling-reference", `Test ${t.id} references unknown criterion ${k}.`, t.id);
    for (const k of t.criterionIds) {
      const crit = brief.acceptanceCriteria.find((c) => c.id === k);
      if (crit && !crit.testIds.includes(t.id)) warn("test-link-mismatch", `Test ${t.id} lists criterion ${k}, but ${k} does not list ${t.id}.`, t.id);
    }
  }

  /* ---- components and steps ---- */
  for (const c of brief.components) {
    if (c.change !== "add" && !snapshot.files.has(c.path)) err("component-path-missing", `Component ${c.id} ${c.path} is marked '${c.change}' but does not exist in the snapshot.`, c.id);
  }
  let stepsLinked = 0;
  const stepCovered = new Set<string>();
  for (const s of brief.steps) {
    const okCriteria = s.criterionIds.filter((k) => criterionIds.has(k));
    if (okCriteria.length > 0) stepsLinked++;
    else warn("step-unlinked", `Step ${s.id} is not linked to any acceptance criterion.`, s.id);
    okCriteria.forEach((k) => stepCovered.add(k));
    for (const k of s.componentIds) if (!componentIds.has(k)) err("dangling-reference", `Step ${s.id} references unknown component ${k}.`, s.id);
    for (const k of s.criterionIds) if (!criterionIds.has(k)) err("dangling-reference", `Step ${s.id} references unknown criterion ${k}.`, s.id);
  }
  for (const c of brief.acceptanceCriteria) if (!stepCovered.has(c.id)) warn("criterion-without-step", `Criterion ${c.id} is not covered by any implementation step.`, c.id);

  /* ---- decisions: nothing invented, nothing silently resolved ---- */
  const recorded = new Map(input.decisions.map((d) => [d.questionId, d]));
  const openQuestionIds = new Set(brief.openQuestions.map((q) => q.questionId).filter((q): q is string => !!q));
  for (const bd of brief.decisions) {
    const rec = recorded.get(bd.questionId);
    if (!rec) err("decision-not-recorded", `Brief decision for ${bd.questionId} has no matching recorded human answer.`, bd.questionId);
    else if (rec.source === "deferred") err("deferred-as-decision", `Question ${bd.questionId} was deferred but appears as a decision.`, bd.questionId);
    else if (rec.answer.trim() !== bd.answer.trim()) err("decision-mismatch", `Brief decision for ${bd.questionId} differs from the answer the human recorded.`, bd.questionId);
  }
  for (const q of input.questions) {
    const rec = recorded.get(q.id);
    const resolved = rec && rec.source !== "deferred" && rec.answer.trim() !== "";
    if (!resolved && !openQuestionIds.has(q.id)) err("unresolved-dropped", `Question ${q.id} was never answered but is missing from open questions.`, q.id);
  }

  /* ---- claim support (lexical, deterministic) ---- */
  const support: SupportResult[] = [];
  const supportOf = (itemId: string, itemType: SupportResult["itemType"], statement: string, ids: string[]) => {
    const a = assessSupport(statement, ids.map((i) => evById.get(i)).filter((e): e is EvidenceItem => !!e));
    support.push({ itemId, itemType, verdict: a.verdict, method: "lexical", detail: a.detail });
    return a;
  };
  for (const o of brief.existingBehavior) {
    const a = supportOf(o.id, "observation", o.statement, o.evidenceIds);
    if (a.verdict === "unsupported") err("unsupported-claim", `Observed statement ${o.id} mentions things the cited code does not contain (${a.missing.join(", ")}).`, o.id);
    else if (a.verdict === "weak") warn("weak-support", `Observed statement ${o.id} is only partly supported by its citations.`, o.id);
  }
  for (const r of brief.risks) {
    if (r.evidenceIds.length === 0) continue;
    const a = supportOf(r.id, "risk", r.text, r.evidenceIds);
    if (a.verdict === "unsupported") warn("unsupported-risk", `Risk ${r.id} cites code that does not mention what it describes.`, r.id);
  }
  for (const c of brief.acceptanceCriteria) {
    if (c.evidenceIds.length === 0) continue;
    supportOf(c.id, "criterion", c.text, c.evidenceIds);
  }
  for (const m of input.modelSupport ?? []) {
    support.push(m);
    if (m.verdict === "unsupported") warn("model-judged-unsupported", `Model judge considers ${m.itemId} unsupported: ${m.detail}`, m.itemId);
  }

  return {
    snapshotId: snapshot.id,
    briefRevision: input.revision,
    generatedAt: new Date().toISOString(),
    citations: { checked: cited.size, valid, invalid },
    support,
    issues,
    coverage: {
      criteria: brief.acceptanceCriteria.length,
      criteriaWithTest,
      steps: brief.steps.length,
      stepsLinked,
    },
    passed: !issues.some((i) => i.severity === "error"),
  };
}
