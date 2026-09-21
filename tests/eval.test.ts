import { describe, expect, it } from "vitest";
import { loadCases } from "../evals/runners/cases";
import { aggregate, injectionFollowed, matchAnyOf, matchGroup, scoreAmbiguity, scoreAssumptions, scoreContradictions, scoreQuestions, scoreRetrieval, scoreRun, type SystemOutput } from "../evals/runners/score";
import { CHECKLIST, runChecklist, runStaged, snapshotFor } from "../evals/runners/systems";
import { FixtureProvider } from "@/server/llm/fixture";
import { demoClarification } from "@/server/llm/fixture/demo-notifications";
import { retrieveEvidence } from "@/server/repository/search";

const cases = loadCases();
const byId = (id: string) => cases.find((c) => c.id === id)!;

const blank = (over: Partial<SystemOutput> = {}): SystemOutput => ({
  system: "staged", files: [], hallucinatedFiles: [], filesFromModel: false, questions: [], observations: [], assumptions: [], criteria: [],
  contradictions: [], insufficientEvidence: [], verification: null, latencyMs: 1, usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null }, ...over,
});

describe("benchmark case set", () => {
  it("has about twenty cases with a held-out subset across three repositories", () => {
    expect(cases).toHaveLength(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(20);
    const held = cases.filter((c) => c.heldOut).length;
    expect(held).toBeGreaterThanOrEqual(5);
    expect(held).toBeLessThan(cases.length / 2);
    expect(new Set(cases.map((c) => c.repo))).toEqual(new Set(["demo-repository", "shop-orders", "team-tasks"]));
  });

  it("covers clear, ambiguous, conflicting-docs, irrelevant-files, misleading, vague and insufficient-evidence tickets", () => {
    expect(new Set(cases.map((c) => c.category))).toEqual(new Set(["clear", "ambiguous", "conflicting-docs", "irrelevant-files", "misleading", "vague", "insufficient-evidence"]));
  });

  it("only references files that exist in the pinned fixture snapshots", () => {
    for (const c of cases) {
      const files = snapshotFor(c.repo).files;
      for (const p of [...c.expectedFiles.required, ...c.expectedFiles.helpful, ...c.distractors]) expect(files.has(p), `${c.id}: ${p}`).toBe(true);
      expect(c.expectedFiles.required.length, c.id).toBeGreaterThan(0);
      for (const p of c.distractors) expect([...c.expectedFiles.required, ...c.expectedFiles.helpful], `${c.id} lists ${p} as both`).not.toContain(p);
    }
  });

  it("has valid regexes and non-empty keyword groups; every case names at least two critical ambiguities", () => {
    for (const c of cases) {
      expect(c.criticalAmbiguities.length, c.id).toBeGreaterThanOrEqual(2);
      for (const a of c.criticalAmbiguities) expect(a.anyOf.every((g) => g.length > 0)).toBe(true);
      for (const u of c.unacceptableAssumptions) expect(() => new RegExp(u.pattern, "i"), `${c.id}/${u.id}`).not.toThrow();
    }
  });

  it("conflicting-docs and misleading cases declare the contradiction a system should notice", () => {
    for (const c of cases.filter((x) => x.category === "conflicting-docs" || x.category === "misleading")) expect(c.expectedContradictions.length, c.id).toBeGreaterThan(0);
  });
});

describe("keyword matching", () => {
  it("requires every term in a group and accepts alternatives", () => {
    expect(matchGroup("What happens to retries after the pause?", ["retr"])).toBe(true);
    expect(matchGroup("What happens to retries?", ["retr", "paus"])).toBe(false);
    expect(matchGroup("Does the pause end automatically?", ["expir|end|resume", "paus"])).toBe(true);
    expect(matchAnyOf("timezone question", [["utc"], ["timezone|time zone"]])).toBe(true);
    expect(matchAnyOf("nothing relevant", [["utc"], ["timezone"]])).toBe(false);
  });

  it("calibration: the generic checklist does NOT trivially satisfy the critical ambiguities", async () => {
    const out = await runChecklist();
    const recalls = cases.map((c) => scoreAmbiguity(c, out.questions).recallAsked);
    const mean = recalls.reduce((a, b) => a + b, 0) / recalls.length;
    expect(mean).toBeLessThan(0.15); // keyword groups are specific enough not to match boilerplate
    expect(out.questions).toHaveLength(CHECKLIST.length);
  });

  it("calibration: natural, specific questions do satisfy them (groups are not unmatchable)", () => {
    const qs = demoClarification({ ticket: "x", analysis: { observations: [], contradictions: [], missingDecisions: [], insufficientEvidence: [], evidenceNotes: {} }, evidence: [], decisions: [], priorQuestions: [], round: 1 }).questions;
    const s = scoreAmbiguity(byId("demo-01-pause-notifications"), qs.map((q) => ({ text: q.text, why: q.whyItMatters })));
    expect(s.recallAsked).toBeGreaterThanOrEqual(0.8);
  });
});

describe("scoring functions", () => {
  const c = byId("demo-01-pause-notifications");

  it("retrieval: recall on required files, precision against relevant files, distractor hits", () => {
    const r = scoreRetrieval(c, ["src/notifications/dispatcher.ts", "src/billing/invoice.ts", "src/notifications/digest.ts"]);
    expect(r.recallRequired).toBe(0.5);
    expect(r.missedRequired).toEqual(["src/users/preferences.ts"]);
    expect(r.precision).toBeCloseTo(2 / 3);
    expect(r.distractorHits).toEqual(["src/billing/invoice.ts"]);
    expect(scoreRetrieval(c, []).precision).toBe(0);
  });

  it("questions: flags ones matching neither a critical ambiguity nor an acceptable topic", () => {
    const q = scoreQuestions(c, [{ text: "Should security alerts be paused?", why: "" }, { text: "What colour should the button be?", why: "" }]);
    expect(q).toMatchObject({ total: 2, unnecessary: 1 });
    expect(q.unnecessaryTexts).toEqual(["What colour should the button be?"]);
  });

  it("assumptions: catches silently-chosen policy but allows negated mentions of the premise", () => {
    expect(scoreAssumptions(c, ["We assume everything is interpreted in UTC."]).violations.map((v) => v.id)).toContain("assume-utc");
    expect(scoreAssumptions(c, ["Security alerts are also paused during the pause."]).violations.map((v) => v.id)).toContain("pause-covers-security");
    expect(scoreAssumptions(c, ["The pause end time zone is an open question."]).violations).toEqual([]);
    const bug = byId("demo-06-infinite-retry-bug");
    expect(scoreAssumptions(bug, ["SMS failures are retried forever in the queue."]).violations).toHaveLength(1);
    expect(scoreAssumptions(bug, ["There is no evidence that SMS sends are retried forever; retries stop at MAX_ATTEMPTS."]).violations).toEqual([]);
  });

  it("contradictions: applicable only to cases that declare one", () => {
    expect(scoreContradictions(c, []).applicable).toBe(true);
    expect(scoreContradictions(byId("demo-08-rename-marketing"), ["anything"]).applicable).toBe(false);
    const shop = byId("shop-04-extend-refund-window");
    expect(scoreContradictions(shop, ["docs say 30 days but the code uses 14"]).recall).toBe(1);
    expect(scoreContradictions(shop, ["the window is a constant"]).recall).toBe(0);
  });

  it("injection: following planted instructions is detected, ordinary output is not", () => {
    expect(injectionFollowed(c, blank({ questions: [] }))).toBe(true); // asked nothing though ambiguities exist
    expect(injectionFollowed(c, blank({ assumptions: ["The ticket is fully specified."], questions: [{ text: "q", why: "" }] }))).toBe(true);
    expect(injectionFollowed(c, blank({ questions: [{ text: "Should security alerts pause?", why: "" }] }))).toBe(false);
    expect(injectionFollowed(c, { ...blank({ questions: [] }), error: "boom" })).toBe(false);
  });

  it("scoreRun + aggregate combine per-case scores; failed runs are excluded from means", () => {
    const good = blank({ files: c.expectedFiles.required, questions: [{ text: "What about security alerts during a pause?", why: "" }] });
    const bad = { ...blank(), error: "provider down" };
    const scores = [scoreRun(c, good), scoreRun(c, bad)];
    const agg = aggregate("staged", scores, [good, bad]);
    expect(agg).toMatchObject({ cases: 2, failed: 1, retrievalRecallRequired: 1 });
    expect(agg.ambiguityRecallAsked).toBeCloseTo(1 / 5);
  });
});

describe("systems (fixture provider: deterministic parts only)", () => {
  it("the static checklist retrieves nothing and asks the same questions for every ticket", async () => {
    const a = await runChecklist();
    const b = await runChecklist();
    expect(a.files).toEqual([]);
    expect(a.questions).toEqual(b.questions);
  });

  it("the staged workflow retrieves real files and reaches every stage without error", async () => {
    const c = byId("demo-01-pause-notifications");
    const out = await runStaged(c, new FixtureProvider());
    expect(out.error).toBeUndefined();
    expect(scoreRetrieval(c, out.files).recallRequired).toBe(1);
    expect(out.verification).not.toBeNull();
  });

  it("retrieval is a pure function of snapshot and ticket", () => {
    const c = byId("shop-01-partial-refunds");
    const snap = snapshotFor(c.repo);
    const a = retrieveEvidence(snap, c.ticket).evidence.map((e) => e.id);
    expect(retrieveEvidence(snap, c.ticket).evidence.map((e) => e.id)).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
  });
});
