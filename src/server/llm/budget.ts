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

/** Record of a dispatched request that produced no usable response, for persistence across resume. */
export interface FailedAttempt {
  /** "none": the API rejected it before generating (4xx, so no charge). "uncertain": it may have been billed. */
  charge: "none" | "uncertain";
  /** What stays reserved against the ceilings for this attempt (zero when charge is "none"). */
  reservedInputTokens: number;
  reservedOutputTokens: number;
  reservedCostUsd: number | null;
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
 * Failures without usage metadata are never turned into invented actual usage. Unless the API
 * rejected the request outright (4xx), the attempt keeps a conservative reservation (estimated
 * input, maximum output) as "uncertain" usage, tracked and persisted separately from reported usage.
 */
export class Budget {
  private attempts: number;
  private input: number; // reported + uncertain reservations
  private output: number;
  private cost: number;
  private pendingInput = 0;
  private pendingOutput = 0;
  private pendingCost = 0;

  constructor(
    readonly limits: SessionLimits,
    prior: Usage,
    private readonly prices: Prices | null = getPrices(),
  ) {
    if (limits.maxCostUsd !== null && prices === null) {
      throw new BudgetConfigError(
        "A dollar ceiling (READYSPEC_MAX_COST_USD) needs READYSPEC_PRICE_IN_PER_MTOK and READYSPEC_PRICE_OUT_PER_MTOK, both set explicitly to finite non-negative numbers (0 is allowed when explicit). Set them or remove the ceiling.",
      );
    }
    this.attempts = prior.calls + (prior.failedAttempts ?? 0);
    this.input = prior.inputTokens + (prior.uncertainInputTokens ?? 0);
    this.output = prior.outputTokens + (prior.uncertainOutputTokens ?? 0);
    this.cost = (prior.costUsd ?? 0) + (prior.uncertainCostUsd ?? 0);
  }

  /** Throws BudgetExceededError (nothing counted) if this request could breach a ceiling; otherwise counts the attempt. */
  reserve(estInputTokens: number, maxOutputTokens: number): Reservation {
    if (this.attempts + 1 > this.limits.maxCalls) throw new BudgetExceededError(`Model call limit reached (${this.limits.maxCalls})`);
    if (this.input + this.pendingInput + estInputTokens > this.limits.maxInputTokens) {
      throw new BudgetExceededError(`Input token limit would be exceeded (${this.limits.maxInputTokens})`);
    }
    if (this.output + this.pendingOutput + maxOutputTokens > this.limits.maxOutputTokens) {
      throw new BudgetExceededError(`Output token limit would be exceeded (${this.limits.maxOutputTokens})`);
    }
    const estCostUsd = costUsd(estInputTokens, maxOutputTokens, this.prices);
    if (this.limits.maxCostUsd !== null && estCostUsd !== null) {
      const projected = this.cost + this.pendingCost + estCostUsd;
      if (projected > this.limits.maxCostUsd + EPS) {
        throw new BudgetExceededError(`Cost limit would be exceeded ($${this.limits.maxCostUsd}; spent or reserved $${(this.cost + this.pendingCost).toFixed(4)} + this request up to $${estCostUsd.toFixed(4)})`);
      }
    }
    this.attempts += 1;
    this.pendingInput += estInputTokens;
    this.pendingOutput += maxOutputTokens;
    this.pendingCost += estCostUsd ?? 0;
    return { estInputTokens, maxOutputTokens, estCostUsd };
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
    const c = costUsd(inputTokens, outputTokens, this.prices);
    if (c !== null) this.cost += c;
    return c;
  }

  /** The request was dispatched but gave no usable response. The attempt stays counted; see class doc for the reservation. */
  fail(r: Reservation, chargeFree: boolean): FailedAttempt {
    this.release(r);
    if (chargeFree) return { charge: "none", reservedInputTokens: 0, reservedOutputTokens: 0, reservedCostUsd: 0 };
    this.input += r.estInputTokens;
    this.output += r.maxOutputTokens;
    this.cost += r.estCostUsd ?? 0;
    return { charge: "uncertain", reservedInputTokens: r.estInputTokens, reservedOutputTokens: r.maxOutputTokens, reservedCostUsd: r.estCostUsd };
  }
}
