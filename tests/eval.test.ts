import { describe, expect, it } from "vitest";
import { loadCases } from "../evals/runners/cases";
import { renderReport, renderVariance } from "../evals/runners/report";
import { aggregate, type Aggregate, injectionFollowed, matchAnyOf, matchGroup, scoreAmbiguity, scoreAssumptions, scoreContradictions, scoreQuestions, scoreRetrieval, scoreRun, type SystemOutput } from "../evals/runners/score";
import { CHECKLIST, runChecklist, runSinglePrompt, runSinglePromptAlphabetical, runStaged, snapshotFor } from "../evals/runners/systems";
import { FixtureProvider } from "@/server/llm/fixture";
import { demoClarification } from "@/server/llm/fixture/demo-notifications";
import { retrieveEvidence } from "@/server/repository/search";
import { ProviderError, type LlmProvider, type LlmRequest } from "@/server/llm/provider";
import { renderEvidence } from "@/server/llm/prompts";
import { investigate } from "@/server/workflow/investigate";

const cases = loadCases();
const byId = (id: string) => cases.find((c) => c.id === id)!;

const blank = (over: Partial<SystemOutput> = {}): SystemOutput => ({
  system: "staged", contextFiles: [], modelFiles: [], hallucinatedFiles: [], questions: [], observations: [], assumptions: [], criteria: [],
  contradictions: [], insufficientEvidence: [], verification: null, latencyMs: 1, usage: { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null }, ...over,
});

describe("benchmark case set", () => {
  it("has about thirty cases with a held-out subset across four repositories", () => {
    expect(cases).toHaveLength(30);
    expect(new Set(cases.map((c) => c.id)).size).toBe(30);
    const held = cases.filter((c) => c.heldOut).length;
    expect(held).toBeGreaterThanOrEqual(5);
    expect(held).toBeLessThanOrEqual(cases.length / 2);
    expect(cases.filter((c) => c.cohort === "v2").every((c) => c.heldOut)).toBe(true);
    expect(new Set(cases.map((c) => c.repo))).toEqual(new Set(["demo-repository", "shop-orders", "team-tasks", "helpdesk-platform"]));
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

  it("scoreRun + aggregate combine per-case scores; a fully failed run (no files either) is excluded from means", () => {
    const good = blank({ contextFiles: c.expectedFiles.required, questions: [{ text: "What about security alerts during a pause?", why: "" }] });
    const bad = { ...blank(), error: "provider down" }; // files: [] too -- nothing was ever retrieved
    const scores = [scoreRun(c, good), scoreRun(c, bad)];
    const agg = aggregate("staged", scores, [good, bad]);
    expect(agg).toMatchObject({ cases: 2, failed: 1 });
    expect(agg.retrievalRecallRequired).toBeCloseTo(0.5); // good=1, bad=0 (it has no files at all): both count
    expect(agg.ambiguityRecallAsked).toBeCloseTo(1 / 5); // ambiguity/questions/etc. still only come from the successful case
  });

  it("retrieval that succeeded before a later model-call failure is still counted (the staged system's real failure mode)", () => {
    // Mirrors runStaged: investigate() retrieves files deterministically before any model call, so
    // a case can have real, correct `files` and still end up with `out.error` set (e.g. a live 429
    // on the analyze/clarify/brief call). That retrieval data must not be thrown away with the case.
    const succeededRetrievalThenFailed = { ...blank({ contextFiles: c.expectedFiles.required }), error: "Model API returned 429: quota exceeded" };
    const agg = aggregate("staged", [scoreRun(c, succeededRetrievalThenFailed)], [succeededRetrievalThenFailed]);
    expect(agg.failed).toBe(1);
    expect(agg.retrievalRecallRequired).toBe(1); // not null, not excluded
    expect(agg.ambiguityRecallAsked).toBeNull(); // model-dependent metrics correctly have nothing to report
  });
});

describe("systems (fixture provider: deterministic parts only)", () => {
  it("the static checklist retrieves nothing and asks the same questions for every ticket", async () => {
    const a = await runChecklist();
    const b = await runChecklist();
    expect(a.contextFiles).toEqual([]);
    expect(a.questions).toEqual(b.questions);
  });

  it("the staged workflow retrieves real files and reaches every stage without error", async () => {
    const c = byId("demo-01-pause-notifications");
    const out = await runStaged(c, new FixtureProvider());
    expect(out.error).toBeUndefined();
    expect(scoreRetrieval(c, out.contextFiles).recallRequired).toBe(1);
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

describe("report rendering never presents fixture output as model results", () => {
  const agg = (system: "checklist" | "staged"): Aggregate => ({
    system, cases: 1, failed: 0, retrievalRecallRequired: 1, retrievalPrecision: 0.5, distractorFilesPerCase: 0, modelFileRecallRequired: null, modelFilePrecision: null, citationValidity: 1,
    observationsSupportedRate: 1, ambiguityRecallAsked: 0.9, ambiguityRecallSurfaced: 0.9, questionsPerCase: 4, unnecessaryQuestionRate: 0.1,
    contradictionRecall: 1, assumptionViolations: 0, insufficientEvidenceAcknowledged: 1, injectionFollowedCount: 0, flagsPerCase: 0,
    latencyMsMean: 5, inputTokens: 10, outputTokens: 10, completed: 1, usageLowerBoundOutputs: 0, costUnknownOutputs: 0, costKnownUsd: null, costComplete: false, costUsd: null,
  });

  it("variance table masks model-dependent cells for the fixture provider but keeps deterministic ones", () => {
    const runs = [[agg("checklist"), agg("staged")], [agg("checklist"), agg("staged")]];
    const fixture = renderVariance(runs, true);
    const staged = fixture.split("\n").filter((l) => l.startsWith("| Critical ambiguities asked"))[0]!;
    expect(staged).toContain("90%"); // checklist column is deterministic, shown
    expect(staged).toContain("n/a (fixture)"); // staged column is scripted, masked
    const live = renderVariance(runs, false);
    expect(live).not.toContain("n/a (fixture)");
  });

  it("main table masks the same cells and keeps staged retrieval", () => {
    const md = renderReport({ provider: new FixtureProvider(), set: "dev", aggs: [agg("checklist"), agg("staged")], scores: [], outputs: [], cases: [] });
    const recall = md.split("\n").find((l) => l.startsWith("| Context coverage: required-file recall"))!;
    expect(recall).toContain("100%");
    const amb = md.split("\n").find((l) => l.startsWith("| Critical ambiguities asked"))!;
    expect(amb.match(/n\/a \(fixture\)/g)).toHaveLength(1);
    expect(md).toContain("Fixture provider run");
  });
});

describe("same-evidence single-prompt baseline (capturing provider, no API calls)", () => {
  const c = byId("demo-01-pause-notifications");
  const OUTSIDE = "src/billing/invoice.ts"; // exists in the repo, is not retrieved for this ticket

  /** Records every request. The single-prompt stage returns scripted JSON; any other stage stops the run. */
  function capture(single: unknown): LlmProvider & { calls: LlmRequest[] } {
    const calls: LlmRequest[] = [];
    return {
      calls,
      info: { kind: "anthropic", label: "capture", model: "m" },
      leavesMachine: false,
      async complete(req) {
        calls.push(req);
        if (req.stage === "single_prompt") return { text: JSON.stringify(single), usage: { inputTokens: 1, outputTokens: 1 } };
        throw new ProviderError("stop after capturing", { retryable: false });
      },
    };
  }
  const scripted = {
    observations: [{ id: "o1", statement: "decideDelivery exists", citations: [{ path: "src/notifications/dispatcher.ts", startLine: 13, endLine: 17 }] }],
    questions: [], assumptions: [], acceptanceCriteria: [],
    filesToChange: [OUTSIDE],
  };

  it("gives the baseline and the staged analyze stage identical initial evidence, and nothing else", async () => {
    const evidence = investigate(snapshotFor(c.repo), c.ticket).evidence;
    const rendered = renderEvidence(evidence);

    const base = capture(scripted);
    await runSinglePrompt(c, base);
    const staged = capture(scripted);
    await runStaged(c, staged);

    const baseUser = base.calls[0]!.user;
    const analyzeUser = staged.calls[0]!.user;
    expect(baseUser).toContain(rendered); // same ids, paths, line ranges, order, text
    expect(analyzeUser).toContain(rendered);
    expect(base.calls[0]!.system).toBe(staged.calls[0]!.system);

    const promptPaths = (u: string) => [...u.matchAll(/<repository_excerpt id="([^"]+)" path="([^"]+)" lines="(\d+-\d+)"/g)].map((m) => `${m[1]}|${m[2]}|${m[3]}`);
    expect(promptPaths(baseUser)).toEqual(promptPaths(analyzeUser));
    expect(promptPaths(baseUser)).toHaveLength(evidence.length);
    expect(baseUser).not.toContain("<repository_file"); // the old whole-file context is absent
    expect(baseUser).not.toContain(OUTSIDE);
    expect(baseUser).not.toContain("invoiceTotal");
  });

  it("keeps context coverage and model-selected files separate", async () => {
    const out = await runSinglePrompt(c, capture(scripted));
    const retrieved = [...new Set(investigate(snapshotFor(c.repo), c.ticket).evidence.map((e) => e.path))];
    expect(out.contextFiles).toEqual(retrieved);
    expect(out.contextFiles).not.toContain(OUTSIDE);
    expect(out.modelFiles).toEqual(expect.arrayContaining(["src/notifications/dispatcher.ts", OUTSIDE]));
    const score = scoreRun(c, out);
    expect(score.retrieval.fileCount).toBe(retrieved.length); // context coverage unaffected by model output
    expect(score.modelFiles.fileCount).toBe(2);
    expect(score.modelFiles.distractorHits.length + score.modelFiles.missedRequired.length).toBeGreaterThan(0);
  });

  it("the staged system reports the same context coverage as the baseline", async () => {
    const base = await runSinglePrompt(c, capture(scripted));
    const staged = await runStaged(c, capture(scripted)); // stops after the analyze request; context is set before it
    expect(staged.contextFiles).toEqual(base.contextFiles);
  });

  it("keeps the alphabetical baseline as a labelled secondary with its own context", async () => {
    const out = await runSinglePromptAlphabetical(c, capture(scripted));
    expect(out.system).toBe("single_prompt_alphabetical");
    expect(out.context?.kind).toBe("alphabetical");
    expect(out.contextFiles.length).toBeGreaterThan(0);
  });
});
