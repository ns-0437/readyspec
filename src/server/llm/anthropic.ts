import { z } from "zod";
import type { ProviderInfo } from "@/shared/schemas";
import { redactSecrets } from "@/shared/redact";
import { CancelledError, ProviderError, parseRetryAfterMs, type LlmProvider, type LlmRequest, type LlmResponse } from "./provider";

const AnthropicResponse = z.object({
  content: z.array(z.object({ type: z.string(), name: z.string().optional(), input: z.unknown().optional(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
}

const TOOL_NAME = "emit_result";

/**
 * Anthropic Messages API via plain fetch (no SDK, one dependency less). Structured output is
 * obtained by forcing a single tool call whose input schema is the stage's JSON Schema.
 * The API key lives only in this object and the request header; it is never logged.
 */
export class AnthropicProvider implements LlmProvider {
  readonly info: ProviderInfo;
  readonly leavesMachine = true;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: AnthropicOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.info = { kind: "anthropic", label: `Anthropic ${opts.model}`, model: opts.model };
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const signals = [AbortSignal.timeout(this.timeoutMs)];
    if (req.signal) signals.push(req.signal);
    const signal = AbortSignal.any(signals);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.info.model,
          max_tokens: req.maxOutputTokens,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          tools: [{ name: TOOL_NAME, description: `Return the ${req.schemaName} result.`, input_schema: req.jsonSchema }],
          tool_choice: { type: "tool", name: TOOL_NAME },
        }),
      });
    } catch (e) {
      if (req.signal?.aborted) throw new CancelledError();
      const timedOut = (e as Error).name === "TimeoutError";
      throw new ProviderError(timedOut ? "Model request timed out" : "Network error calling the model API", { retryable: true });
    }

    if (!res.ok) {
      // The body may echo request content; keep only the API's short error message.
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

    const parsed = AnthropicResponse.safeParse(await res.json());
    if (!parsed.success) throw new ProviderError("Model API returned an unexpected response shape", { retryable: false });
    const tool = parsed.data.content.find((c) => c.type === "tool_use" && c.name === TOOL_NAME);
    const text = tool ? JSON.stringify(tool.input) : parsed.data.content.find((c) => c.type === "text")?.text;
    if (!text) throw new ProviderError("Model returned no structured result", { retryable: true });
    return { text, usage: { inputTokens: parsed.data.usage.input_tokens, outputTokens: parsed.data.usage.output_tokens } };
  }
}
