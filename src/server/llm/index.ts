import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { FixtureProvider } from "./fixture";
import type { LlmProvider } from "./provider";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

/**
 * Provider selection (server-side only; keys never reach the browser):
 *   READYSPEC_PROVIDER=fixture | anthropic | gemini   (explicit choice wins; errors if that
 *     provider's key is missing rather than silently falling back)
 *   Unset: ANTHROPIC_API_KEY -> anthropic; else GEMINI_API_KEY/GOOGLE_API_KEY -> gemini; else fixture.
 *   READYSPEC_MODEL overrides the default model id for whichever provider is selected.
 *   ANTHROPIC_BASE_URL / GEMINI_BASE_URL override the API host (testing only).
 */
export function createProvider(env: Record<string, string | undefined> = process.env): LlmProvider {
  const wanted = env.READYSPEC_PROVIDER?.toLowerCase();
  const anthropicKey = env.ANTHROPIC_API_KEY;
  const geminiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;

  const makeAnthropic = () => {
    if (!anthropicKey) throw new Error("READYSPEC_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
    return new AnthropicProvider({ apiKey: anthropicKey, model: env.READYSPEC_MODEL || DEFAULT_ANTHROPIC_MODEL, baseUrl: env.ANTHROPIC_BASE_URL });
  };
  const makeGemini = () => {
    if (!geminiKey) throw new Error("READYSPEC_PROVIDER=gemini requires GEMINI_API_KEY (or GOOGLE_API_KEY)");
    return new GeminiProvider({ apiKey: geminiKey, model: env.READYSPEC_MODEL || DEFAULT_GEMINI_MODEL, baseUrl: env.GEMINI_BASE_URL });
  };

  if (wanted === "fixture") return new FixtureProvider();
  if (wanted === "anthropic") return makeAnthropic();
  if (wanted === "gemini") return makeGemini();
  if (wanted) throw new Error(`Unknown READYSPEC_PROVIDER "${wanted}" (expected fixture, anthropic or gemini)`);

  if (anthropicKey) return makeAnthropic();
  if (geminiKey) return makeGemini();
  return new FixtureProvider();
}

export type { LlmProvider } from "./provider";
