import {
  BehaviorAnalysis,
  BriefContent,
  ClarificationOutput,
  MAX_QUESTIONS_PER_ROUND,
  SupportJudgeOutput,
  type Decision,
  type EvidenceItem,
  type Question,
  type SupportResult,
} from "@/shared/schemas";
import type { Budget } from "@/server/llm/budget";
import type { AnalyzeContext, BriefContext, ClarifyContext, JudgeContext } from "@/server/llm/contexts";
import { generateStructured } from "@/server/llm/generate";
import type { LlmProvider, StageName } from "@/server/llm/provider";
import { analyzePrompt, briefPrompt, clarifyPrompt, judgePrompt, SYSTEM_PROMPT } from "@/server/llm/prompts";

/** Everything a model stage needs from its host; keeps stages free of persistence and HTTP. */
export interface StageEnv {
  provider: LlmProvider;
  budget: Budget;
  signal?: AbortSignal;
  backoffMs?: number;
  onUsage: (stage: StageName, u: { inputTokens: number; outputTokens: number; costUsd: number | null; estimated: boolean }) => void;
  onEvent: (stage: string, level: "info" | "warn", message: string) => void;
}

const call = <T>(env: StageEnv, stage: StageName, schemaName: string, schema: import("zod").ZodType<T>, user: string, context: unknown, maxOutputTokens: number) =>
  generateStructured<T>({
    provider: env.provider,
    budget: env.budget,
    stage,
    system: SYSTEM_PROMPT,
    user,
    schema,
    schemaName,
    maxOutputTokens,
    signal: env.signal,
    context,
    backoffMs: env.backoffMs,
    onUsage: (u) => env.onUsage(stage, u),
    onEvent: (level, message) => env.onEvent(stage, level, message),
  });

const keepKnown = (ids: string[], known: Set<string>): { kept: string[]; dropped: number } => {
  const kept = [...new Set(ids)].filter((i) => known.has(i));
  return { kept, dropped: new Set(ids).size - kept.length };
};

/* ------------------------------ behavior analysis ------------------------------ */

export async function runAnalyze(env: StageEnv, ctx: AnalyzeContext): Promise<BehaviorAnalysis> {
  const raw = await call(env, "analyze", "BehaviorAnalysis", BehaviorAnalysis, analyzePrompt(ctx), ctx, 6000);
  const known = new Set(ctx.evidence.map((e) => e.id));
  let dropped = 0;
  const insufficient = [...raw.insufficientEvidence];
  const observations = [];
  for (const o of raw.observations) {
    const k = keepKnown(o.evidenceIds, known);
    dropped += k.dropped;
    if (k.kept.length === 0) {
      // Never present an unsupported statement as observed behavior.
      insufficient.push(`Unverified claim (no valid evidence, not treated as observed): ${o.statement}`);
      continue;
    }
    observations.push({ ...o, kind: "observed" as const, evidenceIds: k.kept });
  }
  const fixIds = <T extends { evidenceIds: string[] }>(arr: T[]): T[] =>
    arr.map((x) => {
      const k = keepKnown(x.evidenceIds, known);
      dropped += k.dropped;
      return { ...x, evidenceIds: k.kept };
    });
  const notes = Object.fromEntries(Object.entries(raw.evidenceNotes).filter(([id]) => known.has(id)));
  if (dropped > 0) env.onEvent("analyze", "warn", `Removed ${dropped} citation(s) to evidence ids that were not provided.`);
  if (insufficient.length > raw.insufficientEvidence.length) env.onEvent("analyze", "warn", `${insufficient.length - raw.insufficientEvidence.length} claim(s) without valid evidence moved to 'insufficient evidence'.`);
  return { observations, contradictions: fixIds(raw.contradictions), missingDecisions: fixIds(raw.missingDecisions), insufficientEvidence: insufficient, evidenceNotes: notes };
}

/* ------------------------------ clarification ------------------------------ */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function runClarify(env: StageEnv, ctx: ClarifyContext): Promise<ClarificationOutput> {
  const raw = await call(env, "clarify", "ClarificationOutput", ClarificationOutput, clarifyPrompt(ctx), ctx, 4000);
  const known = new Set(ctx.evidence.map((e) => e.id));
  const asked = new Set([...ctx.priorQuestions, ...ctx.decisions.map((d) => ({ text: d.question }))].map((q) => norm(q.text)));
  const usedIds = new Set(ctx.priorQuestions.map((q) => q.id));
  const questions: Question[] = [];
  for (const q of [...raw.questions].sort((a, b) => a.priority - b.priority)) {
    if (asked.has(norm(q.text))) continue;
    let id = q.id;
    if (usedIds.has(id)) id = `r${ctx.round}-${id}`;
    usedIds.add(id);
    questions.push({ ...q, id, priority: questions.length + 1, evidenceIds: q.evidenceIds.filter((e) => known.has(e)) });
    if (questions.length >= MAX_QUESTIONS_PER_ROUND) break;
  }
  if (raw.questions.length > questions.length) env.onEvent("clarify", "info", `Kept ${questions.length} of ${raw.questions.length} proposed question(s) (dedupe / cap of ${MAX_QUESTIONS_PER_ROUND}).`);
  return { questions, note: raw.note };
}

/* ------------------------------ brief generation ------------------------------ */

export interface BriefResult {
  content: BriefContent;
  repairs: string[];
}

export async function runBrief(env: StageEnv, ctx: BriefContext): Promise<BriefResult> {
  const raw = await call(env, "brief", "BriefContent", BriefContent, briefPrompt(ctx), ctx, 10000);
  const known = new Set(ctx.evidence.map((e) => e.id));
  const repairs: string[] = [];
  let dropped = 0;
  const clean = (ids: string[]) => {
    const k = keepKnown(ids, known);
    dropped += k.dropped;
    return k.kept;
  };
  const content: BriefContent = {
    ...raw,
    existingBehavior: raw.existingBehavior.map((o) => ({ ...o, kind: "observed" as const, evidenceIds: clean(o.evidenceIds) })),
    acceptanceCriteria: raw.acceptanceCriteria.map((c) => ({ ...c, evidenceIds: clean(c.evidenceIds) })),
    components: raw.components.map((c) => ({ ...c, evidenceIds: clean(c.evidenceIds) })),
    risks: raw.risks.map((r) => ({ ...r, evidenceIds: clean(r.evidenceIds) })),
  };
  if (dropped > 0) repairs.push(`removed ${dropped} citation(s) to unknown evidence ids`);

  // Human answers are authoritative: rebuild decisions from what was recorded, never from the model.
  const answered = ctx.decisions.filter((d): d is Decision & { source: "user" | "suggestion_accepted" } => d.source !== "deferred" && d.answer.trim() !== "");
  const before = JSON.stringify(content.decisions.map((d) => [d.questionId, d.answer]).sort());
  content.decisions = answered.map((d) => ({ questionId: d.questionId, question: d.question, answer: d.answer, source: d.source }));
  if (before !== JSON.stringify(content.decisions.map((d) => [d.questionId, d.answer]).sort())) repairs.push("restored recorded decisions exactly as the human answered");

  // Every question the human did not resolve must stay visible as unresolved.
  const allQuestions = ctx.rounds.flatMap((r) => r.questions);
  const resolved = new Set(answered.map((d) => d.questionId));
  const present = new Set(content.openQuestions.map((q) => q.questionId).filter((q): q is string => !!q));
  for (const q of allQuestions) {
    if (resolved.has(q.id) || present.has(q.id)) continue;
    const used = new Set(content.openQuestions.map((o) => o.id));
    let n = content.openQuestions.length + 1;
    while (used.has(`oq-${n}`)) n++;
    content.openQuestions.push({ id: `oq-${n}`, kind: "unresolved", text: q.text, questionId: q.id });
    repairs.push(`re-added unresolved question ${q.id} the model omitted`);
  }
  // A question that WAS answered must not linger as open.
  const stale = content.openQuestions.filter((o) => o.questionId && resolved.has(o.questionId));
  if (stale.length) {
    const staleIds = new Set(stale.map((s) => s.id));
    content.openQuestions = content.openQuestions.filter((o) => !staleIds.has(o.id));
    content.acceptanceCriteria = content.acceptanceCriteria.map((c) => ({ ...c, dependsOnOpen: c.dependsOnOpen.filter((o) => !staleIds.has(o)) }));
    repairs.push(`removed ${stale.length} open question(s) that already have an answer`);
  }
  return { content, repairs };
}

/* ------------------------------ supplementary model judge ------------------------------ */

export async function runJudge(env: StageEnv, ctx: JudgeContext): Promise<SupportResult[]> {
  if (ctx.items.length === 0) return [];
  const out = await call(env, "judge", "SupportJudgeOutput", SupportJudgeOutput, judgePrompt(ctx), ctx, 4000);
  const wanted = new Map(ctx.items.map((i) => [i.itemId, i]));
  return out.judgements
    .filter((j) => wanted.has(j.itemId))
    .map((j) => ({
      itemId: j.itemId,
      itemType: (wanted.get(j.itemId)?.itemType ?? "observation") as SupportResult["itemType"],
      verdict: j.verdict,
      method: "model" as const,
      detail: j.reason,
    }));
}

export type { EvidenceItem };
