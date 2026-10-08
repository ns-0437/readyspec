/**
 * Five-case live pilot: case selection and a dry-run plan. Nothing here contacts a provider; the
 * plan is computed from local, deterministic retrieval and the configured limits only.
 */
import { z } from "zod";
import { costUsd, type Prices } from "@/server/llm/budget";
import { DEFAULT_MAX_RETRIES } from "@/server/llm/generate";
import { estimateTokens } from "@/server/llm/provider";
import { analyzePrompt, briefPrompt, clarifyPrompt, SYSTEM_PROMPT, singlePromptEvidencePrompt } from "@/server/llm/prompts";
import { investigate } from "@/server/workflow/investigate";
import { BehaviorAnalysis, BriefContent, ClarificationOutput, SinglePromptOutput } from "@/shared/schemas";
import { PROFILES, retrievalFor, type EvalProfile } from "./profile";
import type { EvalCase } from "./schema";
import type { SystemName } from "./score";
import { snapshotFor } from "./systems";

export const PILOT_SYSTEMS: SystemName[] = ["single_prompt", "staged"];

/**
 * Five varied DEVELOPMENT cases, chosen deterministically (held-out cases are never considered).
 * Each pick prefers a repository not used by an earlier pick, then ties break on case id.
 */
export function selectPilotCases(all: EvalCase[]): { c: EvalCase; role: string }[] {
  const dev = all.filter((c) => !c.heldOut).sort((a, b) => (a.id < b.id ? -1 : 1));
  const chosen: { c: EvalCase; role: string }[] = [];
  const pick = (role: string, eligible: (c: EvalCase) => boolean, score: (c: EvalCase) => number) => {
    const used = new Set(chosen.map((x) => x.c.repo));
    const left = dev.filter((c) => !chosen.some((x) => x.c.id === c.id) && eligible(c));
    const best = left.sort((a, b) => Number(used.has(a.repo)) - Number(used.has(b.repo)) || score(b) - score(a))[0];
    if (best) chosen.push({ c: best, role });
  };
  pick("cross-component behavior", (c) => c.category === "ambiguous", (c) => c.expectedFiles.required.length);
  pick("conflicting evidence", (c) => c.expectedContradictions.length > 0, (c) => (c.category === "conflicting-docs" ? 1 : 0));
  pick("clear request, few questions expected", (c) => c.category === "clear", () => 0);
  pick("ambiguity", (c) => c.category === "ambiguous" && c.expectedContradictions.length === 0, (c) => c.criticalAmbiguities.length);
  pick("ambiguity (most open decisions)", (c) => c.category === "ambiguous", (c) => c.criticalAmbiguities.length);
  return chosen;
}

const schemaTokens = (schema: z.ZodType): number => {
  const j = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete j.$schema;
  return estimateTokens(JSON.stringify(j));
};

/** One line per deferred question the brief prompt carries from the clarify stage (at most 5 questions). Conservative allowance, not measured. */
const DECISION_LINES_ALLOWANCE = 300;
export const DEFAULT_SAFETY_MARGIN = 0.1;

export interface StagePlan {
  caseId: string;
  system: SystemName;
  stage: "single_prompt" | "analyze" | "clarify" | "brief";
  /** Estimated tokens: system prompt + user prompt + serialized schema; the user part of later stages is a range. */
  systemTokens: number;
  schemaTokens: number;
  inputLow: number;
  inputHigh: number;
  known: boolean;
  maxOutput: number;
}

export interface EvidenceReport {
  caseId: string;
  keptExcerpts: number;
  keptChars: number;
  fullChars: number;
  /** Excerpts the default retrieval would send that this profile's shared budget drops (empty with the default budget). */
  excluded: { path: string; lines: string; chars: number }[];
  /** Whether the case's expected required files are still among the kept excerpts (evaluation metadata). */
  requiredRetained: boolean;
}

export interface PilotPlan {
  profile: EvalProfile;
  safetyMargin: number;
  rows: StagePlan[];
  evidence: EvidenceReport[];
  cases: { id: string; role: string; repo: string }[];
  callsBeforeRetries: number;
  maxAttempts: number;
  inputLow: number;
  inputHighWithRetries: number;
  outputMaxBeforeRetries: number;
  outputMaxWithRetries: number;
  /** Smallest run-wide limits that cannot be exhausted by the planned requests even if every retry is used (estimates, margin included). */
  worstCaseLimits: { maxCalls: number; maxInputTokens: number; maxOutputTokens: number };
  /** Limits for the planned requests with no retries; a single retry could then stop the run. */
  noRetryLimits: { maxCalls: number; maxInputTokens: number; maxOutputTokens: number };
  costFloorUsd: number | null;
  costCeilingBeforeRetriesUsd: number | null;
  costCeilingWithRetriesUsd: number | null;
  oversize: { caseId: string; stage: string; atLeast: number; atMost: number; limit: number; certain: boolean }[];
}

export function planPilot(opts: { cases: { c: EvalCase; role: string }[]; systems: SystemName[]; prices: Prices | null; providerTokenLimit?: number; profile?: EvalProfile; safetyMargin?: number }): PilotPlan {
  const profile = opts.profile ?? PROFILES.default!;
  const margin = opts.safetyMargin ?? DEFAULT_SAFETY_MARGIN;
  const withMargin = (n: number) => Math.ceil(n * (1 + margin));
  const out = profile.outputs;
  const rows: StagePlan[] = [];
  const evidence: EvidenceReport[] = [];
  const sysTokens = estimateTokens(SYSTEM_PROMPT);
  const sch = { single: schemaTokens(SinglePromptOutput), analyze: schemaTokens(BehaviorAnalysis), clarify: schemaTokens(ClarificationOutput), brief: schemaTokens(BriefContent) };
  const emptyAnalysis = { observations: [], contradictions: [], missingDecisions: [], insufficientEvidence: [], evidenceNotes: {} };
  for (const { c } of opts.cases) {
    const snap = snapshotFor(c.repo);
    const inv = investigate(snap, c.ticket, retrievalFor(profile)); // local and deterministic: the same evidence both systems get
    const full = profile.evidenceMaxChars ? investigate(snap, c.ticket).evidence : inv.evidence;
    const kept = new Set(inv.evidence.map((e) => e.id));
    const keptPaths = new Set(inv.evidence.map((e) => e.path));
    evidence.push({
      caseId: c.id,
      keptExcerpts: inv.evidence.length,
      keptChars: inv.evidence.reduce((s, e) => s + e.excerpt.length, 0),
      fullChars: full.reduce((s, e) => s + e.excerpt.length, 0),
      excluded: full.filter((e) => !kept.has(e.id)).map((e) => ({ path: e.path, lines: `${e.startLine}-${e.endLine}`, chars: e.excerpt.length })),
      requiredRetained: c.expectedFiles.required.every((f) => keptPaths.has(f)),
    });
    const row = (system: SystemName, stage: StagePlan["stage"], schema: number, promptLow: number, promptHigh: number, known: boolean, maxOutput: number) =>
      rows.push({ caseId: c.id, system, stage, systemTokens: sysTokens, schemaTokens: schema, inputLow: sysTokens + promptLow + schema, inputHigh: sysTokens + promptHigh + schema, known, maxOutput });
    if (opts.systems.includes("single_prompt")) {
      const p = estimateTokens(singlePromptEvidencePrompt({ ticket: c.ticket, evidence: inv.evidence }));
      row("single_prompt", "single_prompt", sch.single, p, p, true, out.single_prompt);
    }
    if (opts.systems.includes("staged")) {
      const analyze = estimateTokens(analyzePrompt({ ticket: c.ticket, evidence: inv.evidence, inspection: inv.inspection }));
      row("staged", "analyze", sch.analyze, analyze, analyze, true, out.analyze);
      // Later prompts embed earlier model output, so their size is NOT known in advance. Low: the rendered prompt with an
      // empty analysis (rules, ticket, evidence). High: plus the analysis at its maximum allowance (and, for the brief, the question lines).
      const clarifyLow = estimateTokens(clarifyPrompt({ ticket: c.ticket, analysis: emptyAnalysis, evidence: inv.evidence, decisions: [], priorQuestions: [], round: 1 }));
      row("staged", "clarify", sch.clarify, clarifyLow, clarifyLow + out.analyze, false, out.clarify);
      const briefLow = estimateTokens(briefPrompt({ ticket: c.ticket, analysis: emptyAnalysis, evidence: inv.evidence, decisions: [], rounds: [], inspection: inv.inspection }));
      row("staged", "brief", sch.brief, briefLow, briefLow + out.analyze + DECISION_LINES_ALLOWANCE, false, out.brief);
    }
  }
  const attempts = 1 + DEFAULT_MAX_RETRIES;
  const sum = (f: (r: StagePlan) => number) => rows.reduce((s, r) => s + f(r), 0);
  const inputLow = sum((r) => r.inputLow);
  const inputHigh = sum((r) => withMargin(r.inputHigh));
  const outMax = sum((r) => r.maxOutput);
  const p = opts.prices;
  const cost = (i: number, o: number) => (p ? costUsd(i, o, p) : null);
  const oversize: PilotPlan["oversize"] = [];
  if (opts.providerTokenLimit) {
    for (const r of rows) {
      const atLeast = withMargin(r.inputLow) + r.maxOutput;
      const atMost = withMargin(r.inputHigh) + r.maxOutput;
      if (atMost > opts.providerTokenLimit) oversize.push({ caseId: r.caseId, stage: r.stage, atLeast, atMost, limit: opts.providerTokenLimit, certain: atLeast > opts.providerTokenLimit });
    }
  }
  return {
    profile,
    safetyMargin: margin,
    rows,
    evidence,
    cases: opts.cases.map((x) => ({ id: x.c.id, role: x.role, repo: x.c.repo })),
    callsBeforeRetries: rows.length,
    maxAttempts: rows.length * attempts,
    inputLow,
    inputHighWithRetries: inputHigh * attempts,
    outputMaxBeforeRetries: outMax,
    outputMaxWithRetries: outMax * attempts,
    worstCaseLimits: { maxCalls: rows.length * attempts, maxInputTokens: inputHigh * attempts, maxOutputTokens: outMax * attempts },
    noRetryLimits: { maxCalls: rows.length, maxInputTokens: inputHigh, maxOutputTokens: outMax },
    costFloorUsd: cost(inputLow, 0),
    costCeilingBeforeRetriesUsd: cost(inputHigh, outMax),
    costCeilingWithRetriesUsd: cost(inputHigh * attempts, outMax * attempts),
    oversize,
  };
}

const usd = (v: number | null) => (v === null ? "unknown (set READYSPEC_PRICE_IN_PER_MTOK and READYSPEC_PRICE_OUT_PER_MTOK)" : `${v.toFixed(4)}`);

export function renderPlan(plan: PilotPlan, ctx: { providerLabel: string; systems: SystemName[]; providerTokenLimit?: number; runLimitsSet: boolean; problems?: string[] }): string {
  const L: string[] = ["DRY RUN: no provider calls were made.", ""];
  if (plan.cases.length === 1) L.push("FEASIBILITY CHECK for one development case. It shows whether the requests fit; it is not a quality benchmark.", "");
  L.push(`Provider/model: ${ctx.providerLabel}`, `Profile: ${plan.profile.name} (output allowances: analyze ${plan.profile.outputs.analyze}, clarify ${plan.profile.outputs.clarify}, brief ${plan.profile.outputs.brief}, single prompt ${plan.profile.outputs.single_prompt}${plan.profile.name === "default" ? "" : "; initial hypotheses, not validated"})`);
  L.push(`Systems: ${ctx.systems.join(", ")}, 1 repetition. Safety margin: ${Math.round(plan.safetyMargin * 100)}% added to every input estimate.`);
  for (const pr of ctx.problems ?? []) L.push(`CONFIGURATION PROBLEM: ${pr}`);
  L.push("", "Cases (development set only):");
  for (const c of plan.cases) L.push(`  ${c.id}  [${c.role}; ${c.repo}]`);
  L.push("", "Shared evidence (identical for both systems):");
  for (const e of plan.evidence) {
    L.push(`  ${e.caseId}: ${e.keptExcerpts} excerpts, ${e.keptChars} chars${e.fullChars !== e.keptChars ? ` of ${e.fullChars} under the default budget` : ""}; required files ${e.requiredRetained ? "retained" : "NOT ALL RETAINED"}`);
    for (const x of e.excluded) L.push(`    excluded: ${x.path}:${x.lines} (${x.chars} chars)`);
  }
  L.push("", "Per-request estimates (tokens = chars/4 heuristic, NOT exact tokenization; input = system + prompt + schema):");
  for (const r of plan.rows) {
    const prompt = r.known ? `${r.inputLow}` : `${r.inputLow}-${r.inputHigh}, later-stage input depends on earlier model output`;
    L.push(`  ${r.caseId} ${r.system}/${r.stage}: system ${r.systemTokens} + schema ${r.schemaTokens}; input ~${prompt}; reserved output ${r.maxOutput}`);
  }
  L.push(
    "",
    `Maximum calls: ${plan.callsBeforeRetries} before retries; with up to ${DEFAULT_MAX_RETRIES} retries per request, at most ${plan.maxAttempts} attempts.`,
    `Output reservations: ${plan.outputMaxBeforeRetries} tokens before retries, up to ${plan.outputMaxWithRetries} with retries (the maximum reserved per attempt, not expected use).`,
    `Input exposure incl. margin: at least ~${plan.inputLow} tokens before retries; at most ~${plan.inputHighWithRetries} counting retries and the high estimates.`,
    `Cost: floor (input only, no retries) ${usd(plan.costFloorUsd)}; ceiling before retries ${usd(plan.costCeilingBeforeRetriesUsd)}; ceiling with retries ${usd(plan.costCeilingWithRetriesUsd)}.`,
    "Assumptions: later-stage inputs are ranges, the ceiling assumes every request uses its full output allowance, and nothing here guarantees the provider's final bill.",
  );
  if (ctx.providerTokenLimit) {
    L.push(`Provider allowance ${ctx.providerTokenLimit} tokens per request (input + reserved output, margin included):`);
    for (const r of plan.rows) {
      const o = plan.oversize.find((x) => x.caseId === r.caseId && x.stage === r.stage);
      L.push(`  ${r.caseId} ${r.stage}: ${o ? (o.certain ? `WILL NOT FIT (${o.atLeast}-${o.atMost})` : `MAY NOT FIT (${o.atLeast}-${o.atMost})`) : "fits"}`);
    }
    L.push("Requests in the same minute also share that allowance, so waits between stages (Retry-After) are expected.");
  } else L.push("Provider allowance: none supplied (pass --provider-token-limit N to check each request against it).");
  const w = plan.worstCaseLimits;
  const n = plan.noRetryLimits;
  L.push(
    "",
    "Run-wide budget this plan needs (estimates):",
    `  worst case, every retry used: --max-calls ${w.maxCalls} --max-input-tokens ${w.maxInputTokens} --max-output-tokens ${w.maxOutputTokens}`,
    `  no retries:                   --max-calls ${n.maxCalls} --max-input-tokens ${n.maxInputTokens} --max-output-tokens ${n.maxOutputTokens} (one retry could stop the run)`,
    ctx.runLimitsSet ? "Run-wide limits: supplied on this command." : "Run-wide limits: NOT SET. A live run refuses to start without them. No spending limit has been authorized: credentials being present is not authorization.",
  );
  return L.join("\n");
}
