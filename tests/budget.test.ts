import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Budget, BudgetConfigError, costUsd, getPrices, limitsFromEnv } from "@/server/llm/budget";
import { generateStructured, isChargeFree, StageError } from "@/server/llm/generate";
import { BudgetExceededError, ProviderError, type LlmProvider, type LlmRequest, type LlmResponse } from "@/server/llm/provider";
import { createMemoryStore } from "@/server/persistence/store";
import type { Usage } from "@/shared/schemas";
import { TEST_LIMITS } from "./helpers";

const Schema = z.object({ n: z.number() });
const zero: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, estimated: false };
const PRICES = { inPerMTok: 1_000_000, outPerMTok: 1_000_000 }; // $1 per token keeps the arithmetic obvious

function scripted(steps: (LlmResponse | Error)[]): LlmProvider & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  let i = 0;
  return {
    calls,
    info: { kind: "groq", label: "scripted", model: "m" },
    leavesMachine: true,
    async complete(req) {
      calls.push(req);
      const step = steps[Math.min(i++, steps.length - 1)]!;
      if (step instanceof Error) throw step;
      return step;
    },
  };
}
const reply = (obj: unknown, inputTokens = 100, outputTokens = 20): LlmResponse => ({ text: JSON.stringify(obj), usage: { inputTokens, outputTokens } });
const gen = (provider: LlmProvider, budget: Budget, extra: Partial<Parameters<typeof generateStructured<{ n: number }>>[0]> = {}) =>
  generateStructured({ provider, budget, stage: "analyze", system: "s", user: "u", schema: Schema, schemaName: "T", maxOutputTokens: 10, backoffMs: 0, ...extra });

describe("dollar ceiling configuration", () => {
  it("rejects a ceiling without explicit prices instead of silently disabling it", () => {
    expect(() => new Budget({ ...TEST_LIMITS, maxCostUsd: 5 }, zero, null)).toThrow(BudgetConfigError);
    expect(getPrices({})).toBeNull();
    expect(getPrices({ READYSPEC_PRICE_IN_PER_MTOK: "3", READYSPEC_PRICE_OUT_PER_MTOK: "" })).toBeNull(); // empty is not zero
    expect(getPrices({ READYSPEC_PRICE_IN_PER_MTOK: "3", READYSPEC_PRICE_OUT_PER_MTOK: "-1" })).toBeNull();
    expect(getPrices({ READYSPEC_PRICE_IN_PER_MTOK: "abc", READYSPEC_PRICE_OUT_PER_MTOK: "1" })).toBeNull();
  });

  it("accepts explicit zero prices, and without a ceiling unknown pricing is still fine", () => {
    const zeroPrices = getPrices({ READYSPEC_PRICE_IN_PER_MTOK: "0", READYSPEC_PRICE_OUT_PER_MTOK: "0" });
    expect(zeroPrices).toEqual({ inPerMTok: 0, outPerMTok: 0 });
    expect(costUsd(1000, 1000, zeroPrices)).toBe(0); // a known zero, not unknown
    const b = new Budget({ ...TEST_LIMITS, maxCostUsd: 1 }, zero, zeroPrices);
    expect(() => b.reserve(1000, 1000)).not.toThrow(); // zero-priced requests never reach the cap
    expect(() => new Budget(TEST_LIMITS, zero, null)).not.toThrow();
  });

  it("rejects a malformed READYSPEC_MAX_COST_USD rather than treating it as no ceiling", () => {
    expect(limitsFromEnv({}).maxCostUsd).toBeNull();
    expect(limitsFromEnv({ READYSPEC_MAX_COST_USD: "2.5" }).maxCostUsd).toBe(2.5);
    expect(() => limitsFromEnv({ READYSPEC_MAX_COST_USD: "banana" })).toThrow(BudgetConfigError);
    expect(() => limitsFromEnv({ READYSPEC_MAX_COST_USD: "-1" })).toThrow(BudgetConfigError);
  });
});

describe("request reservation and attempt accounting", () => {
  it("blocks a request whose estimated worst case would exceed the dollar cap, and counts nothing", () => {
    const b = new Budget({ ...TEST_LIMITS, maxCostUsd: 100 }, { ...zero, costUsd: 60 }, PRICES);
    expect(() => b.reserve(30, 20)).toThrow(BudgetExceededError); // 60 + 30 + 20 = 110 > 100
    expect(() => b.reserve(10, 20)).not.toThrow(); // 60 + 30 = 90 fits
    expect(() => b.reserve(10, 5)).toThrow(BudgetExceededError); // 90 already reserved + 15 > 100: reservations stack
  });

  it("a rejected precheck is not a dispatched request and never reaches the provider", async () => {
    const p = scripted([reply({ n: 1 })]);
    const b = new Budget({ ...TEST_LIMITS, maxCostUsd: 1 }, zero, PRICES);
    await expect(gen(p, b)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(p.calls).toHaveLength(0);
  });

  it("failed dispatched attempts consume the call budget, retries included", async () => {
    const p = scripted([new ProviderError("503", { retryable: true, status: 503 })]);
    const b = new Budget({ ...TEST_LIMITS, maxCalls: 2 }, zero, null);
    const failures: string[] = [];
    await expect(gen(p, b, { maxRetries: 5, onFailedAttempt: (f) => failures.push(f.charge) })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(p.calls).toHaveLength(2); // two dispatched; the third was blocked before dispatch
    expect(failures).toEqual(["uncertain", "uncertain"]);
  });

  it("schema-validation retries each consume an attempt and their reported usage", async () => {
    const p = scripted([reply({ n: "bad" }, 100, 20), reply({ n: 2 }, 80, 10)]);
    const b = new Budget(TEST_LIMITS, zero, PRICES);
    const used: { in: number; out: number }[] = [];
    const out = await gen(p, b, { onUsage: (u) => used.push({ in: u.inputTokens, out: u.outputTokens }) });
    expect(out.n).toBe(2);
    expect(p.calls).toHaveLength(2);
    expect(used).toEqual([{ in: 100, out: 20 }, { in: 80, out: 10 }]); // the invalid response still consumed a call
  });

  it("success replaces the reservation with reported usage without double counting", () => {
    const b = new Budget({ ...TEST_LIMITS, maxCalls: 2, maxCostUsd: 1000 }, zero, PRICES);
    expect(b.settle(b.reserve(50, 50), 10, 5)).toBe(15); // reported cost replaces the $100 reservation
    b.settle(b.reserve(50, 50), 10, 5);
    expect(() => b.reserve(1, 1)).toThrow(/call limit/); // exactly two attempts counted, not four

    const c = new Budget({ ...TEST_LIMITS, maxCostUsd: 130 }, zero, PRICES);
    c.settle(c.reserve(50, 50), 10, 5); // $15 spent, nothing left reserved
    expect(() => c.reserve(50, 50)).not.toThrow(); // 15 + 100 = 115 <= 130, so the earlier $100 reservation is gone
  });
});

describe("uncertain failures", () => {
  it("never invent usage: a 4xx rejection is charge-free; 5xx, network and 408 stay reserved as uncertain", () => {
    expect(isChargeFree(new ProviderError("x", { retryable: false, status: 401 }))).toBe(true);
    expect(isChargeFree(new ProviderError("x", { retryable: true, status: 429 }))).toBe(true);
    expect(isChargeFree(new ProviderError("x", { retryable: true, status: 408 }))).toBe(false);
    expect(isChargeFree(new ProviderError("x", { retryable: true, status: 503 }))).toBe(false);
    expect(isChargeFree(new ProviderError("net", { retryable: true }))).toBe(false);
    const b = new Budget({ ...TEST_LIMITS, maxCostUsd: 1000 }, zero, PRICES);
    expect(b.fail(b.reserve(40, 10), false)).toEqual({ charge: "uncertain", reservedInputTokens: 40, reservedOutputTokens: 10, reservedCostUsd: 50 });
    expect(b.fail(b.reserve(40, 10), true)).toMatchObject({ charge: "none", reservedInputTokens: 0, reservedOutputTokens: 0 });
  });

  it("survive reconstruction: a resumed session does not get its budget back", async () => {
    const store = createMemoryStore();
    const { id } = store.createSession({ title: "t", repoLabel: "r", repoPath: "/r", ticket: "t", provider: { kind: "groq", label: "scripted", model: "m" }, isDemo: false });
    const limits = { ...TEST_LIMITS, maxCalls: 3, maxOutputTokens: 100_000 };
    const p = scripted([new ProviderError("503", { retryable: true, status: 503 })]);
    await expect(gen(p, new Budget(limits, store.getUsage(id), null), { maxRetries: 1, onFailedAttempt: (f) => store.recordFailedAttempt(id, "analyze", f) })).rejects.toThrow(StageError);
    expect(p.calls).toHaveLength(2);

    const usage = store.getUsage(id);
    expect(usage).toMatchObject({ calls: 0, inputTokens: 0, outputTokens: 0, failedAttempts: 2, uncertainAttempts: 2 }); // nothing reported or invented
    expect(usage.uncertainOutputTokens).toBe(20); // 2 attempts x 10 reserved output tokens, tracked separately

    const resumed = new Budget(limits, usage, null); // "new process", same persisted accounting
    const p2 = scripted([reply({ n: 1 })]);
    await expect(gen(p2, resumed)).resolves.toEqual({ n: 1 }); // third attempt allowed
    await expect(gen(p2, resumed)).rejects.toThrow(/call limit/); // the two failures stayed counted
  });
});
