import type { BehaviorAnalysis, BriefContent, ClarificationOutput, SinglePromptOutput, SupportJudgeOutput } from "@/shared/schemas";
import type { AnalyzeContext, BriefContext, ClarifyContext, JudgeContext, SinglePromptContext } from "../contexts";

/**
 * Mechanical fallback for tickets/repositories without a hand-authored script. It restates which
 * symbols the retriever matched. It is intentionally plain: it exercises the pipeline and the
 * verifier, and must never be mistaken for model analysis.
 */
export function genericAnalysis(ctx: AnalyzeContext): BehaviorAnalysis {
  const code = ctx.evidence.filter((e) => e.symbol && e.language !== "Markdown").slice(0, 5);
  return {
    observations: code.map((e, i) => ({
      id: `obs-${i + 1}`,
      kind: "observed" as const,
      statement: `${e.symbol} is defined in ${e.path} (lines ${e.startLine}-${e.endLine}) and matched the ticket terms: ${e.matchedTerms.slice(0, 4).join(", ") || "n/a"}.`,
      evidenceIds: [e.id],
    })),
    contradictions: [],
    missingDecisions: [{ id: "md-1", topic: "Acceptance conditions", description: "The ticket does not state observable acceptance conditions.", evidenceIds: [] }],
    insufficientEvidence: ["Fixture provider: no semantic analysis was performed; only retrieval matches are listed."],
    evidenceNotes: Object.fromEntries(code.map((e) => [e.id, `Retrieved because: ${e.retrievalReason}`])),
  };
}

export function genericClarification(ctx: ClarifyContext): ClarificationOutput {
  if (ctx.round > 1 || ctx.decisions.length > 0) return { questions: [], note: "Fixture provider: no further questions." };
  return {
    note: "",
    questions: [
      {
        id: "q-1", text: "Who exactly is affected by this change, and are there roles that must be excluded?", whyItMatters: "Scope of the change and its tests depends on the affected users.",
        impact: "scope", priority: 1, evidenceIds: [], suggestedAnswers: [{ text: "All signed-in users", tradeoff: "Broadest reach." }, { text: "Only the requesting user's own data", tradeoff: "Narrowest, safest." }],
      },
      {
        id: "q-2", text: "What should happen in the main edge case (invalid input, missing data, or expired state)?", whyItMatters: "Edge-case behavior determines the acceptance tests.",
        impact: "testing", priority: 2, evidenceIds: [], suggestedAnswers: [{ text: "Reject with a clear error", tradeoff: "Explicit; more error handling." }, { text: "Fall back to existing behavior", tradeoff: "Lenient; may hide mistakes." }],
      },
    ],
  };
}

export function genericBrief(ctx: BriefContext): BriefContent {
  const obs = ctx.analysis.observations.filter((o) => o.evidenceIds.length > 0);
  const answered = ctx.decisions.filter((d) => d.source !== "deferred" && d.answer.trim() !== "");
  const deferred = ctx.decisions.filter((d) => d.source === "deferred" || d.answer.trim() === "");
  const primary = obs[0];
  const comps: BriefContent["components"] = [];
  for (const o of obs.slice(0, 3)) {
    const e = ctx.evidence.find((x) => x.id === o.evidenceIds[0]);
    if (e && !comps.some((c) => c.path === e.path)) comps.push({ id: `c-${comps.length + 1}`, path: e.path, role: `Likely affected: ${e.symbol ?? "module"}`, change: "modify", evidenceIds: [e.id] });
  }
  const openQuestions = deferred.map((d, i) => ({ id: `oq-${i + 1}`, kind: "unresolved" as const, text: d.question, questionId: d.questionId }));
  const criteria: BriefContent["acceptanceCriteria"] = [
    {
      id: "ac-1", kind: "proposed", text: "The requested behavior from the ticket is implemented and covered by an automated test.",
      evidenceIds: primary ? primary.evidenceIds : [], componentIds: comps.map((c) => c.id), testIds: ["t-1"],
      decisionRefs: answered.map((d) => d.questionId), dependsOnOpen: openQuestions.map((q) => q.id),
    },
  ];
  return {
    title: ctx.ticket.trim().split("\n")[0]?.slice(0, 90) || "Untitled ticket",
    requestedOutcome: ctx.ticket.trim(),
    scope: { inScope: ["The behavior described in the ticket"], outOfScope: ["Anything not stated in the ticket"] },
    existingBehavior: obs.map((o) => ({ id: o.id, kind: "observed" as const, statement: o.statement, evidenceIds: o.evidenceIds })),
    decisions: answered.map((d) => ({ questionId: d.questionId, question: d.question, answer: d.answer, source: d.source as "user" | "suggestion_accepted" })),
    openQuestions,
    acceptanceCriteria: criteria,
    components: comps,
    steps: [{ id: "st-1", kind: "proposed", text: "Implement the ticket in the components listed above.", componentIds: comps.map((c) => c.id), criterionIds: ["ac-1"] }],
    tests: [{ id: "t-1", kind: "proposed", description: "Add a test that demonstrates the requested behavior.", level: "unit", testPath: null, criterionIds: ["ac-1"] }],
    risks: [],
    assumptions: [{ id: "as-1", kind: "assumed", text: "Fixture provider assumption: the retrieved files are the ones the ticket concerns.", replaceWhen: "A live model or a human confirms the affected components." }],
  };
}

/** Lexical stand-in for the model judge: marks everything as weak so it never masquerades as a verdict. */
export function genericJudge(ctx: JudgeContext): SupportJudgeOutput {
  return { judgements: ctx.items.map((i) => ({ itemId: i.itemId, verdict: "weak" as const, reason: "Fixture provider does not judge support." })) };
}

export function genericSinglePrompt(ctx: SinglePromptContext): SinglePromptOutput {
  return {
    observations: [],
    questions: [],
    assumptions: [{ id: "as-1", text: `Fixture provider produced no analysis for: ${ctx.ticket.slice(0, 80)}` }],
    acceptanceCriteria: [],
    filesToChange: [],
  };
}
