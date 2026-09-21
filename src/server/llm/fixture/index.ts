import type { ProviderInfo } from "@/shared/schemas";
import type { AnalyzeContext, BriefContext, ClarifyContext, JudgeContext, SinglePromptContext } from "../contexts";
import { estimateTokens, type LlmProvider, type LlmRequest, type LlmResponse } from "../provider";
import { demoAnalysis, demoBrief, demoClarification, isNotificationDemo } from "./demo-notifications";
import { genericAnalysis, genericBrief, genericClarification, genericJudge, genericSinglePrompt } from "./generic";

export const FIXTURE_LABEL = "FIXTURE PROVIDER (scripted output, not a model)";

/**
 * Deterministic, credential-free provider. Output is scripted for the demonstration ticket and
 * mechanical otherwise. It never calls a network and is always labelled as a fixture in the UI,
 * exports and evaluation reports.
 */
export class FixtureProvider implements LlmProvider {
  readonly info: ProviderInfo = { kind: "fixture", label: FIXTURE_LABEL, model: null };
  readonly leavesMachine = false;

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (req.signal?.aborted) throw new Error("aborted");
    const out = this.produce(req);
    const text = JSON.stringify(out);
    return { text, usage: { inputTokens: estimateTokens(req.system + req.user), outputTokens: estimateTokens(text) } };
  }

  private produce(req: LlmRequest): unknown {
    switch (req.stage) {
      case "analyze": {
        const c = req.context as AnalyzeContext;
        return isNotificationDemo(c) ? demoAnalysis(c) : genericAnalysis(c);
      }
      case "clarify": {
        const c = req.context as ClarifyContext;
        return isNotificationDemo(c) ? demoClarification(c) : genericClarification(c);
      }
      case "brief": {
        const c = req.context as BriefContext;
        return isNotificationDemo(c) ? demoBrief(c) : genericBrief(c);
      }
      case "judge":
        return genericJudge(req.context as JudgeContext);
      case "single_prompt":
        return genericSinglePrompt(req.context as SinglePromptContext);
    }
  }
}
