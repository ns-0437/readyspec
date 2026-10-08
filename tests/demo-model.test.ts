import { describe, expect, it } from "vitest";
import { createCriteria, emptyChoices, validChoices } from "../demo/src/model";

describe("scripted demo decisions", () => {
  it("leaves requirements visibly blocked until the human resolves dependencies", () => {
    const criteria = createCriteria(emptyChoices());
    expect(criteria.every((c) => c.blockedBy.length > 0)).toBe(true);
    expect(criteria[0]!.blockedBy).toEqual(["security", "channels"]);
  });
  it("changes policy and proposed tests when choices change", () => {
    const preserve = createCriteria({ security: "preserve", duration: "24h", channels: "all" });
    const pause = createCriteria({ security: "pause", duration: "manual", channels: "push" });
    expect(preserve.every((c) => !c.blockedBy.length)).toBe(true);
    expect(preserve[0]!.text).toContain("keep security");
    expect(pause[0]!.text).toContain("including security");
    expect(preserve[1]!.test).toContain("controlled clock");
    expect(pause[1]!.text).toContain("do not expire");
    expect(pause[2]!.text).toContain("only to push");
  });
  it("validates restored decision values instead of trusting stored data", () => {
    expect(validChoices(emptyChoices())).toBe(true);
    expect(validChoices({ security: "preserve", duration: "24h", channels: "all" })).toBe(true);
    expect(validChoices({ security: "invented", duration: null, channels: null })).toBe(false);
    expect(validChoices({ security: null })).toBe(false);
    expect(validChoices(null)).toBe(false);
  });
});
