import { AnthropicProvider } from "./anthropic";
import { GeminiProvider } from "./gemini";
import { GroqProvider } from "./groq";
import { FixtureProvider } from "./fixture";
import type { LlmProvider } from "./provider";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/**
 * Provider selection (server-side only; keys never reach the browser):
 *   READYSPEC_PROVIDER=fixture | anthropic | gemini | groq   (explicit choice wins; errors if
 *     that provider's key is missing rather than silently falling back)
 *   Unset: ANTHROPIC_API_KEY -> anthropic; else GEMINI_API_KEY/GOOGLE_API_KEY -> gemini; else
 *     GROQ_API_KEY -> groq; else fixture. Set READYSPEC_PROVIDER explicitly to pick one when more
 *     than one key is present (e.g. Gemini quota exhausted but a Groq key is also set).
 *   READYSPEC_MODEL overrides the default model id for whichever provider is selected.
 *   ANTHROPIC_BASE_URL / GEMINI_BASE_URL / GROQ_BASE_URL override the API host (testing only).
 */
export function createProvider(env: Record<string, string | undefined> = process.env): LlmProvider {
  const wanted = env.READYSPEC_PROVIDER?.toLowerCase();
  const anthropicKey = env.ANTHROPIC_API_KEY;
  const geminiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  const groqKey = env.GROQ_API_KEY;

  const makeAnthropic = () => {
    if (!anthropicKey) throw new Error("READYSPEC_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
    return new AnthropicProvider({ apiKey: anthropicKey, model: env.READYSPEC_MODEL || DEFAULT_ANTHROPIC_MODEL, baseUrl: env.ANTHROPIC_BASE_URL });
  };
  const makeGemini = () => {
    if (!geminiKey) throw new Error("READYSPEC_PROVIDER=gemini requires GEMINI_API_KEY (or GOOGLE_API_KEY)");
    return new GeminiProvider({ apiKey: geminiKey, model: env.READYSPEC_MODEL || DEFAULT_GEMINI_MODEL, baseUrl: env.GEMINI_BASE_URL });
  };
  const makeGroq = () => {
    if (!groqKey) throw new Error("READYSPEC_PROVIDER=groq requires GROQ_API_KEY");
    return new GroqProvider({ apiKey: groqKey, model: env.READYSPEC_MODEL || DEFAULT_GROQ_MODEL, baseUrl: env.GROQ_BASE_URL });
  };

  if (wanted === "fixture") return new FixtureProvider();
  if (wanted === "anthropic") return makeAnthropic();
  if (wanted === "gemini") return makeGemini();
  if (wanted === "groq") return makeGroq();
  if (wanted) throw new Error(`Unknown READYSPEC_PROVIDER "${wanted}" (expected fixture, anthropic, gemini or groq)`);

  if (anthropicKey) return makeAnthropic();
  if (geminiKey) return makeGemini();
  if (groqKey) return makeGroq();
  return new FixtureProvider();
}

export type { LlmProvider } from "./provider";
