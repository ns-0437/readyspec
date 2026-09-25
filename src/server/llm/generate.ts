import { z } from "zod";
import { redactSecrets } from "@/shared/redact";
import type { Budget } from "./budget";
import { BudgetExceededError, CancelledError, estimateTokens, ProviderError, type LlmProvider, type StageName } from "./provider";

export interface GenerateOptions<T> {
  provider: LlmProvider;
  budget: Budget;
  stage: StageName;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
  context?: unknown;
  /** Extra attempts after the first (validation failures and retryable provider errors). */
  maxRetries?: number;
  /** Base backoff in ms (doubles each retry). Tests pass 0. */
  backoffMs?: number;
  onUsage?: (u: { inputTokens: number; outputTokens: number; costUsd: number | null; estimated: boolean }) => void;
  onEvent?: (level: "info" | "warn", message: string) => void;
}

export class StageError extends Error {
  readonly recoverable: boolean;
  constructor(message: string, recoverable: boolean) {
    super(message);
    this.name = "StageError";
    this.recoverable = recoverable;
  }
}

/** Pull a JSON object out of model text (tolerates code fences and leading prose). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));
  throw new SyntaxError("No JSON object found in model output");
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new CancelledError());
    });
  });

const MAX_RETRY_WAIT_MS = 90_000;

/**
 * A provider that says exactly how long to wait (e.g. a per-minute token-rate 429) knows better
 * than a fixed exponential backoff, which was sized for generic transient errors and can be far
 * shorter than an actual rate-limit window (seen live with Groq: docs/decisions.md 21). Capped so
 * one bad header can't stall a job far longer than any real rate-limit window we've seen.
 */
export function computeRetryWaitMs(backoffMs: number, attempt: number, retryAfterMs: number | null): number {
  return Math.min(Math.max(backoffMs * 2 ** attempt, retryAfterMs ?? 0), MAX_RETRY_WAIT_MS);
}

/**
 * One structured model call with: budget precheck, cancellation, bounded retries (transient
 * provider errors and schema-validation failures), and Zod validation of the result.
 */
export async function generateStructured<T>(opts: GenerateOptions<T>): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  const backoff = opts.backoffMs ?? 600;
  const jsonSchema = z.toJSONSchema(opts.schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  let user = opts.user;
  let lastProblem = "unknown failure";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted) throw new CancelledError();
    opts.budget.precheck(estimateTokens(opts.system) + estimateTokens(user), opts.maxOutputTokens);
    try {
      const res = await opts.provider.complete({
        stage: opts.stage,
        system: opts.system,
        user,
        schemaName: opts.schemaName,
        jsonSchema,
        maxOutputTokens: opts.maxOutputTokens,
        signal: opts.signal,
        context: opts.context,
      });
      const cost = opts.budget.record(res.usage.inputTokens, res.usage.outputTokens);
      opts.onUsage?.({ ...res.usage, costUsd: cost, estimated: opts.provider.info.kind === "fixture" });

      let parsed: unknown;
      try {
        parsed = extractJson(res.text);
      } catch (e) {
        lastProblem = `output was not valid JSON (${(e as Error).message})`;
        opts.onEvent?.("warn", `${opts.stage}: ${lastProblem}; retrying`);
        user = `${opts.user}\n\nYour previous reply was not valid JSON. Return only the JSON object.`;
        continue;
      }
      const result = opts.schema.safeParse(parsed);
      if (result.success) return result.data;
      lastProblem = "schema validation failed: " + result.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      opts.onEvent?.("warn", `${opts.stage}: ${lastProblem}; retrying`);
      user = `${opts.user}\n\nYour previous reply failed validation: ${lastProblem}. Return corrected JSON only.`;
    } catch (e) {
      if (e instanceof CancelledError || e instanceof BudgetExceededError) throw e;
      if (opts.signal?.aborted) throw new CancelledError();
      if (e instanceof ProviderError && e.retryable && attempt < maxRetries) {
        lastProblem = redactSecrets(e.message);
        const wait = computeRetryWaitMs(backoff, attempt, e.retryAfterMs);
        opts.onEvent?.("warn", `${opts.stage}: transient provider error (${lastProblem}); retry ${attempt + 1}/${maxRetries} in ${wait}ms`);
        await sleep(wait, opts.signal);
        continue;
      }
      if (e instanceof ProviderError) throw new StageError(redactSecrets(e.message), e.retryable);
      throw e;
    }
  }
  throw new StageError(`${opts.stage}: gave up after ${maxRetries + 1} attempts (${lastProblem})`, true);
}
