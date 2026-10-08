import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { LlmProvider } from "@/server/llm/provider";
import { loadCases } from "../evals/runners/cases";
import { costCell } from "../evals/runners/report";
import { runBenchmark } from "../evals/runners/run";
import { aggregate, scoreRun, type SystemName, type SystemOutput } from "../evals/runners/score";
import { createRunDir, readSavedResults, writeOnce } from "../evals/runners/store";

const cases = loadCases().filter((c) => !c.heldOut).slice(0, 2);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "readyspec-eval-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Not "fixture", so the human scoring sheet is produced like a live run. Never called.
const provider: LlmProvider = { info: { kind: "groq", label: "mock", model: "m" }, leavesMachine: false, complete: async () => { throw new Error("no model calls in this test"); } };

const out = (system: SystemName, over: Partial<SystemOutput> = {}): SystemOutput => ({
  system, contextFiles: [], modelFiles: [], hallucinatedFiles: [], questions: [], observations: [], assumptions: [], criteria: [],
  contradictions: [], insufficientEvidence: [], verification: null, latencyMs: 1, usage: { calls: 1, inputTokens: 100, outputTokens: 10, costUsd: 0.01, exact: true }, ...over,
});
const run = (extra: Partial<Parameters<typeof runBenchmark>[0]> = {}) =>
  runBenchmark({ provider, set: "dev", cases, systems: ["staged", "single_prompt"], repeat: 1, resultsDir: tmp, execute: async (s) => out(s), ...extra });

describe("durable benchmark results", () => {
  it("keeps every repetition's individual results and an overall summary over all of them", async () => {
    const r = await run({ repeat: 2 });
    const saved = readSavedResults(r.runDir);
    expect(saved).toHaveLength(2 * cases.length * 2); // reps x cases x systems, not just the last repetition
    expect(new Set(saved.map((s) => s.repetition))).toEqual(new Set([1, 2]));
    expect(saved.every((s) => s.provider.kind === "groq" && s.caseId && s.system)).toBe(true);
    expect(r.aggsByRun).toHaveLength(2);
    expect(r.overall[0]!.cases).toBe(2 * cases.length); // pooled, not final-repetition-only
    expect(r.aggsByRun[1]![0]!.cases).toBe(cases.length);
    const summary = JSON.parse(fs.readFileSync(path.join(r.runDir, "summary.json"), "utf8"));
    expect(summary.perRepetition).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(path.join(r.runDir, "run.json"), "utf8")).status).toBe("complete");
  });

  it("keeps results saved before an interruption in a later case", async () => {
    let n = 0;
    const execute = async (s: SystemName) => {
      if (++n === 3) throw new Error("process died");
      return out(s);
    };
    await expect(run({ execute })).rejects.toThrow("process died");
    const dir = fs.readdirSync(path.join(tmp, "runs")).map((d) => path.join(tmp, "runs", d)).find((d) => JSON.parse(fs.readFileSync(path.join(d, "run.json"), "utf8")).status === "interrupted")!;
    const saved = readSavedResults(dir);
    expect(saved).toHaveLength(2); // the two that finished are intact and parseable
    expect(saved.every((s) => s.output && s.score)).toBe(true);
  });

  it("saves failed outputs too, and never lets separate runs or reruns overwrite a scoring sheet", async () => {
    const a = await run({ repeat: 2, execute: async (s) => out(s, { error: "boom" }) });
    expect(readSavedResults(a.runDir).every((s) => s.output.error === "boom")).toBe(true);
    const sheetA = path.join(a.runDir, "scoring-sheet.csv");
    const rows = fs.readFileSync(sheetA, "utf8").trim().split("\n");
    expect(rows[0]).toContain("repetition");
    expect(rows).toHaveLength(1 + 2 * cases.length * 2);
    expect(rows[1]).toContain("results/rep1/");
    fs.appendFileSync(sheetA, "1,x,x,x,no,2,0,0,0,5,me,scored\n"); // a human fills it in
    const before = fs.readFileSync(sheetA, "utf8");

    const b = await run({ repeat: 2 });
    expect(b.runDir).not.toBe(a.runDir);
    expect(fs.readFileSync(sheetA, "utf8")).toBe(before); // untouched by the second run
    expect(() => writeOnce(sheetA, "overwrite")).toThrow(); // write-once even if someone tries
    expect(createRunDir(path.join(tmp, "runs"), "groq-dev")).not.toBe(a.runDir);
  });
});

describe("failed-run accounting", () => {
  const ok = out("staged");
  const failedKnown = out("staged", { error: "429 after one good call", usage: { calls: 1, inputTokens: 50, outputTokens: 5, costUsd: 0.005, exact: false } });
  const agg = (outs: SystemOutput[]) => aggregate("staged", outs.map((o) => scoreRun(cases[0]!, o)), outs);

  it("counts a failed output's known usage and reports completed and failed separately", () => {
    const a = agg([ok, failedKnown]);
    expect(a).toMatchObject({ cases: 2, completed: 1, failed: 1, inputTokens: 150, outputTokens: 15, usageLowerBoundOutputs: 1 });
    expect(a.costKnownUsd).toBeCloseTo(0.015);
    expect(a.costComplete).toBe(false);
    expect(a.costUsd).toBeNull(); // never presented as a full total
    expect(costCell(a)).toMatch(/\$0\.0150 known \+ unknown usage \(1 failed output\(s\) with unavailable usage\)/);
  });

  it("separates a known zero from unavailable or unpriced usage", () => {
    const knownZero = out("checklist", { usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, exact: true } });
    const z = aggregate("checklist", [scoreRun(cases[0]!, knownZero)], [knownZero]);
    expect(z.costComplete).toBe(true);
    expect(costCell(z)).toBe("$0.0000");

    const unpriced = out("staged", { usage: { calls: 1, inputTokens: 10, outputTokens: 1, costUsd: null, exact: true } });
    const u = agg([ok, unpriced]);
    expect(u).toMatchObject({ costUnknownOutputs: 1, costComplete: false, costUsd: null });
    expect(costCell(u)).toContain("known + unknown usage (1 output(s) with no cost figure)");

    const nothing = agg([out("staged", { error: "x", usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, exact: false } })]);
    expect(costCell(nothing)).toMatch(/^n\/a \(/); // no known figure at all: say so, don't print $0
  });
});
