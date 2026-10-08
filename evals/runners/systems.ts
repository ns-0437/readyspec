import path from "node:path";
import { Budget, costUsd } from "@/server/llm/budget";
import { generateStructured } from "@/server/llm/generate";
import { BudgetExceededError, type LlmProvider } from "@/server/llm/provider";
import type { SinglePromptEvidenceContext } from "@/server/llm/contexts";
import { SYSTEM_PROMPT, singlePromptEvidencePrompt, singlePromptPrompt } from "@/server/llm/prompts";
import { buildEvidence } from "@/server/repository/evidence";
import { DEFAULT_RETRIEVAL } from "@/server/repository/search";
import { createSnapshot } from "@/server/repository/snapshot";
import type { Snapshot } from "@/server/repository/types";
import { investigate } from "@/server/workflow/investigate";
import { runAnalyze, runBrief, runClarify, STAGE_MAX_OUTPUT, type StageEnv } from "@/server/workflow/stages";
import { verifyBrief } from "@/server/workflow/verify";
import { SinglePromptOutput, type Decision, type EvidenceItem } from "@/shared/schemas";
import type { EvalCase } from "./schema";
import type { ObservationOut, SystemOutput } from "./score";

const ROOT = path.resolve(__dirname, "..", "..", "fixtures");
const REPO_PATH: Record<EvalCase["repo"], string> = {
  "demo-repository": path.join(ROOT, "demo-repository"),
  "shop-orders": path.join(ROOT, "repos", "shop-orders"),
  "team-tasks": path.join(ROOT, "repos", "team-tasks"),
  "helpdesk-platform": path.join(ROOT, "repos", "helpdesk-platform"),
};

const snapshots = new Map<string, Snapshot>();
export function snapshotFor(repo: EvalCase["repo"]): Snapshot {
  let s = snapshots.get(repo);
  if (!s) {
    s = createSnapshot(REPO_PATH[repo]);
    snapshots.set(repo, s);
  }
  return s;
}

const HIGH = { maxCalls: 50, maxInputTokens: 2_000_000, maxOutputTokens: 500_000, maxCostUsd: null };

/**
 * Accounting ownership: the per-case Budget built here owns the case's usage figures (reported in its
 * SystemOutput); the optional shared runBudget owns run-wide limits and totals. generateStructured
 * updates each exactly once per request, so neither double counts the other.
 */
function makeEnv(provider: LlmProvider, runBudget?: Budget) {
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const env: StageEnv = {
    provider,
    budget: new Budget(HIGH, { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, estimated: false }),
    backoffMs: 500,
    runBudget,
    onUsage: (_s, u) => {
      usage.calls++;
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
    },
    onEvent: () => {},
  };
  return { env, usage, finish: () => ({ ...usage, costUsd: provider.info.kind === "fixture" ? null : costUsd(usage.inputTokens, usage.outputTokens) }) };
}

/** A run-wide budget refusal is not a model-quality failure: flag it so the runner can stop and report it separately. */
export function recordError(out: SystemOutput, e: unknown): void {
  out.error = (e as Error).message;
  if (e instanceof BudgetExceededError && e.scope === "run") out.budgetExhausted = true;
}

const empty = (system: SystemOutput["system"]): SystemOutput => ({
  system, contextFiles: [], modelFiles: [], hallucinatedFiles: [], questions: [], observations: [], assumptions: [], criteria: [],
  contradictions: [], insufficientEvidence: [], verification: null, latencyMs: 0, usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null },
});

/* --------------------------- 1. static ticket checklist --------------------------- */

/** The same five generic questions for every ticket. No repository access, no model. */
export const CHECKLIST = [
  "Who are the users affected by this change, and are any roles excluded?",
  "What are the acceptance criteria and what does done look like?",
  "What edge cases and error states should be handled?",
  "Are there security, privacy or performance constraints to respect?",
  "How should this be tested and rolled out?",
];

export async function runChecklist(): Promise<SystemOutput> {
  const t0 = performance.now();
  // No model call at all: usage and cost are a KNOWN zero, not unavailable.
  return { ...empty("checklist"), questions: CHECKLIST.map((text) => ({ text, why: "" })), latencyMs: performance.now() - t0, usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, exact: true } };
}

/* --------------------------- 2. single-prompt baselines --------------------------- */

/** Maps a single-prompt model result onto SystemOutput. Model-selected files stay in `modelFiles`. */
function fillFromSinglePrompt(out: SystemOutput, res: SinglePromptOutput, snap: Snapshot): void {
  const fileSet = new Set<string>();
  const observations: ObservationOut[] = res.observations.map((o) => {
    const evidence: EvidenceItem[] = [];
    let invalid = 0;
    for (const cite of o.citations) {
      const f = snap.files.get(cite.path);
      const total = f ? f.content.split("\n").length : 0;
      if (!f || cite.startLine < 1 || cite.endLine < cite.startLine || cite.endLine > total) {
        invalid++;
        if (!f) out.hallucinatedFiles.push(cite.path);
        continue;
      }
      fileSet.add(cite.path);
      evidence.push(buildEvidence(snap, { path: cite.path, startLine: cite.startLine, endLine: cite.endLine, symbol: null, score: 0, matchedTerms: [], retrievalReason: "cited by single-prompt model" }));
    }
    return { id: o.id, statement: o.statement, evidence, invalidCitations: invalid, totalCitations: o.citations.length };
  });
  for (const p of res.filesToChange) {
    if (snap.files.has(p)) fileSet.add(p);
    else out.hallucinatedFiles.push(p);
  }
  out.modelFiles = [...fileSet];
  out.observations = observations;
  out.questions = res.questions.map((q) => ({ text: q.text, why: q.whyItMatters }));
  out.assumptions = res.assumptions.map((a) => a.text);
  out.criteria = res.acceptanceCriteria.map((a) => a.text);
}

/**
 * MAIN single-prompt baseline (same evidence). It calls the same investigate() as the staged
 * workflow, so it receives the identical initial excerpts (ids, paths, line ranges, order), then
 * makes ONE structured call under the same SYSTEM_PROMPT and provider/model. This isolates what
 * staging adds (separate analyze/clarify/brief calls, verification) from retrieval quality.
 * It measures pre-answer output quality only: neither system here gets human answers, so the
 * benefit of a completed clarification loop is not measured.
 */
export async function runSinglePrompt(c: EvalCase, provider: LlmProvider, runBudget?: Budget): Promise<SystemOutput> {
  const t0 = performance.now();
  const snap = snapshotFor(c.repo);
  const out = empty("single_prompt");
  const { env, finish } = makeEnv(provider, runBudget);
  try {
    const evidence = investigate(snap, c.ticket).evidence;
    out.contextFiles = [...new Set(evidence.map((e) => e.path))];
    out.context = { kind: "same_evidence", filesInPrompt: out.contextFiles.length, filesInRepo: snap.files.size, truncated: false, excerptsInPrompt: evidence.length };
    const ctx: SinglePromptEvidenceContext = { ticket: c.ticket, evidence };
    const res = await generateStructured({
      provider, budget: env.budget, runBudget: env.runBudget, stage: "single_prompt", system: SYSTEM_PROMPT, user: singlePromptEvidencePrompt(ctx), schema: SinglePromptOutput,
      schemaName: "SinglePromptOutput", maxOutputTokens: STAGE_MAX_OUTPUT.single_prompt, context: ctx, backoffMs: env.backoffMs, onUsage: (u) => env.onUsage("single_prompt", u),
    });
    fillFromSinglePrompt(out, res, snap);
  } catch (e) {
    recordError(out, e);
  }
  out.latencyMs = performance.now() - t0;
  out.usage = { ...finish(), exact: !out.error };
  return out;
}

/**
 * SECONDARY baseline (alphabetical). One call over repository files in path order until the same
 * character budget the retriever gets: no retrieval. Confounds retrieval quality with the benefit
 * of staging, so it is not the main comparison. Run with --systems single_alphabetical.
 */
export async function runSinglePromptAlphabetical(c: EvalCase, provider: LlmProvider, budgetChars = DEFAULT_RETRIEVAL.maxChars, runBudget?: Budget): Promise<SystemOutput> {
  const t0 = performance.now();
  const snap = snapshotFor(c.repo);
  const out = empty("single_prompt_alphabetical");
  const { env, finish } = makeEnv(provider, runBudget);
  try {
    const files: { path: string; content: string; truncated: boolean }[] = [];
    let used = 0;
    for (const f of [...snap.files.values()].sort((a, b) => (a.path < b.path ? -1 : 1))) {
      const room = budgetChars - used;
      if (room < 400) break;
      const truncated = f.content.length > room;
      files.push({ path: f.path, content: truncated ? f.content.slice(0, room) : f.content, truncated });
      used += Math.min(room, f.content.length);
    }
    out.contextFiles = files.map((f) => f.path);
    out.context = { kind: "alphabetical", filesInPrompt: files.length, filesInRepo: snap.files.size, truncated: files.length < snap.files.size || files.some((f) => f.truncated) };
    const ctx = { ticket: c.ticket, files };
    const res = await generateStructured({
      provider, budget: env.budget, runBudget: env.runBudget, stage: "single_prompt", system: SYSTEM_PROMPT, user: singlePromptPrompt(ctx), schema: SinglePromptOutput,
      schemaName: "SinglePromptOutput", maxOutputTokens: STAGE_MAX_OUTPUT.single_prompt, context: ctx, backoffMs: env.backoffMs, onUsage: (u) => env.onUsage("single_prompt", u),
    });
    fillFromSinglePrompt(out, res, snap);
  } catch (e) {
    recordError(out, e);
  }
  out.latencyMs = performance.now() - t0;
  out.usage = { ...finish(), exact: !out.error };
  return out;
}

/* --------------------------- 3. ReadySpec staged workflow --------------------------- */

/**
 * The product pipeline without a human: investigate -> analyze -> clarify (round 1) -> brief with
 * every question deferred (so nothing is silently decided) -> verify.
 */
export async function runStaged(c: EvalCase, provider: LlmProvider, runBudget?: Budget): Promise<SystemOutput> {
  const t0 = performance.now();
  const snap = snapshotFor(c.repo);
  const out = empty("staged");
  const { env, finish } = makeEnv(provider, runBudget);
  try {
    const inv = investigate(snap, c.ticket);
    const evidence = inv.evidence;
    out.contextFiles = [...new Set(evidence.map((e) => e.path))];
    const analysis = await runAnalyze(env, { ticket: c.ticket, evidence, inspection: inv.inspection });
    const clar = await runClarify(env, { ticket: c.ticket, analysis, evidence, decisions: [], priorQuestions: [], round: 1 });
    const decisions: Decision[] = clar.questions.map((q) => ({ questionId: q.id, question: q.text, round: 1, answer: "", source: "deferred", answeredAt: new Date().toISOString() }));
    const { content } = await runBrief(env, { ticket: c.ticket, analysis, evidence, decisions, rounds: [{ round: 1, questions: clar.questions, note: clar.note }], inspection: inv.inspection });
    const report = verifyBrief({ brief: content, revision: 1, evidence, snapshot: snap, questions: clar.questions, decisions });
    const byId = new Map(evidence.map((e) => [e.id, e]));

    out.questions = clar.questions.map((q) => ({ text: q.text, why: q.whyItMatters }));
    out.observations = content.existingBehavior.map((o) => ({
      id: o.id,
      statement: o.statement,
      evidence: o.evidenceIds.map((i) => byId.get(i)).filter((e): e is EvidenceItem => !!e),
      invalidCitations: report.citations.invalid.filter((i) => o.evidenceIds.includes(i.evidenceId)).length,
      totalCitations: o.evidenceIds.length,
    }));
    // Model-selected files, symmetric with the baseline's cited + filesToChange: files cited in
    // observations plus the brief's affected components (only those that exist in the snapshot).
    out.modelFiles = [...new Set([...out.observations.flatMap((o) => o.evidence.map((e) => e.path)), ...content.components.map((x) => x.path)])].filter((p) => snap.files.has(p));
    out.assumptions = content.assumptions.map((a) => a.text);
    out.criteria = content.acceptanceCriteria.map((a) => a.text);
    out.contradictions = analysis.contradictions.map((x) => x.description);
    out.insufficientEvidence = analysis.insufficientEvidence;
    out.verification = { errors: report.issues.filter((i) => i.severity === "error").length, warnings: report.issues.filter((i) => i.severity === "warning").length };
  } catch (e) {
    recordError(out, e);
  }
  out.latencyMs = performance.now() - t0;
  out.usage = { ...finish(), exact: !out.error };
  return out;
}
