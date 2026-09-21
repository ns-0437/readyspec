import type { LlmProvider } from "@/server/llm/provider";
import type { EvalCase } from "./schema";
import type { Aggregate, CaseScore, SystemName, SystemOutput } from "./score";

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);
const num = (x: number | null, d = 2) => (x === null ? "n/a" : x.toFixed(d));

export const LABEL: Record<SystemName, string> = { checklist: "Static checklist", single_prompt: "Single prompt", staged: "ReadySpec staged" };

/** Which aggregate fields are real (not derived from model output) for a system under the fixture provider. */
export function realUnderFixture(system: SystemName, field: keyof Aggregate): boolean {
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

/** mean (min-max) across repeated runs for the metrics most sensitive to model variance. */
export function renderVariance(runs: Aggregate[][], fixture: boolean): string {
  const fields: [string, keyof Aggregate, (v: number) => string][] = [
    ["Critical ambiguities asked", "ambiguityRecallAsked", (v) => `${(v * 100).toFixed(0)}%`],
    ["Unnecessary question rate", "unnecessaryQuestionRate", (v) => `${(v * 100).toFixed(0)}%`],
    ["Observed claims supported", "observationsSupportedRate", (v) => `${(v * 100).toFixed(0)}%`],
    ["Expected contradictions noticed", "contradictionRecall", (v) => `${(v * 100).toFixed(0)}%`],
    ["Unacceptable assumptions", "assumptionViolations", (v) => v.toFixed(1)],
    ["Mean latency (ms)", "latencyMsMean", (v) => v.toFixed(0)],
  ];
  const systems = (runs[0] ?? []).map((a) => a.system);
  const L = ["", `## Variance across ${runs.length} runs (mean, min-max)`, "", `| Metric | ${systems.map((s) => LABEL[s]).join(" | ")} |`, `|---|${systems.map(() => "---").join("|")}|`];
  for (const [name, field, f] of fields) {
    const cells = systems.map((sys, i) => {
      if (fixture && !realUnderFixture(sys, field)) return "n/a (fixture)";
      const vals = runs.map((r) => r[i]?.[field]).filter((v): v is number => typeof v === "number");
      if (!vals.length) return "n/a";
      return `${f(vals.reduce((a, b) => a + b, 0) / vals.length)} (${f(Math.min(...vals))}-${f(Math.max(...vals))})`;
    });
    L.push(`| ${name} | ${cells.join(" | ")} |`);
  }
  L.push("");
  return L.join("\n");
}

