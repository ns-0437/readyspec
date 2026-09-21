import { beforeAll, describe, expect, it } from "vitest";
import type { Brief, BriefContent, Decision, EvidenceItem, Question } from "@/shared/schemas";
import { contentOf } from "@/shared/brief-edit";
import { checkableTokens, assessSupport } from "@/server/workflow/support";
import { verifyBrief } from "@/server/workflow/verify";
import type { Snapshot } from "@/server/repository/types";
import { makeService, runToReview } from "./helpers";

let brief: Brief;
let evidence: EvidenceItem[];
let snapshot: Snapshot;
let questions: Question[];
let decisions: Decision[];

beforeAll(async () => {
  const { service, store } = makeService();
  const { id, detail } = await runToReview(service);
  brief = detail.brief!;
  evidence = detail.evidence;
  questions = detail.rounds.flatMap((r) => r.questions);
  decisions = detail.decisions;
  snapshot = store.loadSnapshot(store.getSnapshotId(id)!)!;
});

const clone = <T>(x: T): T => structuredClone(x);
const verify = (b: BriefContent, over: Partial<Parameters<typeof verifyBrief>[0]> = {}) =>
  verifyBrief({ brief: b, revision: 1, evidence, snapshot, questions, decisions, ...over });
const codes = (r: ReturnType<typeof verify>, sev: "error" | "warning" = "error") => r.issues.filter((i) => i.severity === sev).map((i) => i.code);

describe("verifyBrief: a good brief", () => {
  it("passes with every citation valid and every criterion tested", () => {
    const r = verify(contentOf(brief));
    expect(r.passed).toBe(true);
    expect(codes(r)).toEqual([]);
    expect(r.citations.invalid).toEqual([]);
    expect(r.citations.valid).toBe(r.citations.checked);
    expect(r.coverage.criteriaWithTest).toBe(r.coverage.criteria);
  });

  it("judges observed statements as supported by their citations", () => {
    const r = verify(contentOf(brief));
    const obs = r.support.filter((s) => s.itemType === "observation");
    expect(obs.length).toBeGreaterThan(0);
    expect(obs.every((s) => s.verdict === "supported")).toBe(true);
  });
});

describe("verifyBrief: citations", () => {
  it("flags evidence ids that do not exist", () => {
    const b = clone(contentOf(brief));
    b.existingBehavior[0]!.evidenceIds = ["ev-ffffffff"];
    const r = verify(b);
    expect(codes(r)).toContain("unknown-evidence-id");
    expect(r.passed).toBe(false);
  });

  it("flags citations whose lines no longer match the snapshot", () => {
    const tampered = evidence.map((e, i) => (i === 0 ? { ...e, contentHash: "0".repeat(64) } : e));
    const b = clone(contentOf(brief));
    b.existingBehavior[0]!.evidenceIds = [tampered[0]!.id];
    const r = verify(b, { evidence: tampered });
    expect(codes(r)).toContain("invalid-citation");
    expect(r.citations.invalid[0]!.reason).toMatch(/hash/);
  });

  it("flags citations to a path missing from the snapshot", () => {
    const moved = evidence.map((e, i) => (i === 0 ? { ...e, path: "src/gone.ts" } : e));
    const b = clone(contentOf(brief));
    b.existingBehavior[0]!.evidenceIds = [moved[0]!.id];
    expect(codes(verify(b, { evidence: moved }))).toContain("invalid-citation");
  });
});

describe("verifyBrief: claims", () => {
  it("rejects an observed statement with no evidence", () => {
    const b = clone(contentOf(brief));
    b.existingBehavior[0]!.evidenceIds = [];
    expect(codes(verify(b))).toContain("observed-without-evidence");
  });

  it("rejects an observed statement naming code the citation does not contain", () => {
    const b = clone(contentOf(brief));
    b.existingBehavior[0]!.statement = "purgeAllNotifications and SUSPEND_MODE_ENABLED exist in the cited function.";
    const r = verify(b);
    expect(codes(r)).toContain("unsupported-claim");
    expect(r.support.find((s) => s.itemId === b.existingBehavior[0]!.id)?.verdict).toBe("unsupported");
  });

  it("warns when an observation is phrased as a proposal", () => {
    const b = clone(contentOf(brief));
    b.existingBehavior[0]!.statement = "decideDelivery should be changed to return paused.";
    expect(codes(verify(b), "warning")).toContain("observed-sounds-proposed");
  });

  it("citation validity and support are separate: a valid citation can still be unsupported", () => {
    const b = clone(contentOf(brief));
    const digestEv = evidence.find((e) => e.path.endsWith("digest.ts"))!;
    b.existingBehavior[0]!.statement = "decideDelivery returns category_disabled for security alerts.";
    b.existingBehavior[0]!.evidenceIds = [digestEv.id];
    const r = verify(b);
    expect(r.citations.invalid).toEqual([]);
    expect(codes(r)).toContain("unsupported-claim");
  });
});

describe("verifyBrief: traceability", () => {
  it("requires a test for every criterion", () => {
    const b = clone(contentOf(brief));
    b.acceptanceCriteria[0]!.testIds = [];
    expect(codes(verify(b))).toContain("criterion-without-test");
  });

  it("catches dangling references", () => {
    const b = clone(contentOf(brief));
    b.acceptanceCriteria[0]!.componentIds.push("c-99");
    b.steps[0]!.criterionIds.push("ac-99");
    b.tests[0]!.criterionIds.push("ac-98");
    const r = verify(b);
    expect(r.issues.filter((i) => i.code === "dangling-reference").length).toBeGreaterThanOrEqual(3);
  });

  it("catches duplicate ids", () => {
    const b = clone(contentOf(brief));
    b.acceptanceCriteria[1]!.id = b.acceptanceCriteria[0]!.id;
    expect(codes(verify(b))).toContain("duplicate-id");
  });

  it("rejects a modify-component whose file is not in the snapshot", () => {
    const b = clone(contentOf(brief));
    b.components[0]!.path = "src/nonexistent.ts";
    expect(codes(verify(b))).toContain("component-path-missing");
    b.components[0]!.change = "add";
    expect(codes(verify(b))).not.toContain("component-path-missing");
  });

  it("warns about unlinked steps and uncovered criteria", () => {
    const b = clone(contentOf(brief));
    b.steps.forEach((s) => (s.criterionIds = []));
    const w = codes(verify(b), "warning");
    expect(w).toContain("step-unlinked");
    expect(w).toContain("criterion-without-step");
  });
});

describe("verifyBrief: human decisions are never invented or silently resolved", () => {
  it("rejects a decision the human did not record", () => {
    const b = clone(contentOf(brief));
    b.decisions.push({ questionId: "q-unknown", question: "?", answer: "made up", source: "user" });
    expect(codes(verify(b))).toContain("decision-not-recorded");
  });

  it("rejects a decision whose answer differs from what was recorded", () => {
    const b = clone(contentOf(brief));
    b.decisions[0]!.answer = "something the model preferred";
    expect(codes(verify(b))).toContain("decision-mismatch");
  });

  it("rejects a deferred question presented as decided", () => {
    const b = clone(contentOf(brief));
    const deferred = decisions.find((d) => d.source === "deferred")!;
    b.decisions.push({ questionId: deferred.questionId, question: deferred.question, answer: "chosen anyway", source: "user" });
    expect(codes(verify(b))).toContain("deferred-as-decision");
  });

  it("rejects dropping an unresolved question from the brief", () => {
    const b = clone(contentOf(brief));
    b.openQuestions = [];
    b.acceptanceCriteria.forEach((c) => (c.dependsOnOpen = []));
    expect(codes(verify(b))).toContain("unresolved-dropped");
  });
});

describe("lexical support assessment", () => {
  const ev = (excerpt: string): EvidenceItem => ({ id: "ev-1", path: "src/a.ts", startLine: 1, endLine: 3, contentHash: "0".repeat(64), snapshotId: "s", language: "TypeScript", excerpt, symbol: null, score: 1, matchedTerms: [], retrievalReason: "", explanation: "", injectionFlags: [] });

  it("extracts identifiers, constants, dotted access, paths and literals but not plain words", () => {
    const t = checkableTokens('decideDelivery reads user.timezone, MAX_ATTEMPTS and "UTC" in src/a.ts via category_disabled with plain words');
    expect(t).toEqual(expect.arrayContaining(["decideDelivery", "user.timezone", "MAX_ATTEMPTS", "UTC", "src/a.ts", "category_disabled"]));
    expect(t).not.toContain("plain");
  });

  it("supported / weak / unsupported / no_evidence thresholds", () => {
    const code = ev("function decideDelivery() { return MAX_ATTEMPTS; }");
    expect(assessSupport("decideDelivery uses MAX_ATTEMPTS", [code]).verdict).toBe("supported");
    expect(assessSupport("decideDelivery uses MAX_ATTEMPTS and neverDefinedThing", [code]).verdict).toBe("weak");
    expect(assessSupport("otherFunction calls neverDefinedThing", [code]).verdict).toBe("unsupported");
    expect(assessSupport("decideDelivery", []).verdict).toBe("no_evidence");
    expect(assessSupport("it does things", [code]).verdict).toBe("weak");
  });

  it("accepts a dotted access when both parts appear in the cited lines", () => {
    expect(assessSupport("sets categories.security", [ev("categories: { ...x, security: true }")]).verdict).toBe("supported");
  });
});
