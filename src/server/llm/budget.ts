import type { SessionLimits, Usage } from "@/shared/schemas";
import { BudgetExceededError } from "./provider";

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function limitsFromEnv(): SessionLimits {
  const cost = Number(process.env.READYSPEC_MAX_COST_USD);
  return {
    maxCalls: envNumber("READYSPEC_MAX_CALLS", 14),
    maxInputTokens: envNumber("READYSPEC_MAX_INPUT_TOKENS", 200_000),
    maxOutputTokens: envNumber("READYSPEC_MAX_OUTPUT_TOKENS", 60_000),
    maxCostUsd: Number.isFinite(cost) && cost > 0 ? cost : null,
  };
}

/**
 * Cost from token counts using prices supplied by the operator (USD per million tokens).
 * No prices are hard-coded: they go stale, and a wrong number is worse than "unknown".
 */
export function costUsd(inputTokens: number, outputTokens: number): number | null {
  const pin = Number(process.env.READYSPEC_PRICE_IN_PER_MTOK);
  const pout = Number(process.env.READYSPEC_PRICE_OUT_PER_MTOK);
  if (!Number.isFinite(pin) || !Number.isFinite(pout) || pin <= 0 || pout <= 0) return null;
  return (inputTokens * pin + outputTokens * pout) / 1_000_000;
}

/** Enforces per-session call/token/cost ceilings. Counts include usage from earlier stages. */
export class Budget {
  private calls: number;
  private input: number;
  private output: number;
  private cost: number;

  constructor(
    readonly limits: SessionLimits,
    prior: Usage,
  ) {
    this.calls = prior.calls;
    this.input = prior.inputTokens;
    this.output = prior.outputTokens;
    this.cost = prior.costUsd ?? 0;
  }

  /** Throws before a call that would exceed a ceiling. */
  precheck(estInputTokens: number, maxOutputTokens: number): void {
    if (this.calls + 1 > this.limits.maxCalls) throw new BudgetExceededError(`Model call limit reached (${this.limits.maxCalls})`);
    if (this.input + estInputTokens > this.limits.maxInputTokens) {
      throw new BudgetExceededError(`Input token limit would be exceeded (${this.limits.maxInputTokens})`);
    }
    if (this.output + maxOutputTokens > this.limits.maxOutputTokens) {
      throw new BudgetExceededError(`Output token limit would be exceeded (${this.limits.maxOutputTokens})`);
    }
    if (this.limits.maxCostUsd !== null && this.cost >= this.limits.maxCostUsd) {
      throw new BudgetExceededError(`Cost limit reached ($${this.limits.maxCostUsd})`);
    }
  }

  record(inputTokens: number, outputTokens: number): number | null {
    this.calls += 1;
    this.input += inputTokens;
    this.output += outputTokens;
    const c = costUsd(inputTokens, outputTokens);
    if (c !== null) this.cost += c;
    return c;
  }
}
