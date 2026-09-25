/**
 * First-contact check for the live model path. Run once you have a key for any provider:
 *   ANTHROPIC_API_KEY=... npm run smoke:live      (Anthropic)
 *   GEMINI_API_KEY=... npm run smoke:live         (Gemini; GOOGLE_API_KEY also works)
 *   GROQ_API_KEY=... npm run smoke:live           (Groq; free tier, no card)
 * Set READYSPEC_PROVIDER=anthropic|gemini|groq explicitly if more than one key happens to be set
 * and you want a specific one; otherwise priority is anthropic > gemini > groq (see
 * src/server/llm/index.ts).
 *
 * Step 1 makes one tiny structured call (auth, model id, forced/schema-constrained JSON output,
 * response shape). Step 2 runs the real staged pipeline (analyze, clarify, brief, verify) on the
 * demonstration ticket and prints what came back. It spends a handful of calls; nothing is
 * written to the DB. Exits non-zero on any failure so it can gate a release.
 */
import path from "node:path";
import { z } from "zod";
import { createProvider } from "@/server/llm";
import { Budget } from "@/server/llm/budget";
import { generateStructured } from "@/server/llm/generate";
import { loadCases } from "../evals/runners/cases";
import { runStaged } from "../evals/runners/systems";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY && !process.env.GROQ_API_KEY) {
    console.error("No model key set (ANTHROPIC_API_KEY, GEMINI_API_KEY/GOOGLE_API_KEY, or GROQ_API_KEY). This script only checks the live path; the fixture provider is not a model.");
    process.exit(2);
  }
  const provider = createProvider();
  if (provider.info.kind === "fixture") throw new Error("createProvider() returned the fixture provider despite a key being set; check READYSPEC_PROVIDER.");
  console.log(`Provider: ${provider.info.label}`);

  const t0 = Date.now();
  const budget = new Budget({ maxCalls: 5, maxInputTokens: 20_000, maxOutputTokens: 2_000, maxCostUsd: null }, { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: null, estimated: false });
  const Echo = z.object({ answer: z.number(), note: z.string() });
  const res = await generateStructured({
    provider, budget, stage: "analyze", system: "You return only the requested structured JSON result.", user: "Return answer = 2 + 2 and a one-word note.",
    schema: Echo, schemaName: "Echo", maxOutputTokens: 200, maxRetries: 1,
  });
  if (res.answer !== 4) throw new Error(`structured call returned an unexpected value: ${JSON.stringify(res)}`);
  console.log(`1/2 structured call OK in ${Date.now() - t0} ms: ${JSON.stringify(res)}`);

  const c = loadCases().find((x) => x.id === "demo-01-pause-notifications");
  if (!c) throw new Error("demo case missing");
  const out = await runStaged(c, provider);
  if (out.error) throw new Error(`staged pipeline failed: ${out.error}`);
  console.log(`2/2 staged pipeline OK in ${(out.latencyMs / 1000).toFixed(1)} s, ${out.usage.calls} calls, ${out.usage.inputTokens} in / ${out.usage.outputTokens} out tokens`);
  console.log(`   questions (${out.questions.length}):`);
  for (const q of out.questions) console.log(`   - ${q.text}`);
  console.log(`   observations: ${out.observations.length}; citations invalid: ${out.observations.reduce((s, o) => s + o.invalidCitations, 0)}`);
  console.log(`   verifier: ${out.verification?.errors} error(s), ${out.verification?.warnings} warning(s)`);
  console.log(`   repository: ${path.basename(c.repo)}; contradictions noticed: ${out.contradictions.length}`);
  console.log("\nLive path reachable. Review the output above by hand before trusting it, then run the benchmark.");
}

main().catch((e: Error) => {
  console.error("SMOKE FAILED:", e.message);
  process.exit(1);
});
