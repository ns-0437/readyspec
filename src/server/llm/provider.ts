import type { ProviderInfo } from "@/shared/schemas";

export type StageName = "analyze" | "clarify" | "brief" | "judge" | "single_prompt";

export interface LlmRequest {
  stage: StageName;
  system: string;
  user: string;
  schemaName: string;
  /** JSON Schema for the structured result. */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  signal?: AbortSignal;
  /**
   * Typed stage input. ONLY the fixture provider reads this; real providers see the rendered
   * `system`/`user` prompts and nothing else, so what is disclosed is what is sent.
   */
  context?: unknown;
}

export interface LlmResponse {
  /** JSON text of the structured result. */
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmProvider {
  readonly info: ProviderInfo;
  /** True when request content leaves this machine. */
  readonly leavesMachine: boolean;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  constructor(message: string, opts: { retryable: boolean; status?: number | null }) {
    super(message);
    this.name = "ProviderError";
    this.retryable = opts.retryable;
    this.status = opts.status ?? null;
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled by user");
    this.name = "CancelledError";
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/** Rough token estimate (chars / 4) used for pre-call budget checks and disclosure. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
