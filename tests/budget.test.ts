import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Budget, BudgetConfigError, costUsd, getPrices, limitsFromEnv } from "@/server/llm/budget";
import { generateStructured, StageError } from "@/server/llm/generate";
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
    const failures: number[] = [];
    await expect(gen(p, b, { maxRetries: 5, onFailedAttempt: (f) => failures.push(f.reservedOutputTokens) })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(p.calls).toHaveLength(2); // two dispatched; the third was blocked before dispatch
    expect(failures).toEqual([10, 10]); // each keeps its maximum-output reservation
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

describe("failed dispatched attempts (usage unknown)", () => {
  const newSession = (store: ReturnType<typeof createMemoryStore>) =>
    store.createSession({ title: "t", repoLabel: "r", repoPath: "/r", ticket: "t", provider: { kind: "groq", label: "scripted", model: "m" }, isDemo: false }).id;

  it("an unclassified 4xx keeps its uncertain reservation: error statuses are not proof of no charge", async () => {
    for (const status of [400, 401, 413, 429]) {
      const p = scripted([new ProviderError(`HTTP ${status}`, { retryable: false, status })]);
      const b = new Budget({ ...TEST_LIMITS, maxCostUsd: 1000 }, zero, PRICES);
      const seen: { reservedInputTokens: number; reservedOutputTokens: number }[] = [];
      await expect(gen(p, b, { onFailedAttempt: (f) => seen.push(f) })).rejects.toThrow(StageError);
      expect(seen).toHaveLength(1);
      expect(seen[0]!.reservedOutputTokens).toBe(10); // maximum output stays reserved
      expect(seen[0]!.reservedInputTokens).toBeGreaterThan(0);
    }
  });

  it("a locally rejected precheck creates no attempt and no reservation", async () => {
    const p = scripted([reply({ n: 1 })]);
    const failures: unknown[] = [];
    const b = new Budget({ ...TEST_LIMITS, maxOutputTokens: 5 }, zero, null); // 10 max output cannot fit
    await expect(gen(p, b, { onFailedAttempt: (f) => failures.push(f) })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(p.calls).toHaveLength(0);
    expect(failures).toHaveLength(0);
    // and the attempt slot was not consumed: a request that fits still goes through on the same budget
    const ok = new Budget({ ...TEST_LIMITS, maxCalls: 1, maxOutputTokens: 5 }, zero, null);
    expect(() => ok.reserve(10, 10)).toThrow(BudgetExceededError);
    expect(() => ok.reserve(10, 5)).not.toThrow();
  });

  it("retries after unclassified errors stay counted and bounded by the call ceiling", async () => {
    const p = scripted([new ProviderError("HTTP 429", { retryable: true, status: 429 })]);
    const b = new Budget({ ...TEST_LIMITS, maxCalls: 3 }, zero, null);
    await expect(gen(p, b, { maxRetries: 50 })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(p.calls).toHaveLength(3);
  });

  it("unknown token reservations survive persistence and reconstruction, independent of price", async () => {
    const store = createMemoryStore();
    const id = newSession(store);
    const p = scripted([new ProviderError("503", { retryable: true, status: 503 })]);
    const limits = { ...TEST_LIMITS, maxCalls: 3, maxOutputTokens: 100_000 };
    await expect(gen(p, new Budget(limits, store.getUsage(id), null), { maxRetries: 1, onFailedAttempt: (f) => store.recordFailedAttempt(id, "analyze", f) })).rejects.toThrow(StageError);
    expect(p.calls).toHaveLength(2);

    const usage = store.getUsage(id);
    expect(usage).toMatchObject({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, failedAttempts: 2, uncertainOutputTokens: 20, failuresTracked: true }); // nothing reported or invented
    expect(usage.uncertainInputTokens).toBeGreaterThan(0);

    const resumed = new Budget(limits, usage, null);
    const p2 = scripted([reply({ n: 1 })]);
    await expect(gen(p2, resumed)).resolves.toEqual({ n: 1 }); // third attempt allowed
    await expect(gen(p2, resumed)).rejects.toThrow(/call limit/); // the two failures stayed counted
  });

  it("enabling a dollar ceiling after an unpriced failure does not treat the earlier exposure as free", () => {
    const store = createMemoryStore();
    const id = newSession(store);
    const unpriced = new Budget(TEST_LIMITS, store.getUsage(id), null);
    const r = unpriced.reserve(40, 10);
    store.recordFailedAttempt(id, "analyze", unpriced.fail(r)); // estimated exposure: 50 tokens, price unknown then
    store.recordUsage(id, "analyze", { inputTokens: 20, outputTokens: 5, costUsd: null, estimated: false }); // actual tokens, price unknown then

    // Later: $1/token prices and a $100 ceiling. Estimated exposure 50 + actual 25 are priced now = $75.
    const usage = store.getUsage(id);
    expect(usage).toMatchObject({ unpricedInputTokens: 20, unpricedOutputTokens: 5, uncertainInputTokens: 40, uncertainOutputTokens: 10 });
    const b = new Budget({ ...TEST_LIMITS, maxCostUsd: 100 }, usage, PRICES);
    expect(() => b.reserve(20, 10)).toThrow(BudgetExceededError); // 75 + 30 = 105 > 100
    expect(() => b.reserve(10, 10)).not.toThrow(); // 75 + 20 = 95 fits: it was neither free (would allow 20/10) nor double counted
    // the same history under an unpriced budget with no ceiling is simply unknown, not an error
    expect(() => new Budget(TEST_LIMITS, usage, null)).not.toThrow();
  });

  it("does not double count after settlement or reconstruction", () => {
    const store = createMemoryStore();
    const id = newSession(store);
    const first = new Budget({ ...TEST_LIMITS, maxCostUsd: 1000 }, store.getUsage(id), PRICES);
    const cost = first.settle(first.reserve(50, 50), 10, 5); // reservation replaced by reported usage
    store.recordUsage(id, "analyze", { inputTokens: 10, outputTokens: 5, costUsd: cost, estimated: false });
    store.recordFailedAttempt(id, "analyze", first.fail(first.reserve(30, 20)));

    // $15 reported (priced when recorded) + $50 estimated exposure = $65, once each.
    const rebuilt = new Budget({ ...TEST_LIMITS, maxCostUsd: 100 }, store.getUsage(id), PRICES);
    expect(() => rebuilt.reserve(20, 20)).toThrow(BudgetExceededError); // 65 + 40 = 105 > 100
    expect(() => rebuilt.reserve(20, 15)).not.toThrow(); // 65 + 35 = 100 fits exactly
  });

  it("blocks a dollar ceiling for sessions whose earlier failures were never recorded", () => {
    const store = createMemoryStore();
    const id = newSession(store);
    store.db.prepare("UPDATE usage_accounting SET failures_tracked = 0 WHERE session_id = ?").run(id); // as migration marks pre-tracking sessions
    const usage = store.getUsage(id);
    expect(usage.failuresTracked).toBe(false);
    expect(() => new Budget({ ...TEST_LIMITS, maxCostUsd: 10 }, usage, PRICES)).toThrow(/never recorded/);
    expect(() => new Budget(TEST_LIMITS, usage, PRICES)).not.toThrow(); // token and attempt limits still apply without a ceiling

    // rows written under the earlier "4xx is charge-free" rule recorded zero exposure: also unreliable
    const id2 = newSession(store);
    store.db.prepare("INSERT INTO usage_failures (session_id,at,stage,charge,reserved_input,reserved_output,reserved_cost_usd) VALUES (?,?,?,?,0,0,0)").run(id2, "t", "analyze", "none");
    expect(store.getUsage(id2).failuresTracked).toBe(false);
  });

  it("migration: a session present before the accounting table exists is marked untracked when the DB is opened", async () => {
    const { openDatabase } = await import("@/server/persistence/db");
    const { Store } = await import("@/server/persistence/store");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "readyspec-mig-"));
    try {
      const file = path.join(dir, "old.db");
      const db = openDatabase(file);
      db.prepare("INSERT INTO sessions (id,title,repo_path,repo_label,ticket,provider_json,status,round,is_demo,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("s_old", "t", "/r", "r", "t", "{}", "created", 1, 0, "x", "x");
      db.exec("DROP TABLE usage_accounting"); // what a database from before this change looks like
      db.close();
      const reopened = new Store(openDatabase(file));
      expect(reopened.getUsage("s_old").failuresTracked).toBe(false);
      const fresh = reopened.createSession({ title: "t", repoLabel: "r", repoPath: "/r", ticket: "t", provider: { kind: "groq", label: "l", model: "m" }, isDemo: false });
      expect(reopened.getUsage(fresh.id).failuresTracked).toBe(true);
      reopened.db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("optional configuration", () => {
  it("an absent dollar ceiling is valid: token and attempt limits still apply, cost stays unknown", () => {
    const b = new Budget({ ...TEST_LIMITS, maxCalls: 1 }, zero, null);
    expect(b.settle(b.reserve(10, 10), 5, 5)).toBeNull(); // unpriced: cost unknown, not zero
    expect(() => b.reserve(1, 1)).toThrow(/call limit/);
  });

  it("explicit zero prices keep a ceiling valid; invalid explicit values are rejected", () => {
    expect(() => new Budget({ ...TEST_LIMITS, maxCostUsd: 5 }, zero, { inPerMTok: 0, outPerMTok: 0 })).not.toThrow();
    expect(() => limitsFromEnv({ READYSPEC_MAX_COST_USD: "NaN" })).toThrow(BudgetConfigError);
    expect(() => limitsFromEnv({ READYSPEC_MAX_COST_USD: "Infinity" })).toThrow(BudgetConfigError);
    expect(() => new Budget({ ...TEST_LIMITS, maxCostUsd: 5 }, zero, getPrices({ READYSPEC_PRICE_IN_PER_MTOK: "1", READYSPEC_PRICE_OUT_PER_MTOK: "x" }))).toThrow(BudgetConfigError);
  });

  it("the fixture provider needs no keys, prices or ceiling", async () => {
    const { createProvider } = await import("@/server/llm");
    const p = createProvider({});
    expect(p.info.kind).toBe("fixture");
    expect(() => new Budget(limitsFromEnv({}), zero, getPrices({}))).not.toThrow();
  });
});
