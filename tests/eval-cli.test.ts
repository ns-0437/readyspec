import { describe, expect, it } from "vitest";
import { parseEvalArgs, validateSelectedCases } from "../evals/runners/cli";

describe("evaluation command validation", () => {
  it("normalizes supported aliases and accepts equals-form arguments", () => {
    const parsed = parseEvalArgs(["--provider=fixture", "--systems", " single , staged ", "--repeat", "2", "--dry-run"]);
    expect(parsed.systems).toEqual(["single_prompt", "staged"]);
    expect(parsed.repeat).toBe(2);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.get("provider")).toBe("fixture");
  });
  it.each([
    ["--repeet", "3"], ["--systems", "stagged"], ["--systems", "constructor"],
    ["--systems", "single,single_prompt"], ["--systems", "single,"],
    ["--repeat", "0"], ["--repeat", "-1"], ["--repeat", "1.5"], ["--repeat", "Infinity"], ["--repeat", "NaN"],
    ["--repeat", "1", "--repeat", "2"], ["--cases", ""], ["--cases", "a,a"], ["--set", "deev"],
    ["--provider-token-limit", "0"], ["--provider-token-limit", "-10"], ["--max-calls", "--dry-run"],
  ])("rejects invalid options before a run: %j", (...args) => {
    expect(() => parseEvalArgs(args)).toThrow();
  });
  it.each([["--repeat", "2"], ["--set", "heldout-v2"], ["--cases", "demo-01"], ["--systems", "staged"]])("rejects pilot overrides: %j", (...args) => {
    expect(() => parseEvalArgs(["--pilot", ...args])).toThrow(/pilot/);
  });
  it("pins a pilot to development and one repetition", () => {
    expect(parseEvalArgs(["--pilot", "--dry-run"])).toMatchObject({ set: "dev", repeat: 1, systems: ["single_prompt", "staged"] });
  });
  it("rejects unknown or wrong-cohort case IDs instead of silently running an empty/subset evaluation", () => {
    expect(() => validateSelectedCases(["a", "typo"], [{ id: "a" }])).toThrow(/typo/);
    expect(() => validateSelectedCases([], [])).toThrow(/no cases/);
    expect(() => validateSelectedCases(["a"], [{ id: "a" }, { id: "b" }])).not.toThrow();
  });
});
