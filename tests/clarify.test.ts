import { describe, expect, it } from "vitest";
import { Budget } from "@/server/llm/budget";
import type { ClarifyContext } from "@/server/llm/contexts";
import type { Question } from "@/shared/schemas";
import { runClarify, type StageEnv } from "@/server/workflow/stages";
import { TEST_LIMITS } from "./helpers";

const question = (id: string, text: string, priority = 1): Question => ({
  id, text, priority, whyItMatters: "Determines the behavior", impact: "behavior", suggestedAnswers: [], evidenceIds: [],
});
const context = (extra: Partial<ClarifyContext> = {}): ClarifyContext => ({
  ticket: "Pause notifications", evidence: [], decisions: [], priorQuestions: [], round: 2,
  analysis: { observations: [], contradictions: [], missingDecisions: [], insufficientEvidence: [], evidenceNotes: {} },
  ...extra,
});
const env = (questions: Question[]): StageEnv => ({
  provider: {
    info: { kind: "fixture", label: "Scripted test", model: "fixture" }, leavesMachine: false,
    async complete() { return { text: JSON.stringify({ questions, note: "" }), usage: { inputTokens: 1, outputTokens: 1 } }; },
  },
  budget: new Budget(TEST_LIMITS, { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, estimated: false }),
  onUsage: () => {}, onEvent: () => {}, backoffMs: 0,
});

describe("clarification normalization", () => {
  it("deduplicates within the new round, retaining the highest-priority wording", async () => {
    const out = await runClarify(env([
      question("low", "Pause security alerts?", 3), question("high", "PAUSE security alerts!", 1), question("duration", "How long?", 2),
    ]), context());
    expect(out.questions.map((q) => [q.id, q.priority])).toEqual([["high", 1], ["duration", 2]]);
  });

  it("does not reuse IDs from prior rounds, decisions, or another question in this round", async () => {
    const out = await runClarify(env([
      question("q1", "What duration?"), question("q1", "Which channels?"), question("answered", "Which timezone?"),
    ]), context({
      priorQuestions: [question("q1", "Old question?"), question("r2-q1", "Another old question?")],
      decisions: [{ questionId: "answered", question: "Previously answered?", answer: "Yes", source: "user", round: 1, answeredAt: "2026-10-08T00:00:00Z" }],
    }));
    expect(out.questions.map((q) => q.id)).toEqual(["r2-q1-2", "r2-q1-3", "r2-answered"]);
  });

  it("keeps distinct non-Latin questions and deduplicates their repeated text", async () => {
    const out = await runClarify(env([
      question("a", "Коли почати?"), question("b", "Коли завершити?"), question("c", "КОЛИ ПОЧАТИ!"),
    ]), context());
    expect(out.questions.map((q) => q.id)).toEqual(["a", "b"]);
  });

  it("does not ask a normalized prior or answered question again", async () => {
    const out = await runClarify(env([question("new", "Which channels!"), question("other", "How long?")]), context({
      priorQuestions: [question("previous", "WHICH channels?")],
      decisions: [{ questionId: "answered", question: "How long!", answer: "One day", source: "user", round: 1, answeredAt: "2026-10-08T00:00:00Z" }],
    }));
    expect(out.questions).toEqual([]);
  });
});
