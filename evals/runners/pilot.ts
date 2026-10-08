/**
 * Five-case live pilot: case selection and a dry-run plan. Nothing here contacts a provider; the
 * plan is computed from local, deterministic retrieval and the configured limits only.
 */
import { z } from "zod";
import { costUsd, type Prices } from "@/server/llm/budget";
import { DEFAULT_MAX_RETRIES } from "@/server/llm/generate";
import { estimateTokens } from "@/server/llm/provider";
import { analyzePrompt, SYSTEM_PROMPT, singlePromptEvidencePrompt } from "@/server/llm/prompts";
import { investigate } from "@/server/workflow/investigate";
import { STAGE_MAX_OUTPUT } from "@/server/workflow/stages";
import { BehaviorAnalysis, BriefContent, ClarificationOutput, SinglePromptOutput } from "@/shared/schemas";
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

export interface StagePlan {
  caseId: string;
  system: SystemName;
  stage: "single_prompt" | "analyze" | "clarify" | "brief";
  /** Estimated input tokens: exact-by-estimate when `known`, otherwise a [low, high] range. */
  inputLow: number;
  inputHigh: number;
  known: boolean;
  maxOutput: number;
}

export interface PilotPlan {
  rows: StagePlan[];
  cases: { id: string; role: string; repo: string }[];
  callsBeforeRetries: number;
  maxAttempts: number;
  inputLow: number;
  inputHighWithRetries: number;
  outputMaxBeforeRetries: number;
  outputMaxWithRetries: number;
  costFloorUsd: number | null;
  costCeilingBeforeRetriesUsd: number | null;
  costCeilingWithRetriesUsd: number | null;
  oversize: { caseId: string; stage: string; atLeast: number; atMost: number; limit: number; certain: boolean }[];
}

export function planPilot(opts: { cases: { c: EvalCase; role: string }[]; systems: SystemName[]; prices: Prices | null; providerTokenLimit?: number }): PilotPlan {
  const rows: StagePlan[] = [];
  const sysTokens = estimateTokens(SYSTEM_PROMPT);
  const sch = { single: schemaTokens(SinglePromptOutput), analyze: schemaTokens(BehaviorAnalysis), clarify: schemaTokens(ClarificationOutput), brief: schemaTokens(BriefContent) };
  for (const { c } of opts.cases) {
    const inv = investigate(snapshotFor(c.repo), c.ticket); // local and deterministic: the same evidence both systems get
    if (opts.systems.includes("single_prompt")) {
      const t = sysTokens + estimateTokens(singlePromptEvidencePrompt({ ticket: c.ticket, evidence: inv.evidence })) + sch.single;
      rows.push({ caseId: c.id, system: "single_prompt", stage: "single_prompt", inputLow: t, inputHigh: t, known: true, maxOutput: STAGE_MAX_OUTPUT.single_prompt });
    }
    if (opts.systems.includes("staged")) {
      const analyze = sysTokens + estimateTokens(analyzePrompt({ ticket: c.ticket, evidence: inv.evidence, inspection: inv.inspection })) + sch.analyze;
      rows.push({ caseId: c.id, system: "staged", stage: "analyze", inputLow: analyze, inputHigh: analyze, known: true, maxOutput: STAGE_MAX_OUTPUT.analyze });
      // Later prompts embed earlier model output, so their size is NOT known in advance. Low: the evidence and
      // ticket alone (already in the analyze prompt). High: plus the maximum output of every earlier stage.
      const clarifyLow = analyze - sch.analyze + sch.clarify;
      rows.push({ caseId: c.id, system: "staged", stage: "clarify", inputLow: clarifyLow, inputHigh: clarifyLow + STAGE_MAX_OUTPUT.analyze, known: false, maxOutput: STAGE_MAX_OUTPUT.clarify });
      const briefLow = analyze - sch.analyze + sch.brief;
      rows.push({ caseId: c.id, system: "staged", stage: "brief", inputLow: briefLow, inputHigh: briefLow + STAGE_MAX_OUTPUT.analyze + STAGE_MAX_OUTPUT.clarify, known: false, maxOutput: STAGE_MAX_OUTPUT.brief });
    }
  }
  const attempts = 1 + DEFAULT_MAX_RETRIES;
  const sum = (f: (r: StagePlan) => number) => rows.reduce((s, r) => s + f(r), 0);
  const inputLow = sum((r) => r.inputLow);
  const inputHigh = sum((r) => r.inputHigh);
  const outMax = sum((r) => r.maxOutput);
  const p = opts.prices;
  const cost = (i: number, o: number) => (p ? costUsd(i, o, p) : null);
  const oversize: PilotPlan["oversize"] = [];
  if (opts.providerTokenLimit) {
    for (const r of rows) {
      const atLeast = r.inputLow + r.maxOutput;
      const atMost = r.inputHigh + r.maxOutput;
      if (atMost > opts.providerTokenLimit) oversize.push({ caseId: r.caseId, stage: r.stage, atLeast, atMost, limit: opts.providerTokenLimit, certain: atLeast > opts.providerTokenLimit });
    }
  }
  return {
    rows,
    cases: opts.cases.map((x) => ({ id: x.c.id, role: x.role, repo: x.c.repo })),
    callsBeforeRetries: rows.length,
    maxAttempts: rows.length * attempts,
    inputLow,
    inputHighWithRetries: inputHigh * attempts,
    outputMaxBeforeRetries: outMax,
    outputMaxWithRetries: outMax * attempts,
    costFloorUsd: cost(inputLow, 0),
    costCeilingBeforeRetriesUsd: cost(inputHigh, outMax),
    costCeilingWithRetriesUsd: cost(inputHigh * attempts, outMax * attempts),
    oversize,
  };
}

const usd = (v: number | null) => (v === null ? "unknown (set READYSPEC_PRICE_IN_PER_MTOK and READYSPEC_PRICE_OUT_PER_MTOK)" : `$${v.toFixed(4)}`);

export function renderPlan(plan: PilotPlan, ctx: { providerLabel: string; systems: SystemName[]; providerTokenLimit?: number; runLimitsSet: boolean }): string {
  const L: string[] = ["DRY RUN: no provider calls were made.", ""];
  L.push(`Provider/model: ${ctx.providerLabel}`, `Systems: ${ctx.systems.join(", ")} (alphabetical baseline and static checklist excluded), 1 repetition`, "", "Cases (development set only):");
  for (const c of plan.cases) L.push(`  ${c.id}  [${c.role}; ${c.repo}]`);
  L.push("", "Per-stage requests (input is an estimate: chars/4 plus serialized schema):");
  for (const r of plan.rows) {
    const input = r.known ? `${r.inputLow}` : `${r.inputLow}-${r.inputHigh} (depends on earlier model output)`;
    L.push(`  ${r.caseId} ${r.system}/${r.stage}: input ~${input}, max output ${r.maxOutput}`);
  }
  L.push(
    "",
    `Expected calls before retries: ${plan.callsBeforeRetries} (single prompt 1 per case, staged 3 per case).`,
    `Retry allowance: up to ${DEFAULT_MAX_RETRIES} extra attempts per request, so at most ${plan.maxAttempts} attempts. Output allowance: ${plan.outputMaxBeforeRetries} tokens before retries, up to ${plan.outputMaxWithRetries} with retries (maximum reserved per attempt, not expected use).`,
    `Input exposure: at least ~${plan.inputLow} tokens before retries; at most ~${plan.inputHighWithRetries} counting retries and the high estimates.`,
    `Cost: floor (input only, no retries) ${usd(plan.costFloorUsd)}; ceiling before retries ${usd(plan.costCeilingBeforeRetriesUsd)}; ceiling with retries ${usd(plan.costCeilingWithRetriesUsd)}.`,
    "Assumptions: token counts are chars/4 heuristics, later-stage inputs are ranges, the ceiling assumes every request uses its full output allowance, and none of this guarantees the provider's final bill.",
  );
  if (ctx.providerTokenLimit) {
    if (plan.oversize.length === 0) L.push(`Provider limit ${ctx.providerTokenLimit} tokens per request: no stage is likely to exceed it by these estimates.`);
    else {
      L.push(`Provider limit ${ctx.providerTokenLimit} tokens per request: stages likely to exceed it (input + max output):`);
      for (const o of plan.oversize) L.push(`  ${o.caseId} ${o.stage}: ${o.certain ? "WILL exceed" : "may exceed"} (${o.atLeast}-${o.atMost})`);
    }
  } else L.push("Provider limit: none supplied (pass --provider-token-limit N to check request sizes against a per-request or per-minute token cap).");
  L.push(
    "",
    ctx.runLimitsSet
      ? "Run-wide limits: supplied."
      : "Run-wide limits: NOT SET. A live run refuses to start without --max-calls, --max-input-tokens and --max-output-tokens (optional --max-cost-usd needs both prices). No spending limit has been authorized yet: choose one, then run:",
    "  npm run eval -- --pilot --provider <groq|gemini|anthropic> --max-calls <N> --max-input-tokens <N> --max-output-tokens <N> [--max-cost-usd <USD>]",
  );
  return L.join("\n");
}
