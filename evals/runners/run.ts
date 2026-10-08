/**
 * Benchmark runner.
 *   npm run eval -- [--provider fixture|anthropic|gemini|groq] [--set dev|heldout|all] [--systems checklist,single,staged,single_alphabetical] [--cases id,id] [--repeat N]
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
import type { LlmProvider } from "@/server/llm/provider";
import { loadCases } from "./cases";
import type { EvalCase } from "./schema";
import { renderReport, renderVariance } from "./report";
import { aggregate, scoreRun, type Aggregate, type CaseScore, type SystemName, type SystemOutput } from "./score";
import { atomicWrite, createRunDir, humanSheet, saveResult, writeOnce } from "./store";
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
  /** Test seam: defaults to the real systems. */
  execute?: (system: SystemName, c: EvalCase, provider: LlmProvider) => Promise<SystemOutput>;
  argv?: string[];
}

const realExecute = (system: SystemName, c: EvalCase, provider: LlmProvider): Promise<SystemOutput> =>
  system === "checklist" ? runChecklist() : system === "single_prompt" ? runSinglePrompt(c, provider) : system === "single_prompt_alphabetical" ? runSinglePromptAlphabetical(c, provider) : runStaged(c, provider);

export async function runBenchmark(o: RunOptions): Promise<{ runDir: string; aggsByRun: Aggregate[][]; overall: Aggregate[]; report: string }> {
  const { provider, set, cases, systems, repeat } = o;
  const execute = o.execute ?? realExecute;
  const live = provider.info.kind !== "fixture";
  const runDir = createRunDir(path.join(o.resultsDir, "runs"), `${provider.info.kind}-${set}`);
  const meta = { provider: provider.info, set, systems, repeat, cases: cases.map((c) => c.id), argv: o.argv ?? [], startedAt: new Date().toISOString() };
  const writeMeta = (status: string, extra: Record<string, unknown> = {}) => atomicWrite(path.join(runDir, "run.json"), JSON.stringify({ ...meta, status, updatedAt: new Date().toISOString(), ...extra }, null, 2));
  writeMeta("in_progress");
  if (live) writeOnce(path.join(runDir, "scoring-sheet.csv"), humanSheet(cases, systems, repeat));

  const allOutputs: SystemOutput[] = [];
  const allScores: CaseScore[] = [];
  const perRep: { outputs: SystemOutput[]; scores: CaseScore[] }[] = [];
  try {
    for (let rep = 1; rep <= repeat; rep++) {
      const cur = { outputs: [] as SystemOutput[], scores: [] as CaseScore[] };
      perRep.push(cur);
      if (repeat > 1) console.log(`Run ${rep}/${repeat}`);
      for (const c of cases) {
        for (const system of systems) {
          const output = await execute(system, c, provider);
          const score: CaseScore = { ...scoreRun(c, output), repetition: rep };
          saveResult(runDir, { caseId: c.id, system, repetition: rep, provider: { kind: provider.info.kind, label: provider.info.label, model: provider.info.model }, savedAt: new Date().toISOString(), output, score });
          cur.outputs.push(output);
          cur.scores.push(score);
          allOutputs.push(output);
          allScores.push(score);
          process.stdout.write(`  [rep ${rep}] ${c.id} ${system}${output.error ? " ERROR: " + output.error : ""}\n`);
        }
      }
    }
  } catch (e) {
    writeMeta("interrupted", { error: (e as Error).message, savedResults: allScores.length });
    throw e;
  }

  const agg = (scores: CaseScore[], outputs: SystemOutput[]) => systems.map((s) => aggregate(s, scores.filter((x) => x.system === s), outputs.filter((x) => x.system === s)));
  const aggsByRun = perRep.map((r) => agg(r.scores, r.outputs));
  const overall = agg(allScores, allOutputs); // pooled over EVERY repetition, never just the last
  const report =
    renderReport({ provider, set, aggs: overall, scores: allScores, outputs: allOutputs, cases }) +
    `\n## Run\n\nOverall tables above pool all ${repeat} repetition(s) (${allScores.length} saved results). Per-repetition aggregates are in summary.json; raw results are in ${path.relative(o.resultsDir, runDir).split(path.sep).join("/")}/results.\n` +
    (repeat > 1 ? renderVariance(aggsByRun, !live) : "");
  atomicWrite(path.join(runDir, "summary.json"), JSON.stringify({ provider: provider.info, set, repeat, perRepetition: aggsByRun, overall }, null, 2));
  atomicWrite(path.join(runDir, "report.md"), report);
  atomicWrite(path.join(o.resultsDir, `${provider.info.kind}-${set}-latest.md`), report);
  writeMeta("complete", { savedResults: allScores.length });
  return { runDir, aggsByRun, overall, report };
}

async function main() {
  const set = arg("set", "dev");
  const systems = arg("systems", "checklist,single,staged").split(",").map((s) => (s === "single" ? "single_prompt" : s === "single_alphabetical" ? "single_prompt_alphabetical" : s)) as SystemName[];
  const only = arg("cases", "").split(",").filter(Boolean);
  const provider = createProvider(arg("provider", "") ? { ...process.env, READYSPEC_PROVIDER: arg("provider", "") } : process.env);

  let cases = loadCases();
  if (set === "dev") cases = cases.filter((c) => !c.heldOut);
  else if (set === "heldout") cases = cases.filter((c) => c.heldOut && c.cohort === "v1");
  else if (set === "heldout-v2") cases = cases.filter((c) => c.heldOut && c.cohort === "v2");
  else if (set !== "all") throw new Error("--set must be dev, heldout, heldout-v2 or all");
  if (only.length) cases = cases.filter((c) => only.includes(c.id));
  if (set !== "dev") console.warn("NOTE: held-out cases should be run once, after the code is frozen. Do not tune against them.");
  console.log(`Running ${cases.length} case(s) x [${systems.join(", ")}] with ${provider.info.label}`);

  const repeat = Math.max(1, Number(arg("repeat", "1")) || 1);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const { runDir, report } = await runBenchmark({ provider, set, cases, systems, repeat, resultsDir: RESULTS_DIR, argv: process.argv.slice(2) });
  console.log(report);
  console.log(`Run saved in ${runDir}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
