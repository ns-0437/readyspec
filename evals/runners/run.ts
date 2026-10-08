/**
 * Benchmark runner.
 *   npm run eval -- [--pilot] [--dry-run] [--max-calls N --max-input-tokens N --max-output-tokens N [--max-cost-usd X]] [--provider fixture|anthropic|gemini|groq] [--set dev|heldout|all] [--systems checklist,single,staged,single_alphabetical] [--cases id,id] [--repeat N]
 * Every run gets its own directory, evals/results/runs/<provider>-<set>-<timestamp>-<id>/, holding:
 *   run.json            configuration and status (in_progress | complete | interrupted)
 *   results/rep<N>/     one immutable JSON per case x system x repetition, saved as each finishes (failures too)
 *   scoring-sheet.csv   human scoring sheet (live providers only), write-once, one row per saved result
 *   summary.json        per-repetition aggregates plus the overall aggregate over ALL repetitions
 *   report.md           rendered report (overall, with per-repetition variance)
 * evals/results/<provider>-<set>-latest.md is a replaceable convenience copy of report.md.
 *
 * With the fixture provider, every metric that depends on model output is reported as n/a. Only
 * deterministic results (the static checklist, and the staged workflow's retrieval) are real.
 */
import fs from "node:fs";
import path from "node:path";
import { createProvider } from "@/server/llm";
import { Budget, getPrices, type Prices } from "@/server/llm/budget";
import type { LlmProvider } from "@/server/llm/provider";
import type { SessionLimits, Usage } from "@/shared/schemas";
import { loadCases } from "./cases";
import type { EvalCase } from "./schema";
import { renderReport, renderVariance } from "./report";
import { aggregate, scoreRun, type Aggregate, type CaseScore, type SystemName, type SystemOutput } from "./score";
import { atomicWrite, createRunDir, humanSheet, saveResult, writeOnce } from "./store";
import { PILOT_SYSTEMS, planPilot, renderPlan, selectPilotCases } from "./pilot";
import { runChecklist, runSinglePrompt, runSinglePromptAlphabetical, runStaged } from "./systems";

const RESULTS_DIR = path.resolve(__dirname, "..", "results");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

export interface RunOptions {
  provider: LlmProvider;
  set: string;
  cases: EvalCase[];
  systems: SystemName[];
  repeat: number;
  resultsDir: string;
  /** Run-wide limits shared by every case, system, repetition and retry. Unset means no run-wide limit. */
  runLimits?: SessionLimits;
  /** Prices for the run budget's dollar estimate; defaults to the environment. */
  prices?: Prices | null;
  /** Test seam: defaults to the real systems. */
  execute?: (system: SystemName, c: EvalCase, provider: LlmProvider, runBudget?: Budget) => Promise<SystemOutput>;
  argv?: string[];
}

const realExecute = (system: SystemName, c: EvalCase, provider: LlmProvider, runBudget?: Budget): Promise<SystemOutput> =>
  system === "checklist"
    ? runChecklist()
    : system === "single_prompt"
      ? runSinglePrompt(c, provider, runBudget)
      : system === "single_prompt_alphabetical"
        ? runSinglePromptAlphabetical(c, provider, undefined, runBudget)
        : runStaged(c, provider, runBudget);

const NO_USAGE: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, estimated: false };

export interface PlannedItem {
  repetition: number;
  caseId: string;
  system: SystemName;
}

export async function runBenchmark(o: RunOptions): Promise<{ runDir: string; aggsByRun: Aggregate[][]; overall: Aggregate[]; report: string; budgetExhausted: boolean; notRun: PlannedItem[] }> {
  const { provider, set, cases, systems, repeat } = o;
  const execute = o.execute ?? realExecute;
  const live = provider.info.kind !== "fixture";
  // Built before anything is written: an unusable limit configuration must not leave a half-made run.
  const runBudget = o.runLimits ? new Budget(o.runLimits, NO_USAGE, o.prices === undefined ? getPrices() : o.prices, "run") : undefined;
  const runDir = createRunDir(path.join(o.resultsDir, "runs"), `${provider.info.kind}-${set}`);
  const meta = { provider: provider.info, set, systems, repeat, cases: cases.map((c) => c.id), runLimits: o.runLimits ?? null, argv: o.argv ?? [], startedAt: new Date().toISOString() };
  const writeMeta = (status: string, extra: Record<string, unknown> = {}) => atomicWrite(path.join(runDir, "run.json"), JSON.stringify({ ...meta, status, updatedAt: new Date().toISOString(), ...extra }, null, 2));
  writeMeta("in_progress");
  if (live) writeOnce(path.join(runDir, "scoring-sheet.csv"), humanSheet(cases, systems, repeat));

  const plan: { rep: number; c: EvalCase; system: SystemName }[] = [];
  for (let rep = 1; rep <= repeat; rep++) for (const c of cases) for (const system of systems) plan.push({ rep, c, system });

  const allOutputs: SystemOutput[] = []; // completed (scored) outputs only
  const allScores: CaseScore[] = [];
  const reportedByCases = { input: 0, output: 0 }; // usage reported by per-case accounting, including the interrupted case
  const perRep: { outputs: SystemOutput[]; scores: CaseScore[] }[] = Array.from({ length: repeat }, () => ({ outputs: [], scores: [] }));
  const provInfo = { kind: provider.info.kind, label: provider.info.label, model: provider.info.model };
  let interrupted: (PlannedItem & { error: string }) | null = null;
  const notRun: PlannedItem[] = [];
  try {
    for (let i = 0; i < plan.length; i++) {
      const { rep, c, system } = plan[i]!;
      if (repeat > 1 && (i === 0 || plan[i - 1]!.rep !== rep)) console.log(`Run ${rep}/${repeat}`);
      const output = await execute(system, c, provider, runBudget);
      reportedByCases.input += output.usage.inputTokens;
      reportedByCases.output += output.usage.outputTokens;
      if (output.budgetExhausted) {
        // Run-wide budget refusal: not a quality failure. Keep the partial output, do not score it, stop dispatching.
        saveResult(runDir, { caseId: c.id, system, repetition: rep, provider: provInfo, savedAt: new Date().toISOString(), status: "budget_exhausted", output, score: null });
        interrupted = { repetition: rep, caseId: c.id, system, error: output.error ?? "run-wide budget exhausted" };
        for (const r of plan.slice(i + 1)) notRun.push({ repetition: r.rep, caseId: r.c.id, system: r.system });
        process.stdout.write(`  [rep ${rep}] ${c.id} ${system} STOPPED: ${interrupted.error}\n`);
        break;
      }
      const score: CaseScore = { ...scoreRun(c, output), repetition: rep };
      saveResult(runDir, { caseId: c.id, system, repetition: rep, provider: provInfo, savedAt: new Date().toISOString(), status: "completed", output, score });
      perRep[rep - 1]!.outputs.push(output);
      perRep[rep - 1]!.scores.push(score);
      allOutputs.push(output);
      allScores.push(score);
      process.stdout.write(`  [rep ${rep}] ${c.id} ${system}${output.error ? " ERROR: " + output.error : ""}\n`);
    }
  } catch (e) {
    writeMeta("interrupted", { error: (e as Error).message, savedResults: allScores.length });
    throw e;
  }
  const exhausted = interrupted !== null;

  // Accounting ownership: runBudget owns the run-wide figures; per-case usage (SystemOutput.usage) owns each case's
  // own figures. Both are updated once per request by generateStructured, so they must agree; the check below proves it.
  const totals = runBudget?.totals() ?? null;
  const accounting = {
    limits: o.runLimits ?? null,
    exhausted,
    runBudget: totals,
    perCaseReportedSum: { inputTokens: reportedByCases.input, outputTokens: reportedByCases.output },
    reconciled: totals ? totals.reportedInputTokens === reportedByCases.input && totals.reportedOutputTokens === reportedByCases.output : null,
    interrupted,
    notRun,
    note: "uncertain* figures are estimated exposure of requests that returned no usage, not actual usage; estimatedCostUsd is an estimate, not a bill.",
  };
  atomicWrite(path.join(runDir, "run-accounting.json"), JSON.stringify(accounting, null, 2));

  const agg = (scores: CaseScore[], outputs: SystemOutput[]) => systems.map((s) => aggregate(s, scores.filter((x) => x.system === s), outputs.filter((x) => x.system === s)));
  const aggsByRun = perRep.map((r) => agg(r.scores, r.outputs));
  const overall = agg(allScores, allOutputs); // pooled over EVERY repetition, never just the last
  const budgetNote = exhausted
    ? `\n**Run-wide budget exhausted** (not a model-quality failure): stopped at ${interrupted!.caseId} / ${interrupted!.system} (rep ${interrupted!.repetition}); that case is saved but NOT scored, and ${notRun.length} planned result(s) were NOT RUN. Tables above cover completed outputs only. Details: run-accounting.json.\n`
    : "";
  const report =
    renderReport({ provider, set, aggs: overall, scores: allScores, outputs: allOutputs, cases }) +
    `\n## Run\n\nOverall tables above pool all ${repeat} repetition(s) (${allScores.length} saved scored results). Per-repetition aggregates are in summary.json; raw results are in ${path.relative(o.resultsDir, runDir).split(path.sep).join("/")}/results.\n` +
    budgetNote +
    (repeat > 1 ? renderVariance(aggsByRun, !live) : "");
  atomicWrite(path.join(runDir, "summary.json"), JSON.stringify({ provider: provider.info, set, repeat, perRepetition: aggsByRun, overall, budget: accounting }, null, 2));
  atomicWrite(path.join(runDir, "report.md"), report);
  atomicWrite(path.join(o.resultsDir, `${provider.info.kind}-${set}-latest.md`), report);
  writeMeta(exhausted ? "budget_exhausted" : "complete", { savedResults: allScores.length, notRun: notRun.length });
  return { runDir, aggsByRun, overall, report, budgetExhausted: exhausted, notRun };
}

/** Parses --max-calls/--max-input-tokens/--max-output-tokens/--max-cost-usd. A live (non-fixture) run must set the first three. */
export function parseRunLimits(get: (name: string) => string | undefined, live: boolean): SessionLimits | undefined {
  const names = ["max-calls", "max-input-tokens", "max-output-tokens", "max-cost-usd"] as const;
  const raw = Object.fromEntries(names.map((n) => [n, get(n)?.trim() || undefined]));
  const given = names.filter((n) => raw[n] !== undefined);
  if (given.length === 0) {
    if (live) {
      throw new Error(
        "A live run needs an explicit run-wide limit so spending is bounded across all cases, systems and retries. Pass --max-calls, --max-input-tokens and --max-output-tokens (and optionally --max-cost-usd, which also needs both READYSPEC_PRICE_* values). Use --dry-run first to see the plan and a worst-case allowance.",
      );
    }
    return undefined;
  }
  const value = (n: (typeof names)[number], required: boolean): number => {
    const v = raw[n];
    if (v === undefined) {
      if (required) throw new Error(`--${n} is required when a run-wide limit is set (a live run needs --max-calls, --max-input-tokens and --max-output-tokens)`);
      return Infinity;
    }
    const x = Number(v);
    if (!Number.isFinite(x) || x < 0) throw new Error(`--${n} must be a finite non-negative number, got "${v}"`);
    return x;
  };
  const cost = raw["max-cost-usd"] === undefined ? null : value("max-cost-usd", false);
  return { maxCalls: value("max-calls", live), maxInputTokens: value("max-input-tokens", live), maxOutputTokens: value("max-output-tokens", live), maxCostUsd: cost };
}

async function main() {
  const flag = (name: string) => process.argv.includes(`--${name}`);
  const pilot = flag("pilot");
  const dryRun = flag("dry-run");
  const set = pilot ? "dev" : arg("set", "dev");
  const systems = (pilot ? PILOT_SYSTEMS : (arg("systems", "checklist,single,staged").split(",").map((s) => (s === "single" ? "single_prompt" : s === "single_alphabetical" ? "single_prompt_alphabetical" : s)) as SystemName[]));
  const only = arg("cases", "").split(",").filter(Boolean);
  const provider = createProvider(arg("provider", "") ? { ...process.env, READYSPEC_PROVIDER: arg("provider", "") } : process.env);
  const live = provider.info.kind !== "fixture";
  const argValue = (n: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : undefined);

  let cases = loadCases();
  let roles: { c: EvalCase; role: string }[];
  if (pilot) {
    roles = selectPilotCases(cases); // development cases only; held-out cases are never touched
    cases = roles.map((r) => r.c);
  } else {
    if (set === "dev") cases = cases.filter((c) => !c.heldOut);
    else if (set === "heldout") cases = cases.filter((c) => c.heldOut && c.cohort === "v1");
    else if (set === "heldout-v2") cases = cases.filter((c) => c.heldOut && c.cohort === "v2");
    else if (set !== "all") throw new Error("--set must be dev, heldout, heldout-v2 or all");
    if (only.length) cases = cases.filter((c) => only.includes(c.id));
    roles = cases.map((c) => ({ c, role: "selected" }));
    if (set !== "dev") console.warn("NOTE: held-out cases should be run once, after the code is frozen. Do not tune against them.");
  }
  const repeat = Math.max(1, Number(arg("repeat", "1")) || 1);

  if (dryRun) {
    const limit = Number(argValue("provider-token-limit")) || undefined;
    const runLimits = parseRunLimits(argValue, false);
    const plan = planPilot({ cases: roles, systems, prices: getPrices(), providerTokenLimit: limit });
    console.log(renderPlan(plan, { providerLabel: provider.info.label, systems, providerTokenLimit: limit, runLimitsSet: runLimits !== undefined }));
    if (repeat > 1) console.log(`\nNote: the figures above are for ONE repetition; this command asks for ${repeat}.`);
    return; // no provider call, no run directory
  }

  const runLimits = parseRunLimits(argValue, live);
  console.log(`Running ${cases.length} case(s) x [${systems.join(", ")}] with ${provider.info.label}${runLimits ? `; run-wide limits ${JSON.stringify(runLimits)}` : ""}`);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const { runDir, report } = await runBenchmark({ provider, set, cases, systems, repeat, resultsDir: RESULTS_DIR, runLimits, argv: process.argv.slice(2) });
  console.log(report);
  console.log(`Run saved in ${runDir}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
