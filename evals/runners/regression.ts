/**
 * Deterministic retrieval-regression check. Runs the fixture provider only (no model, no key
 * needed) against the full dev set and compares the staged workflow's retrieval numbers to a
 * checked-in baseline. Meant for CI: a scheduled workflow and a pre-merge check on changes to
 * retrieval-relevant code, so a change to search.ts, filters.ts or the fixture repositories that
 * quietly worsens recall/precision gets caught instead of drifting unnoticed.
 *
 *   npx tsx evals/runners/regression.ts                 # compare against the baseline; exits 1 on regression
 *   npx tsx evals/runners/regression.ts --write-baseline # recompute and overwrite the baseline file
 *
 * This intentionally checks only retrieval (recall/precision/distractors), which is deterministic
 * and needs no model. It says nothing about clarification quality, brief quality or anything else
 * model-dependent -- see docs/evaluation.md and evals/REPORT.md for those, which do need a key.
 */
import fs from "node:fs";
import path from "node:path";
import { loadCases } from "./cases";
import { aggregate, scoreRun, type Aggregate } from "./score";
import { runStaged } from "./systems";
import { FixtureProvider } from "@/server/llm/fixture";

export const BASELINE_PATH = path.resolve(__dirname, "..", "baseline-retrieval.json");

export interface RetrievalBaseline {
  generatedAt: string;
  cases: number;
  recallRequired: number;
  precision: number;
  distractorsPerCase: number;
}

/** Percentage-point tolerance before a drop counts as a regression. A rise never fails. */
export const TOLERANCE = { recallRequired: 0.02, precision: 0.03, distractorsPerCase: 0.15 };

export interface RegressionResult {
  ok: boolean;
  current: RetrievalBaseline;
  baseline: RetrievalBaseline | null;
  issues: string[];
}

/** Pure comparison, unit-testable without running the eval. A metric worsening beyond its tolerance is an issue; improving never is. */
export function compareToBaseline(current: RetrievalBaseline, baseline: RetrievalBaseline | null): RegressionResult {
  if (!baseline) return { ok: true, current, baseline, issues: ["no baseline on disk yet; nothing to compare against"] };
  const issues: string[] = [];
  const worse = (name: keyof typeof TOLERANCE, better: "higher" | "lower") => {
    const delta = current[name] - baseline[name];
    const regressed = better === "higher" ? delta < -TOLERANCE[name] : delta > TOLERANCE[name];
    if (regressed) issues.push(`${name}: ${baseline[name].toFixed(3)} -> ${current[name].toFixed(3)} (tolerance ${TOLERANCE[name]})`);
  };
  worse("recallRequired", "higher");
  worse("precision", "higher");
  worse("distractorsPerCase", "lower");
  return { ok: issues.length === 0, current, baseline, issues };
}

async function computeCurrent(): Promise<RetrievalBaseline> {
  const cases = loadCases().filter((c) => !c.heldOut);
  const provider = new FixtureProvider();
  const outputs = [];
  for (const c of cases) outputs.push(await runStaged(c, provider));
  const scores = outputs.map((o, i) => scoreRun(cases[i]!, o));
  const agg: Aggregate = aggregate("staged", scores, outputs);
  return {
    generatedAt: new Date().toISOString(),
    cases: cases.length,
    recallRequired: agg.retrievalRecallRequired ?? 0,
    precision: agg.retrievalPrecision ?? 0,
    distractorsPerCase: agg.distractorFilesPerCase ?? 0,
  };
}

async function main() {
  const writeBaseline = process.argv.includes("--write-baseline");
  const current = await computeCurrent();

  if (writeBaseline) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
    console.log(`Wrote baseline: recall ${(current.recallRequired * 100).toFixed(1)}%, precision ${(current.precision * 100).toFixed(1)}%, distractors/case ${current.distractorsPerCase.toFixed(2)} (${current.cases} cases).`);
    return;
  }

  const baseline: RetrievalBaseline | null = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) : null;
  const result = compareToBaseline(current, baseline);
  console.log(`Current:  recall ${(current.recallRequired * 100).toFixed(1)}%, precision ${(current.precision * 100).toFixed(1)}%, distractors/case ${current.distractorsPerCase.toFixed(2)} (${current.cases} cases)`);
  if (baseline) console.log(`Baseline: recall ${(baseline.recallRequired * 100).toFixed(1)}%, precision ${(baseline.precision * 100).toFixed(1)}%, distractors/case ${baseline.distractorsPerCase.toFixed(2)} (${baseline.cases} cases, ${baseline.generatedAt})`);
  if (result.issues.length) console.log(result.ok ? "Notes:" : "REGRESSIONS:", result.issues.join("; "));
  if (!result.ok) {
    console.error(`\nRetrieval regressed beyond tolerance. If this is an intentional trade-off (see docs/decisions.md), rerun with --write-baseline and explain why in the PR.`);
    process.exit(1);
  }
  console.log("\nNo regression.");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
