import { z } from "zod";
import type { ProviderInfo } from "@/shared/schemas";
import { redactSecrets } from "@/shared/redact";
import { CancelledError, ProviderError, parseRetryAfterMs, type LlmProvider, type LlmRequest, type LlmResponse } from "./provider";

// choices is required (not .optional()) so a body that isn't actually a chat-completion response
// (e.g. an unexpected 200 with an unrelated shape) fails Zod validation and is correctly treated
// as non-retryable, rather than silently parsing into "no structured result" (which is retryable).
const GroqResponse = z.object({
  choices: z.array(
    z.object({
      message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }).optional(),
      finish_reason: z.string().optional(),
    }),
  ),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).optional(),
});

export interface GroqOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/** Groq requires a schema `name` matching ^[a-zA-Z0-9_-]+$, up to 64 chars. */
function groqSchemaName(schemaName: string): string {
  const cleaned = schemaName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return cleaned || "result";
}

/**
 * Groq's OpenAI-compatible `/chat/completions` API via plain `fetch` (no SDK). Structured output
 * uses `response_format: { type: "json_schema" }` with `strict: false` (best-effort schema
 * compliance, not constrained decoding) -- this app's own generateStructured() already validates
 * the result with Zod and retries on drift, the same safety net the Anthropic and Gemini adapters
 * rely on, so strict mode's extra constraints (every field required, additionalProperties: false
 * on every object) aren't needed and would fight this app's genuinely-optional schema fields.
 * Unlike Gemini's proto-based Schema type, this endpoint accepts standard JSON Schema, so (unlike
 * gemini.ts's toGeminiSchema) no translation has been needed so far -- not yet live-validated
 * against a real key, though; see docs/live-validation.md.
 */
export class GroqProvider implements LlmProvider {
  readonly info: ProviderInfo;
  readonly leavesMachine = true;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: GroqOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.groq.com/openai/v1").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.info = { kind: "groq", label: `Groq ${opts.model}`, model: opts.model };
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const signals = [AbortSignal.timeout(this.timeoutMs)];
    if (req.signal) signals.push(req.signal);
    const signal = AbortSignal.any(signals);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.info.model,
          max_completion_tokens: req.maxOutputTokens,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: groqSchemaName(req.schemaName), schema: req.jsonSchema, strict: false },
          },
        }),
      });
    } catch (e) {
      if (req.signal?.aborted) throw new CancelledError();
      const timedOut = (e as Error).name === "TimeoutError";
      throw new ProviderError(timedOut ? "Model request timed out" : "Network error calling the model API", { retryable: true });
    }

    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        detail = redactSecrets((j.error?.message ?? "").split(this.apiKey).join("[REDACTED]")).slice(0, 200);
      } catch {
        /* ignore */
      }
      const retryable = res.status === 429 || res.status >= 500;
      // Groq's 429s carry a real Retry-After (its TPM window is short -- as little as 8000
      // tokens/minute on the free tier -- so the default exponential backoff undershoots it badly;
      // confirmed live, docs/decisions.md 21).
      throw new ProviderError(`Model API returned ${res.status}${detail ? `: ${detail}` : ""}`, { retryable, status: res.status, retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")) });
    }

    const parsed = GroqResponse.safeParse(await res.json());
    if (!parsed.success) throw new ProviderError("Model API returned an unexpected response shape", { retryable: false });
    const choice = parsed.data.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (!text) {
      const why = choice?.message?.refusal ? `: ${choice.message.refusal}` : choice?.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : "";
      throw new ProviderError(`Model returned no structured result${why}`, { retryable: true });
    }
    return {
      text,
      usage: { inputTokens: parsed.data.usage?.prompt_tokens ?? 0, outputTokens: parsed.data.usage?.completion_tokens ?? 0 },
    };
  }
}
