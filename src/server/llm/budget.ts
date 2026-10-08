import type { SessionLimits, Usage } from "@/shared/schemas";
import { BudgetExceededError } from "./provider";

/** Unusable budget configuration (for example a dollar ceiling with no prices). Never silently ignored. */
export class BudgetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetConfigError";
  }
}

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function limitsFromEnv(env: Record<string, string | undefined> = process.env): SessionLimits {
  const raw = env.READYSPEC_MAX_COST_USD?.trim();
  let maxCostUsd: number | null = null;
  if (raw) {
    const n = Number(raw);
    // A set-but-malformed ceiling must fail loudly: treating it as "no ceiling" would disable the cap.
    if (!Number.isFinite(n) || n < 0) throw new BudgetConfigError(`READYSPEC_MAX_COST_USD must be a finite non-negative number, got "${raw}"`);
    maxCostUsd = n;
  }
  return {
    maxCalls: envNumber("READYSPEC_MAX_CALLS", 14),
    maxInputTokens: envNumber("READYSPEC_MAX_INPUT_TOKENS", 200_000),
    maxOutputTokens: envNumber("READYSPEC_MAX_OUTPUT_TOKENS", 60_000),
    maxCostUsd,
  };
}

/** Operator-supplied prices, USD per million tokens. */
export interface Prices {
  inPerMTok: number;
  outPerMTok: number;
}

const explicitPrice = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null; // unset is not zero: Number("") would be 0
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Both prices explicitly set to finite, non-negative numbers (0 is valid when explicit), else null. */
export function getPrices(env: Record<string, string | undefined> = process.env): Prices | null {
  const i = explicitPrice(env.READYSPEC_PRICE_IN_PER_MTOK);
  const o = explicitPrice(env.READYSPEC_PRICE_OUT_PER_MTOK);
  return i === null || o === null ? null : { inPerMTok: i, outPerMTok: o };
}

/**
 * Cost from token counts using prices supplied by the operator. No prices are hard-coded: they go
 * stale, and a wrong number is worse than "unknown" (null).
 */
export function costUsd(inputTokens: number, outputTokens: number, prices: Prices | null = getPrices()): number | null {
  if (!prices) return null;
  return (inputTokens * prices.inPerMTok + outputTokens * prices.outPerMTok) / 1_000_000;
}

/** What one dispatched-but-not-yet-settled request has reserved. */
export interface Reservation {
  estInputTokens: number;
  maxOutputTokens: number;
  estCostUsd: number | null;
}

/**
 * A dispatched request that produced no usable response, for persistence across resume. Only the
 * token reservation is recorded: it is an ESTIMATE of possible exposure (estimated input + maximum
 * output), not actual usage. Dollars are derived from the prices configured when a budget is rebuilt.
 */
export interface FailedAttempt {
  reservedInputTokens: number;
  reservedOutputTokens: number;
}

export interface BudgetTotals {
  attempts: number;
  settledCalls: number;
  failedAttempts: number;
  reportedInputTokens: number;
  reportedOutputTokens: number;
  uncertainInputTokens: number;
  uncertainOutputTokens: number;
  /** Reported cost plus the priced estimate of uncertain exposure; null when no prices are configured. An estimate, not a bill. */
  estimatedCostUsd: number | null;
}

const EPS = 1e-9;

/**
 * Enforces per-session ceilings on dispatched request attempts, tokens and dollars.
 *
 * Lifecycle per model request: reserve() (prechecks, then counts the attempt) -> provider call ->
 * settle() with reported usage, or fail() when no usable response came back. A rejected precheck
 * is never counted as a dispatched request. Estimates are chars/4 heuristics, so a dollar ceiling
 * is a best-effort guard, not an exact billing guarantee: real tokenization and provider billing
 * can differ from the estimate.
 *
 * Actual usage is what a provider REPORTED. A dispatched request that returns no usage (HTTP error of
 * any status, network failure, timeout, cancellation) is unknown: it may or may not have been billed,
 * and error statuses are not treated as proof of "no charge". Such an attempt stays counted and keeps
 * a conservative reservation (estimated input, maximum output) tracked and persisted separately from
 * reported usage, and is never recorded as actual usage. Only a precheck rejected locally, before
 * any request was sent, costs nothing. The call ceiling bounds how many attempts can accumulate.
 */
export class Budget {
  private attempts: number;
  private input: number; // reported + uncertain reservations
  private output: number;
  private cost: number;
  private reportedIn = 0;
  private reportedOut = 0;
  private uncertainIn: number;
  private uncertainOut: number;
  private settledCalls = 0;
  private failedCalls = 0;
  private pendingInput = 0;
  private pendingOutput = 0;
  private pendingCost = 0;

  constructor(
    readonly limits: SessionLimits,
    prior: Usage,
    private readonly prices: Prices | null = getPrices(),
    private readonly scope: "session" | "run" = "session",
  ) {
    if (limits.maxCostUsd !== null && prices === null) {
      throw new BudgetConfigError(
        "A dollar ceiling (READYSPEC_MAX_COST_USD) needs READYSPEC_PRICE_IN_PER_MTOK and READYSPEC_PRICE_OUT_PER_MTOK, both set explicitly to finite non-negative numbers (0 is allowed when explicit). Set them or remove the ceiling.",
      );
    }
    if (limits.maxCostUsd !== null && prior.failuresTracked === false) {
      throw new BudgetConfigError(
        "This session has failed model requests that were never recorded (it predates failed-attempt tracking), so its earlier possible spend cannot be reconstructed and a dollar ceiling cannot be enforced for it. Start a new session or remove READYSPEC_MAX_COST_USD.",
      );
    }
    const uncertainIn = prior.uncertainInputTokens ?? 0;
    const uncertainOut = prior.uncertainOutputTokens ?? 0;
    this.uncertainIn = uncertainIn;
    this.uncertainOut = uncertainOut;
    this.reportedIn = prior.inputTokens;
    this.reportedOut = prior.outputTokens;
    this.settledCalls = prior.calls;
    this.failedCalls = prior.failedAttempts ?? 0;
    this.attempts = prior.calls + (prior.failedAttempts ?? 0);
    this.input = prior.inputTokens + uncertainIn;
    this.output = prior.outputTokens + uncertainOut;
    // Dollars are rebuilt from tokens with the CURRENT prices, so nothing recorded while unpriced counts as free:
    //   known reported cost (rows priced when recorded; disjoint from the next term)
    // + reported tokens whose cost was unknown when recorded, priced now (actual tokens, estimated price)
    // + the estimated exposure of failed attempts, priced now (an estimate, never an actual charge).
    this.cost =
      (prior.costUsd ?? 0) +
      (costUsd(prior.unpricedInputTokens ?? 0, prior.unpricedOutputTokens ?? 0, prices) ?? 0) +
      (costUsd(uncertainIn, uncertainOut, prices) ?? 0);
  }

  /** Throws BudgetExceededError (nothing counted) if this request could breach a ceiling; otherwise counts the attempt. */
  reserve(estInputTokens: number, maxOutputTokens: number): Reservation {
    if (this.attempts + 1 > this.limits.maxCalls) throw new BudgetExceededError(`${this.label()} model call limit reached (${this.limits.maxCalls})`, this.scope);
    if (this.input + this.pendingInput + estInputTokens > this.limits.maxInputTokens) {
      throw new BudgetExceededError(`${this.label()} input token limit would be exceeded (${this.limits.maxInputTokens})`, this.scope);
    }
    if (this.output + this.pendingOutput + maxOutputTokens > this.limits.maxOutputTokens) {
      throw new BudgetExceededError(`${this.label()} output token limit would be exceeded (${this.limits.maxOutputTokens})`, this.scope);
    }
    const estCostUsd = costUsd(estInputTokens, maxOutputTokens, this.prices);
    if (this.limits.maxCostUsd !== null && estCostUsd !== null) {
      const projected = this.cost + this.pendingCost + estCostUsd;
      if (projected > this.limits.maxCostUsd + EPS) {
        throw new BudgetExceededError(`${this.label()} cost limit would be exceeded ($${this.limits.maxCostUsd}; spent or reserved $${(this.cost + this.pendingCost).toFixed(4)} + this request up to $${estCostUsd.toFixed(4)})`, this.scope);
      }
    }
    this.attempts += 1;
    this.pendingInput += estInputTokens;
    this.pendingOutput += maxOutputTokens;
    this.pendingCost += estCostUsd ?? 0;
    return { estInputTokens, maxOutputTokens, estCostUsd };
  }

  private label(): string {
    return this.scope === "run" ? "Run-wide" : "Session";
  }

  /**
   * Cancels a reservation whose request was never dispatched (a different budget refused it first),
   * giving back the attempt slot. Never use for a request that was actually sent: that is fail().
   */
  unreserve(r: Reservation): void {
    this.release(r);
    this.attempts -= 1;
  }

  /** Counters for reporting. reported* is what providers said they used; uncertain* is estimated exposure of unanswered requests (not actual usage). */
  totals(): BudgetTotals {
    return {
      attempts: this.attempts,
      settledCalls: this.settledCalls,
      failedAttempts: this.failedCalls,
      reportedInputTokens: this.reportedIn,
      reportedOutputTokens: this.reportedOut,
      uncertainInputTokens: this.uncertainIn,
      uncertainOutputTokens: this.uncertainOut,
      estimatedCostUsd: this.prices ? this.cost : null,
    };
  }

  private release(r: Reservation): void {
    this.pendingInput -= r.estInputTokens;
    this.pendingOutput -= r.maxOutputTokens;
    this.pendingCost -= r.estCostUsd ?? 0;
  }

  /** The request returned usage (even if the content later fails validation): replace the reservation with it. Returns its cost, or null if unpriced. */
  settle(r: Reservation, inputTokens: number, outputTokens: number): number | null {
    this.release(r);
    this.input += inputTokens;
    this.output += outputTokens;
    this.reportedIn += inputTokens;
    this.reportedOut += outputTokens;
    this.settledCalls += 1;
    const c = costUsd(inputTokens, outputTokens, this.prices);
    if (c !== null) this.cost += c;
    return c;
  }

  /** The request was dispatched but gave no usable response: usage unknown. The attempt stays counted and keeps its estimated reservation (see class doc). */
  fail(r: Reservation): FailedAttempt {
    this.release(r);
    this.input += r.estInputTokens;
    this.output += r.maxOutputTokens;
    this.uncertainIn += r.estInputTokens;
    this.uncertainOut += r.maxOutputTokens;
    this.failedCalls += 1;
    this.cost += r.estCostUsd ?? 0;
    return { reservedInputTokens: r.estInputTokens, reservedOutputTokens: r.maxOutputTokens };
  }
}
