import { z } from "zod";
import type { ProviderInfo } from "@/shared/schemas";
import { redactSecrets } from "@/shared/redact";
import { CancelledError, ProviderError, type LlmProvider, type LlmRequest, type LlmResponse } from "./provider";

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
 * a 400; this is best-effort and has not been checked against the live API (see docs/decisions.md).
 */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== "object") return schema;
  const DROP = new Set(["$schema", "additionalProperties", "$ref", "const", "examples", "title"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (DROP.has(k)) continue;
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
      throw new ProviderError(`Model API returned ${res.status}${detail ? `: ${detail}` : ""}`, { retryable, status: res.status });
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
