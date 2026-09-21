import path from "node:path";
import { createMemoryStore } from "@/server/persistence/store";
import { FixtureProvider } from "@/server/llm/fixture";
import type { LlmProvider, LlmRequest, LlmResponse } from "@/server/llm/provider";
import { SessionService } from "@/server/workflow/service";
import type { SessionDetail, SessionLimits } from "@/shared/schemas";

export const FIXTURES = path.resolve(__dirname, "..", "fixtures");
export const DEMO_REPO = path.join(FIXTURES, "demo-repository");
export const DEMO_TICKET = "Let users pause notifications while they are away.";

export const TEST_LIMITS: SessionLimits = { maxCalls: 20, maxInputTokens: 500_000, maxOutputTokens: 200_000, maxCostUsd: null };

export function makeService(provider: LlmProvider = new FixtureProvider(), limits: SessionLimits = TEST_LIMITS) {
  const store = createMemoryStore();
  const service = new SessionService({ store, providerFactory: () => provider, defaultRoots: [FIXTURES], limits, backoffMs: 0 });
  return { store, service };
}

/** Wraps a provider to record every request it receives (what would leave the machine). */
export class RecordingProvider implements LlmProvider {
  readonly requests: LlmRequest[] = [];
  constructor(private readonly inner: LlmProvider = new FixtureProvider()) {}
  get info() {
    return this.inner.info;
  }
  get leavesMachine() {
    return this.inner.leavesMachine;
  }
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(req);
    return this.inner.complete(req);
  }
}

export const DEMO_ANSWERS = (detail: SessionDetail) => {
  const qs = detail.rounds[detail.rounds.length - 1]!.questions;
  return qs.map((q, i) =>
    i === 3
      ? { questionId: q.id, source: "deferred" as const, answer: "" }
      : i === 1
        ? { questionId: q.id, source: "user" as const, answer: "Deliver a single digest when the pause ends." }
        : { questionId: q.id, source: "suggestion_accepted" as const, answer: q.suggestedAnswers[0]!.text },
  );
};

/** Drive a demo session to the review state with the fixture provider. */
export async function runToReview(service: SessionService, provider?: LlmProvider) {
  void provider;
  const s = service.createSession(DEMO_REPO, DEMO_TICKET);
  service.startAnalysis(s.id);
  await service.waitForIdle(s.id);
  service.submitAnswers(s.id, DEMO_ANSWERS(service.getDetail(s.id)!));
  service.startBrief(s.id);
  await service.waitForIdle(s.id);
  return { id: s.id, detail: service.getDetail(s.id)! };
}
