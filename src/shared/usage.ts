import type { Usage } from "./schemas";

/**
 * One-line usage summary for the UI. Failed requests count against the call limit, so they must be
 * visible here; their tokens are reservations held against the limits and are never shown as usage.
 */
export function usageSummary(u: Usage): string {
  const failed = u.failedAttempts ?? 0;
  const reservedIn = u.uncertainInputTokens ?? 0;
  const reservedOut = u.uncertainOutputTokens ?? 0;
  const unpriced = (u.unpricedInputTokens ?? 0) + (u.unpricedOutputTokens ?? 0);
  const n = (v: number) => v.toLocaleString("en-US");

  const parts = [
    failed ? `${u.calls + failed} model request(s) counted: ${u.calls} answered, ${failed} failed` : `${u.calls} model call(s)`,
    `${n(u.inputTokens)} in / ${n(u.outputTokens)} out tokens${u.estimated ? " (fixture estimate)" : ""}`,
  ];
  if (reservedIn || reservedOut) parts.push(`~${n(reservedIn)} in / ${n(reservedOut)} out held for failed requests (estimate, not actual usage)`);
  if (u.costUsd === null) parts.push("cost unknown (set READYSPEC_PRICE_* to compute)");
  else parts.push(failed || unpriced ? `$${u.costUsd.toFixed(4)} known cost (incomplete)` : `$${u.costUsd.toFixed(4)}`);
  if (u.failuresTracked === false) parts.push("earlier failed requests were not recorded");
  return parts.join(" · ");
}
