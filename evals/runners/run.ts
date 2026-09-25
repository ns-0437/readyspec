/**
 * Benchmark runner.
 *   npm run eval -- [--provider fixture|anthropic|gemini|groq] [--set dev|heldout|all] [--systems checklist,single,staged] [--cases id,id]
 * Results: evals/results/<provider>-<set>-<timestamp>.json and <provider>-<set>-latest.md
 *
 * With the fixture provider, every metric that depends on model output is reported as n/a. Only
 * deterministic results (the static checklist, and the staged workflow's retrieval) are real.
 */
import fs from "node:fs";
import path from "node:path";
import { createProvider } from "@/server/llm";
import { loadCases } from "./cases";
import type { EvalCase } from "./schema";
import { renderReport, renderVariance } from "./report";
import { aggregate, scoreRun, type Aggregate, type CaseScore, type SystemName, type SystemOutput } from "./score";
import { runChecklist, runSinglePrompt, runStaged } from "./systems";

const RESULTS_DIR = path.resolve(__dirname, "..", "results");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

function humanSheet(cases: EvalCase[], systems: SystemName[]): string {
  const head = ["case_id", "system", "held_out", "brief_usable_as_is(0-2)", "critical_gaps_missed(count)", "wrong_or_unsupported_claims(count)", "unnecessary_questions(count)", "minutes_to_make_usable", "reviewer", "notes"];
  const rows = [head.join(",")];
  for (const c of cases) for (const s of systems) rows.push([c.id, s, c.heldOut ? "yes" : "no", "", "", "", "", "", "", ""].join(","));
  return rows.join("\n") + "\n";
}

async function main() {
  const set = arg("set", "dev");
  const systems = arg("systems", "checklist,single,staged").split(",").map((s) => (s === "single" ? "single_prompt" : s)) as SystemName[];
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
  let outputs: SystemOutput[] = [];
  let scores: CaseScore[] = [];
  const aggsByRun: Aggregate[][] = [];
  for (let run = 1; run <= repeat; run++) {
    outputs = [];
    scores = [];
    if (repeat > 1) console.log(`Run ${run}/${repeat}`);
    for (const c of cases) {
      for (const system of systems) {
        const out = system === "checklist" ? await runChecklist() : system === "single_prompt" ? await runSinglePrompt(c, provider) : await runStaged(c, provider);
        outputs.push(out);
        scores.push(scoreRun(c, out));
        process.stdout.write(`  ${c.id} ${system}${out.error ? " ERROR: " + out.error : ""}\n`);
      }
    }
    aggsByRun.push(systems.map((s) => aggregate(s, scores.filter((x) => x.system === s), outputs.filter((o) => o.system === s))));
  }
  // Full tables come from the last run; with --repeat, a variance section shows the spread across runs.
  const aggs = aggsByRun[aggsByRun.length - 1] as Aggregate[];
  const report = renderReport({ provider, set, aggs, scores, outputs, cases }) + (repeat > 1 ? renderVariance(aggsByRun, provider.info.kind === "fixture") : "");

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${provider.info.kind}-${set}`;
  fs.writeFileSync(path.join(RESULTS_DIR, `${base}-${stamp}.json`), JSON.stringify({ provider: provider.info, set, cases: cases.map((c) => c.id), aggs, scores, outputs }, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, `${base}-latest.md`), report);
  if (provider.info.kind !== "fixture") fs.writeFileSync(path.join(RESULTS_DIR, `human-scoring-sheet-${set}.csv`), humanSheet(cases, systems));
  console.log("\n" + report);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
