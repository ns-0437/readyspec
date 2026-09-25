import { z } from "zod";
import type { ProviderInfo } from "@/shared/schemas";
import { redactSecrets } from "@/shared/redact";
import { CancelledError, ProviderError, parseRetryAfterMs, type LlmProvider, type LlmRequest, type LlmResponse } from "./provider";

const GeminiResponse = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).optional() }).optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  usageMetadata: z.object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional() }).optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
});

export interface GeminiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Strip JSON Schema keywords Gemini's `responseSchema` does not accept (it takes a restricted
 * OpenAPI-3.0-style subset, not full JSON Schema). Unknown keys are dropped rather than causing
 * a 400. Every entry here was hit live against gemini-3.6-flash on the app's own schemas and
 * confirmed by the exact 400 message (see docs/decisions.md 14) — `propertyNames` and
 * `additionalProperties` (both from Zod's `z.record`) and `const` (from a literal-valued field)
 * are each rejected by name with "Cannot find field". Losing `additionalProperties` means an
 * object typed via `z.record` degrades to an untyped `{"type":"object"}` for this provider: the
 * model can still return arbitrary key/value pairs, just without a declared value type.
 *
 * Separately (also hit live, different error: "Proto field is not repeating, cannot start
 * list."): Zod renders a `.nullable()` field as JSON Schema 2020-12's `"type": ["string",
 * "null"]`, but Gemini's Schema proto wants a single scalar `type` plus OpenAPI-style
 * `nullable: true`. That translation happens below.
 */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== "object") return schema;
  const DROP = new Set(["$schema", "$ref", "propertyNames", "additionalProperties", "const"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (DROP.has(k)) continue;
    if (k === "type" && Array.isArray(v)) {
      const types = v as unknown[];
      const nonNull = types.find((t) => t !== "null");
      out.type = nonNull ?? types[0];
      if (types.includes("null")) out.nullable = true;
      continue;
    }
    out[k] = toGeminiSchema(v);
  }
  return out;
}

/**
 * Gemini `generateContent` via plain `fetch` (no SDK). Structured output uses
 * `generationConfig.responseMimeType: "application/json"` with a `responseSchema` derived from
 * the stage's JSON Schema, mirroring how the Anthropic adapter forces a tool call.
 */
export class GeminiProvider implements LlmProvider {
  readonly info: ProviderInfo;
  readonly leavesMachine = true;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: GeminiOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.info = { kind: "gemini", label: `Gemini ${opts.model}`, model: opts.model };
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const signals = [AbortSignal.timeout(this.timeoutMs)];
    if (req.signal) signals.push(req.signal);
    const signal = AbortSignal.any(signals);

    let res: Response;
    try {
      // The key goes in a header, not the URL, so it never lands in server access logs or a proxy's URL history.
      res = await fetch(`${this.baseUrl}/v1beta/models/${encodeURIComponent(this.info.model!)}:generateContent`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { role: "system", parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig: {
            maxOutputTokens: req.maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(req.jsonSchema),
            // Reasoning models (e.g. gemini-3.x) spend hidden "thinking" tokens out of the same
            // maxOutputTokens budget before writing the answer; verified live that a stage-sized
            // budget (a few hundred to a few thousand tokens) can be exhausted entirely by
            // thinking, leaving finishReason: MAX_TOKENS and no JSON at all. We need reliable
            // structured output, not open-ended reasoning, so thinking is switched off. Ignored
            // (harmlessly) by models that don't support it.
            thinkingConfig: { thinkingBudget: 0 },
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
      throw new ProviderError(`Model API returned ${res.status}${detail ? `: ${detail}` : ""}`, { retryable, status: res.status, retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")) });
    }

    const parsed = GeminiResponse.safeParse(await res.json());
    // Every real response has one of these; neither present means the body isn't a Gemini response at all.
    if (!parsed.success || (!parsed.data.candidates && !parsed.data.promptFeedback)) {
      throw new ProviderError("Model API returned an unexpected response shape", { retryable: false });
    }
    if (parsed.data.promptFeedback?.blockReason) {
      throw new ProviderError(`Model blocked the request: ${parsed.data.promptFeedback.blockReason}`, { retryable: false });
    }
    const candidate = parsed.data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) {
      const why = candidate?.finishReason ? ` (finishReason: ${candidate.finishReason})` : "";
      throw new ProviderError(`Model returned no structured result${why}`, { retryable: true });
    }
    return {
      text,
      usage: { inputTokens: parsed.data.usageMetadata?.promptTokenCount ?? 0, outputTokens: parsed.data.usageMetadata?.candidatesTokenCount ?? 0 },
    };
  }
}
