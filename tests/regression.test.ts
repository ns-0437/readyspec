import { describe, expect, it } from "vitest";
import { compareToBaseline, TOLERANCE, type RetrievalBaseline } from "../evals/runners/regression";

const baseline: RetrievalBaseline = { generatedAt: "2026-01-01T00:00:00.000Z", cases: 17, recallRequired: 0.97, precision: 0.52, distractorsPerCase: 0.71 };
const same = (): RetrievalBaseline => ({ ...baseline, generatedAt: "now" });

describe("compareToBaseline", () => {
  it("passes with no baseline on disk (first run) and says so", () => {
    const r = compareToBaseline(same(), null);
    expect(r.ok).toBe(true);
    expect(r.issues[0]).toMatch(/no baseline/i);
  });

  it("passes when identical to the baseline", () => {
    expect(compareToBaseline(same(), baseline)).toMatchObject({ ok: true, issues: [] });
  });

  it("passes on improvements: higher recall/precision, fewer distractors", () => {
    const better = { ...same(), recallRequired: 1, precision: 0.9, distractorsPerCase: 0 };
    expect(compareToBaseline(better, baseline)).toMatchObject({ ok: true, issues: [] });
  });

  it("passes on a drop comfortably within tolerance", () => {
    const current = {
      ...same(),
      recallRequired: baseline.recallRequired - TOLERANCE.recallRequired / 2,
      precision: baseline.precision - TOLERANCE.precision / 2,
      distractorsPerCase: baseline.distractorsPerCase + TOLERANCE.distractorsPerCase / 2,
    };
    expect(compareToBaseline(current, baseline)).toMatchObject({ ok: true, issues: [] });
  });

  it("fails on a recall drop beyond tolerance, and reports the actual numbers", () => {
    const current = { ...same(), recallRequired: baseline.recallRequired - TOLERANCE.recallRequired - 0.001 };
    const r = compareToBaseline(current, baseline);
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toContain("recallRequired");
    expect(r.issues[0]).toContain("0.970");
  });

  it("fails on a precision drop beyond tolerance", () => {
    const current = { ...same(), precision: baseline.precision - TOLERANCE.precision - 0.001 };
    expect(compareToBaseline(current, baseline).ok).toBe(false);
  });

  it("fails when distractors rise beyond tolerance (worse is higher for this metric)", () => {
    const current = { ...same(), distractorsPerCase: baseline.distractorsPerCase + TOLERANCE.distractorsPerCase + 0.001 };
    expect(compareToBaseline(current, baseline).ok).toBe(false);
  });

  it("reports every metric that regressed, not just the first", () => {
    const current = { ...same(), recallRequired: 0, precision: 0, distractorsPerCase: baseline.distractorsPerCase + 1 };
    const r = compareToBaseline(current, baseline);
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(3);
  });
});
