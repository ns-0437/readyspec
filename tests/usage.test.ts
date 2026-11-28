import { describe, expect, it } from "vitest";
import type { Usage } from "@/shared/schemas";
import { usageSummary } from "@/shared/usage";
import { createMemoryStore } from "@/server/persistence/store";

const base: Usage = { calls: 3, inputTokens: 8341, outputTokens: 1944, costUsd: null, estimated: false, failuresTracked: true };

describe("usageSummary", () => {
  it("stays short when nothing failed", () => {
    expect(usageSummary(base)).toBe("3 model call(s) · 8,341 in / 1,944 out tokens · cost unknown (set READYSPEC_PRICE_* to compute)");
    expect(usageSummary({ ...base, costUsd: 0 })).toContain("· $0.0000"); // a known zero is not "unknown"
    expect(usageSummary({ ...base, estimated: true })).toContain("(fixture estimate)");
  });

  it("marks cost incomplete when some reported tokens had no price", () => {
    expect(usageSummary({ ...base, costUsd: 0.5, unpricedInputTokens: 10 })).toContain("$0.5000 known cost (incomplete)");
  });

  it("says when earlier failures were never recorded", () => {
    expect(usageSummary({ ...base, failuresTracked: false })).toContain("earlier failed requests were not recorded");
  });

  it("counts persisted failed requests toward the total the call limit uses, apart from reported tokens", () => {
    const store = createMemoryStore();
    const { id } = store.createSession({ title: "t", repoLabel: "r", repoPath: "/r", ticket: "t", provider: { kind: "groq", label: "l", model: "m" }, isDemo: false });
    store.recordUsage(id, "analyze", { inputTokens: 100, outputTokens: 20, costUsd: 0.01, estimated: false });
    store.recordFailedAttempt(id, "clarify", { reservedInputTokens: 4000, reservedOutputTokens: 4000 });
    store.recordFailedAttempt(id, "clarify", { reservedInputTokens: 4000, reservedOutputTokens: 4000 });
    const text = usageSummary(store.getUsage(id));
    expect(text).toContain("3 model request(s) counted: 1 answered, 2 failed");
    expect(text).toContain("100 in / 20 out tokens");
    expect(text).toContain("~8,000 in / 8,000 out held for failed requests (estimate, not actual usage)");
    expect(text).toContain("$0.0100 known cost (incomplete)");
  });
});
