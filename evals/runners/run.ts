/**
 * Benchmark runner.
 *   npm run eval -- [--provider fixture|anthropic] [--set dev|heldout|all] [--systems checklist,single,staged] [--cases id,id]
 * Results: evals/results/<provider>-<set>-<timestamp>.json and <provider>-<set>-latest.md
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
import { aggregate, scoreRun, type Aggregate, type CaseScore, type SystemName, type SystemOutput } from "./score";
import { runChecklist, runSinglePrompt, runStaged } from "./systems";

const RESULTS_DIR = path.resolve(__dirname, "..", "results");

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);
const num = (x: number | null, d = 2) => (x === null ? "n/a" : x.toFixed(d));

const LABEL: Record<SystemName, string> = { checklist: "Static checklist", single_prompt: "Single prompt", staged: "ReadySpec staged" };

/** Which aggregate fields are real (not derived from model output) for a system under the fixture provider. */
function realUnderFixture(system: SystemName, field: keyof Aggregate): boolean {
  if (system === "checklist") return true;
  if (system === "staged") return ["retrievalRecallRequired", "retrievalPrecision", "distractorFilesPerCase", "cases", "failed", "system"].includes(field);
  return ["cases", "system"].includes(field);
}

export function renderReport(opts: { provider: LlmProvider; set: string; aggs: Aggregate[]; scores: CaseScore[]; outputs: SystemOutput[]; cases: EvalCase[] }): string {
  const { provider, set, aggs, scores, outputs, cases } = opts;
  const fixture = provider.info.kind === "fixture";
  const cell = (a: Aggregate, field: keyof Aggregate, f: (v: number | null) => string): string => {
    if (fixture && !realUnderFixture(a.system, field)) return "n/a (fixture)";
    return f(a[field] as number | null);
  };
  const L: string[] = [];
  L.push(`# Benchmark results: ${set} set, provider "${provider.info.label}"`, "");
  if (fixture) {
    L.push("> **Fixture provider run.** No language model produced any output here. Metrics that depend on model output are marked n/a. The static-checklist column and the staged workflow's retrieval columns are real (deterministic). Do not read this as a model-quality result.", "");
  } else {
    L.push(`> Live run against ${provider.info.label}. Ambiguity/assumption/contradiction scores use keyword matching (see evals/rubrics); treat them as an approximation and confirm with the human rubric.`, "");
  }
  L.push(`Cases: ${cases.length} (${cases.filter((c) => c.heldOut).length} held out). Generated ${new Date().toISOString()}.`, "");

  const rows: [string, keyof Aggregate, (v: number | null) => string][] = [
    ["Required-file recall (retrieval)", "retrievalRecallRequired", pct],
    ["Precision of files used", "retrievalPrecision", pct],
    ["Distractor files used / case", "distractorFilesPerCase", (v) => num(v)],
    ["Citation validity", "citationValidity", pct],
    ["Observed claims supported by cited code", "observationsSupportedRate", pct],
    ["Critical ambiguities asked", "ambiguityRecallAsked", pct],
    ["Critical ambiguities surfaced anywhere", "ambiguityRecallSurfaced", pct],
    ["Questions / case", "questionsPerCase", (v) => num(v, 1)],
    ["Unnecessary question rate", "unnecessaryQuestionRate", pct],
    ["Expected contradictions noticed", "contradictionRecall", pct],
    ["Insufficient evidence acknowledged", "insufficientEvidenceAcknowledged", pct],
    ["Unacceptable assumptions (count)", "assumptionViolations", (v) => String(v)],
    ["Followed planted injection (cases)", "injectionFollowedCount", (v) => String(v)],
    ["Reviewer-flag proxy / case", "flagsPerCase", (v) => num(v, 1)],
    ["Mean latency (ms)", "latencyMsMean", (v) => (v === null ? "n/a" : v.toFixed(0))],
    ["Input tokens (total)", "inputTokens", (v) => String(v)],
    ["Output tokens (total)", "outputTokens", (v) => String(v)],
    ["Cost (USD, needs READYSPEC_PRICE_*)", "costUsd", (v) => (v === null ? "n/a" : `$${v.toFixed(4)}`)],
    ["Failed cases (system error)", "failed", (v) => String(v)],
  ];
  L.push(`| Metric | ${aggs.map((a) => LABEL[a.system]).join(" | ")} |`, `|---|${aggs.map(() => "---").join("|")}|`);
  for (const [name, field, f] of rows) L.push(`| ${name} | ${aggs.map((a) => cell(a, field, f)).join(" | ")} |`);

  const ctxNote = outputs.find((o) => o.system === "single_prompt" && o.context);
  if (ctxNote?.context) {
    const truncatedCases = outputs.filter((o) => o.system === "single_prompt" && o.context?.truncated).length;
    L.push("", `Single-prompt baseline context: ${truncatedCases} of ${outputs.filter((o) => o.system === "single_prompt").length} cases were truncated to the ${24_000}-character budget; otherwise it saw the whole repository (so retrieval gives ReadySpec no advantage on small repositories).`);
  }

  L.push("", "## Per-case detail (staged workflow and checklist)", "", "| Case | Held out | System | Req. files | Missed required | Ambiguities asked | Missed | Unnecessary Qs | Violations | Contradictions |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const s of scores) {
    const c = cases.find((x) => x.id === s.caseId)!;
    if (fixture && s.system !== "checklist" && s.system !== "staged") continue;
    const modelCells = fixture && s.system === "staged";
    const n = (v: string) => (modelCells ? "n/a" : v);
    L.push(`| ${s.caseId} | ${c.heldOut ? "yes" : ""} | ${LABEL[s.system]} | ${pct(s.retrieval.recallRequired)} | ${s.retrieval.missedRequired.join(", ") || "-"} | ${n(`${s.ambiguity.coveredAsked.length}/${s.ambiguity.total}`)} | ${n(s.ambiguity.missedAsked.join(", ") || "-")} | ${n(String(s.questions.unnecessary))} | ${n(s.assumptions.violations.map((v) => v.id).join(", ") || "-")} | ${n(s.contradictions.applicable ? `${s.contradictions.covered.length}/${s.contradictions.covered.length + s.contradictions.missed.length}` : "-")} |`);
  }
  L.push("");
  return L.join("\n");
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
  else if (set === "heldout") cases = cases.filter((c) => c.heldOut);
  else if (set !== "all") throw new Error("--set must be dev, heldout or all");
  if (only.length) cases = cases.filter((c) => only.includes(c.id));
  if (set !== "dev") console.warn("NOTE: held-out cases should be run once, after the code is frozen. Do not tune against them.");
  console.log(`Running ${cases.length} case(s) x [${systems.join(", ")}] with ${provider.info.label}`);

  const outputs: SystemOutput[] = [];
  const scores: CaseScore[] = [];
  for (const c of cases) {
    for (const system of systems) {
      const out = system === "checklist" ? await runChecklist() : system === "single_prompt" ? await runSinglePrompt(c, provider) : await runStaged(c, provider);
      outputs.push(out);
      scores.push(scoreRun(c, out));
      process.stdout.write(`  ${c.id} ${system}${out.error ? " ERROR: " + out.error : ""}\n`);
    }
  }
  const aggs = systems.map((s) => aggregate(s, scores.filter((x) => x.system === s), outputs.filter((o) => o.system === s)));
  const report = renderReport({ provider, set, aggs, scores, outputs, cases });

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${provider.info.kind}-${set}`;
  fs.writeFileSync(path.join(RESULTS_DIR, `${base}-${stamp}.json`), JSON.stringify({ provider: provider.info, set, cases: cases.map((c) => c.id), aggs, scores, outputs }, null, 2));
  fs.writeFileSync(path.join(RESULTS_DIR, `${base}-latest.md`), report);
  if (provider.info.kind === "anthropic") fs.writeFileSync(path.join(RESULTS_DIR, `human-scoring-sheet-${set}.csv`), humanSheet(cases, systems));
  console.log("\n" + report);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
