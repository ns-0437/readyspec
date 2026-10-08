import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { Budget, BudgetConfigError } from "@/server/llm/budget";
import { generateStructured } from "@/server/llm/generate";
import { BudgetExceededError, ProviderError, type LlmProvider, type LlmRequest } from "@/server/llm/provider";
import type { SessionLimits, Usage } from "@/shared/schemas";
import { loadCases } from "../evals/runners/cases";
import { PILOT_SYSTEMS, planPilot, renderPlan, selectPilotCases } from "../evals/runners/pilot";
import { parseRunLimits, runBenchmark } from "../evals/runners/run";
import type { SystemName, SystemOutput } from "../evals/runners/score";
import { recordError } from "../evals/runners/systems";
import { readSavedResults } from "../evals/runners/store";

const devCases = loadCases().filter((c) => !c.heldOut);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "readyspec-evalbudget-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const EMPTY_SINGLE = JSON.stringify({ observations: [], questions: [], assumptions: [], acceptanceCriteria: [], filesToChange: [] });
const limits = (over: Partial<SessionLimits>): SessionLimits => ({ maxCalls: 1000, maxInputTokens: 1e9, maxOutputTokens: 1e9, maxCostUsd: null, ...over });
const zero: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, estimated: false };

/** Records every dispatch. Real single-prompt runs get a valid empty answer that reports `usage`. */
function capturing(usage = { inputTokens: 100, outputTokens: 5000 }, failWith?: Error): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    info: { kind: "groq", label: "mock", model: "m" },
    leavesMachine: false,
    async complete(req) {
      calls.push(req);
      if (failWith) throw failWith;
      return { text: EMPTY_SINGLE, usage };
    },
  };
}
const bench = (provider: LlmProvider, extra: Partial<Parameters<typeof runBenchmark>[0]> = {}) =>
  runBenchmark({ provider, set: "dev", cases: devCases.slice(0, 4), systems: ["single_prompt"], repeat: 1, resultsDir: tmp, prices: null, ...extra });

/** Test seam that runs real generateStructured against the shared budget with no real waiting. */
const viaGenerate = (maxRetries: number) => async (system: SystemName, _c: unknown, provider: LlmProvider, runBudget?: Budget): Promise<SystemOutput> => {
  const out: SystemOutput = { system, contextFiles: [], modelFiles: [], hallucinatedFiles: [], questions: [], observations: [], assumptions: [], criteria: [], contradictions: [], insufficientEvidence: [], verification: null, latencyMs: 0, usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, exact: true } };
  const caseBudget = new Budget(limits({}), zero, null);
  try {
    await generateStructured({ provider, budget: caseBudget, runBudget, stage: "analyze", system: "s", user: "u", schema: z.object({ observations: z.array(z.unknown()) }).passthrough(), schemaName: "T", maxOutputTokens: 10, maxRetries, backoffMs: 0, onUsage: (u) => { out.usage.calls++; out.usage.inputTokens += u.inputTokens; out.usage.outputTokens += u.outputTokens; } });
  } catch (e) {
    recordError(out, e);
  }
  return out;
};

describe("evaluation-wide budget", () => {
  it("spending in one case reduces what the next case may use, and an over-budget request is blocked before dispatch", async () => {
    // Each request reserves 6000 output tokens and reports 5000. Cap 13000: case 1 and 2 fit (5000, then 5000+6000 reserved), case 3 would need 10000+6000.
    const provider = capturing({ inputTokens: 100, outputTokens: 5000 });
    const r = await bench(provider, { runLimits: limits({ maxOutputTokens: 13000 }) });
    expect(provider.calls).toHaveLength(2); // the third request never reached the provider
    expect(r.budgetExhausted).toBe(true);
    const saved = readSavedResults(r.runDir);
    expect(saved.map((s) => s.status)).toEqual(["completed", "completed", "budget_exhausted"]);
  });

  it("retries draw on the same shared allowance", async () => {
    const provider = capturing(undefined, new ProviderError("503", { retryable: true, status: 503 }));
    const r = await bench(provider, { runLimits: limits({ maxCalls: 3 }), execute: viaGenerate(5) });
    expect(provider.calls).toHaveLength(3); // 5 retries were allowed per request, the shared 3-attempt allowance stopped them
    const acct = JSON.parse(fs.readFileSync(path.join(r.runDir, "run-accounting.json"), "utf8"));
    expect(acct.runBudget).toMatchObject({ attempts: 3, failedAttempts: 3, settledCalls: 0 });
    expect(acct.exhausted).toBe(true);
  });

  it("a rejection by the run budget leaves the per-case budget untouched (no phantom attempt)", async () => {
    const runBudget = new Budget(limits({ maxCalls: 0 }), zero, null, "run");
    const caseBudget = new Budget(limits({ maxCalls: 1 }), zero, null);
    const provider = capturing();
    await expect(generateStructured({ provider, budget: caseBudget, runBudget, stage: "analyze", system: "s", user: "u", schema: z.object({}).passthrough(), schemaName: "T", maxOutputTokens: 10, backoffMs: 0 })).rejects.toMatchObject({ scope: "run" });
    expect(provider.calls).toHaveLength(0);
    expect(caseBudget.totals().attempts).toBe(0);
    // and the reverse: a per-case refusal gives the run slot back
    const run2 = new Budget(limits({ maxCalls: 1 }), zero, null, "run");
    await expect(generateStructured({ provider, budget: new Budget(limits({ maxCalls: 0 }), zero, null), runBudget: run2, stage: "analyze", system: "s", user: "u", schema: z.object({}).passthrough(), schemaName: "T", maxOutputTokens: 10, backoffMs: 0 })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(run2.totals().attempts).toBe(0);
  });

  it("preserves earlier artifacts, labels the interrupted case, and lists unrun cases without scoring them", async () => {
    const r = await bench(capturing({ inputTokens: 100, outputTokens: 5000 }), { runLimits: limits({ maxOutputTokens: 13000 }) });
    const saved = readSavedResults(r.runDir);
    expect(saved.filter((s) => s.status === "completed").every((s) => s.score && s.output.usage.outputTokens === 5000)).toBe(true); // earlier results intact
    const stopped = saved.find((s) => s.status === "budget_exhausted")!;
    expect(stopped.score).toBeNull(); // partial output is kept but never scored
    expect(stopped.output.budgetExhausted).toBe(true);

    const acct = JSON.parse(fs.readFileSync(path.join(r.runDir, "run-accounting.json"), "utf8"));
    expect(acct.interrupted).toMatchObject({ caseId: devCases[2]!.id, system: "single_prompt", repetition: 1 });
    expect(acct.notRun).toEqual([{ repetition: 1, caseId: devCases[3]!.id, system: "single_prompt" }]); // not dropped, not scored
    expect(r.notRun).toHaveLength(1);

    // budget exhaustion is reported apart from model-quality failures
    expect(r.overall[0]).toMatchObject({ cases: 2, failed: 0, completed: 2 });
    expect(r.report).toContain("Run-wide budget exhausted");
    expect(r.report).toContain("NOT RUN");
    expect(JSON.parse(fs.readFileSync(path.join(r.runDir, "run.json"), "utf8")).status).toBe("budget_exhausted");
  });

  it("per-case and run totals agree, so nothing is counted twice", async () => {
    const r = await bench(capturing({ inputTokens: 100, outputTokens: 50 }), { runLimits: limits({}) });
    const acct = JSON.parse(fs.readFileSync(path.join(r.runDir, "run-accounting.json"), "utf8"));
    expect(acct.exhausted).toBe(false);
    expect(acct.reconciled).toBe(true);
    expect(acct.runBudget).toMatchObject({ attempts: 4, settledCalls: 4, failedAttempts: 0, reportedInputTokens: 400, reportedOutputTokens: 200 });
    expect(acct.perCaseReportedSum).toEqual({ inputTokens: 400, outputTokens: 200 });
    const fromFiles = readSavedResults(r.runDir).reduce((s, x) => s + x.output.usage.inputTokens, 0);
    expect(fromFiles).toBe(400); // the saved per-case figures sum to the run figure exactly once
  });

  it("enforces an estimated dollar ceiling run-wide when prices are valid, and rejects one without prices before creating anything", async () => {
    const before = fs.existsSync(path.join(tmp, "runs")) ? fs.readdirSync(path.join(tmp, "runs")).length : 0;
    await expect(bench(capturing(), { runLimits: limits({ maxCostUsd: 5 }), prices: null })).rejects.toBeInstanceOf(BudgetConfigError);
    expect(fs.readdirSync(path.join(tmp, "runs")).length).toBe(before); // no half-made run directory

    const provider = capturing();
    const r = await bench(provider, { runLimits: limits({ maxCostUsd: 5 }), prices: { inPerMTok: 1_000_000, outPerMTok: 1_000_000 } }); // $1/token: one request's worst case is thousands of dollars
    expect(provider.calls).toHaveLength(0);
    expect(r.budgetExhausted).toBe(true);
    expect(r.notRun).toHaveLength(3);
  });

  it("requires explicit run-wide limits for live runs, rejects bad values, and allows none for fixture runs", () => {
    const get = (m: Record<string, string>) => (n: string) => m[n];
    expect(parseRunLimits(get({}), false)).toBeUndefined();
    expect(() => parseRunLimits(get({}), true)).toThrow(/explicit run-wide limit/);
    expect(() => parseRunLimits(get({ "max-calls": "20" }), true)).toThrow(/--max-input-tokens is required/);
    expect(() => parseRunLimits(get({ "max-calls": "-1", "max-input-tokens": "1", "max-output-tokens": "1" }), true)).toThrow(/non-negative/);
    expect(parseRunLimits(get({ "max-calls": "60", "max-input-tokens": "500000", "max-output-tokens": "400000", "max-cost-usd": "1.5" }), true)).toEqual({ maxCalls: 60, maxInputTokens: 500000, maxOutputTokens: 400000, maxCostUsd: 1.5 });
  });
});

describe("pilot plan (dry run)", () => {
  it("selects five distinct development cases, never held-out, with varied roles", () => {
    const sel = selectPilotCases(loadCases());
    expect(sel).toHaveLength(5);
    expect(new Set(sel.map((s) => s.c.id)).size).toBe(5);
    expect(sel.every((s) => !s.c.heldOut)).toBe(true);
    expect(new Set(sel.map((s) => s.role)).size).toBe(5);
    expect(sel.some((s) => s.c.category === "clear")).toBe(true);
    expect(sel.some((s) => s.c.expectedContradictions.length > 0)).toBe(true);
    expect(PILOT_SYSTEMS).toEqual(["single_prompt", "staged"]);
  });

  it("plans from local data only: zero provider calls, honest about unknown later-stage sizes and limits", () => {
    const provider = capturing();
    const plan = planPilot({ cases: selectPilotCases(loadCases()), systems: PILOT_SYSTEMS, prices: { inPerMTok: 1, outPerMTok: 2 }, providerTokenLimit: 8000 });
    const text = renderPlan(plan, { providerLabel: provider.info.label, systems: PILOT_SYSTEMS, providerTokenLimit: 8000, runLimitsSet: false });
    expect(provider.calls).toHaveLength(0);
    expect(plan.callsBeforeRetries).toBe(20); // 5 single + 15 staged
    expect(plan.rows.filter((r) => r.stage === "analyze").every((r) => r.known)).toBe(true);
    expect(plan.rows.filter((r) => r.stage === "clarify" || r.stage === "brief").every((r) => !r.known && r.inputHigh > r.inputLow)).toBe(true);
    expect(plan.costCeilingWithRetriesUsd!).toBeGreaterThan(plan.costCeilingBeforeRetriesUsd!);
    expect(plan.oversize.length).toBeGreaterThan(0);
    expect(text).toContain("DRY RUN: no provider calls were made");
    expect(text).toContain("depends on earlier model output");
    expect(text).toContain("NOT SET");
    expect(text).toContain("nothing here guarantees the provider's final bill");
  });
});
