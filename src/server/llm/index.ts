import { AnthropicProvider } from "./anthropic";
import { FixtureProvider } from "./fixture";
import type { LlmProvider } from "./provider";

export const DEFAULT_MODEL = "claude-sonnet-5";

/**
 * Provider selection (server-side only; the key never reaches the browser):
 *   READYSPEC_PROVIDER=fixture | anthropic   (default: anthropic if ANTHROPIC_API_KEY is set, else fixture)
 *   ANTHROPIC_API_KEY, READYSPEC_MODEL, ANTHROPIC_BASE_URL (optional)
 */
export function createProvider(env: Record<string, string | undefined> = process.env): LlmProvider {
  const wanted = env.READYSPEC_PROVIDER?.toLowerCase();
  const key = env.ANTHROPIC_API_KEY;
  if (wanted === "fixture" || (!wanted && !key)) return new FixtureProvider();
  if (!key) throw new Error("READYSPEC_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
  return new AnthropicProvider({ apiKey: key, model: env.READYSPEC_MODEL || DEFAULT_MODEL, baseUrl: env.ANTHROPIC_BASE_URL });
}

export type { LlmProvider } from "./provider";
