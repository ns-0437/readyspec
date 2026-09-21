import { describe, expect, it } from "vitest";
import { DEMO_REPO, DEMO_TICKET, makeService } from "./helpers";

describe("end-to-end workflow (fixture provider)", () => {
  it("runs select -> investigate -> consent -> clarify -> answer -> brief -> verify -> approve", async () => {
    const { service } = makeService();
    const s = service.createSession(DEMO_REPO, DEMO_TICKET);
    expect(s.isDemo).toBe(true);
    expect(s.provider.kind).toBe("fixture");

    let d = service.getDetail(s.id)!;
    expect(d.session.status).toBe("awaiting_consent");
    expect(d.evidence.length).toBeGreaterThan(5);
    expect(d.disclosure?.leavesMachine).toBe(false);
    expect(d.inspection?.excluded.map((e) => e.path)).toEqual(expect.arrayContaining([".env", "assets/logo.png"]));

    service.startAnalysis(s.id);
    await service.waitForIdle(s.id);
    d = service.getDetail(s.id)!;
    expect(d.session.status).toBe("awaiting_answers");
    expect(d.rounds).toHaveLength(1);
    const round = d.rounds[0]!;
    expect(round.questions.length).toBeLessThanOrEqual(5);
    expect(round.questions[0]!.text).toMatch(/security/i);
    expect(d.analysis!.observations.every((o) => o.evidenceIds.length > 0)).toBe(true);

    // Cannot generate a brief until every question is answered or deferred.
    expect(() => service.startBrief(s.id)).toThrow(/Answer or defer/);

    service.submitAnswers(s.id, [
      { questionId: "q-1", source: "suggestion_accepted", answer: round.questions[0]!.suggestedAnswers[0]!.text },
      { questionId: "q-2", source: "user", answer: "Deliver a single digest when the pause ends." },
      { questionId: "q-3", source: "user", answer: "An end date is required, at most 30 days out." },
      { questionId: "q-4", source: "deferred", answer: "" },
      { questionId: "q-5", source: "user", answer: "Re-check the pause at send time and hold the job." },
    ]);
    service.startBrief(s.id);
    await service.waitForIdle(s.id);
    d = service.getDetail(s.id)!;
    expect(d.session.status).toBe("review");
    const brief = d.brief!;
    expect(brief.status).toBe("draft");
    expect(brief.producedBy.kind).toBe("fixture");
    expect(brief.decisions.map((x) => x.questionId).sort()).toEqual(["q-1", "q-2", "q-3", "q-5"]);
    expect(brief.openQuestions.map((q) => q.questionId)).toEqual(["q-4"]);
    expect(d.verification!.passed).toBe(true);
    expect(d.verification!.citations.checked).toBeGreaterThan(0);
    expect(d.verification!.citations.invalid).toEqual([]);
    for (const c of brief.acceptanceCriteria) expect(c.testIds.length).toBeGreaterThan(0);

    // Approval needs an explicit acknowledgement of the unresolved question.
    expect(() => service.approve(s.id, { reviewer: "Tester", note: "", acknowledgeOpenItems: false })).toThrow(/unresolved/);
    const approved = service.approve(s.id, { reviewer: "Tester", note: "ok", acknowledgeOpenItems: true });
    expect(approved.status).toBe("approved");
    expect(service.getDetail(s.id)!.session.status).toBe("approved");
  });

  it("logs the planted injection as untrusted and never follows it", async () => {
    const { service } = makeService();
    const s = service.createSession(DEMO_REPO, DEMO_TICKET);
    const d = service.getDetail(s.id)!;
    expect(d.activity.some((a) => a.level === "warn" && /Instruction-like text.*AGENT_NOTES/.test(a.message))).toBe(true);
    service.startAnalysis(s.id);
    await service.waitForIdle(s.id);
    const after = service.getDetail(s.id)!;
    expect(after.session.status).toBe("awaiting_answers"); // not skipped, not approved
    expect(after.rounds[0]!.questions.length).toBeGreaterThan(0);
    expect(after.brief).toBeNull();
  });
});
