/**
 * Evaluation profiles: per-stage output allowances plus an optional shared evidence budget.
 * `default` is the production behavior. `compact` is an initial HYPOTHESIS (smaller output
 * allowances so requests can fit a small provider allowance); nothing validates it as producing
 * equal quality, and its numbers should be revisited once real outputs show how much room they need.
 */
import type { RetrievalOptions } from "@/server/repository/search";
import { STAGE_MAX_OUTPUT, type StageOutputAllowances } from "@/server/workflow/stages";

export interface EvalProfile {
  name: string;
  outputs: StageOutputAllowances;
  /**
   * When set, caps the retrieval budget (characters of excerpt) for BOTH systems identically. Null keeps the default
   * retrieval budget. Reducing it drops excerpts, so a plan must show which ones.
   */
  evidenceMaxChars: number | null;
}

export const PROFILES: Record<string, EvalProfile> = {
  default: { name: "default", outputs: { ...STAGE_MAX_OUTPUT }, evidenceMaxChars: null },
  compact: { name: "compact", outputs: { analyze: 1500, clarify: 1000, brief: 2500, single_prompt: 2500 }, evidenceMaxChars: null },
};

const STAGES = ["analyze", "clarify", "brief", "single_prompt"] as const;

const positiveInt = (what: string, v: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 200_000) throw new Error(`${what} must be a positive integer (at most 200000), got "${v}"`);
  return n;
};

/** Builds a validated profile. `outputs` is "stage=N,stage=N"; unknown stages, bad numbers and unknown profile names are rejected. */
export function resolveProfile(name: string | undefined, overrides: { outputs?: string; evidenceMaxChars?: string } = {}): EvalProfile {
  const base = PROFILES[name ?? "default"];
  if (!base) throw new Error(`Unknown profile "${name}" (expected ${Object.keys(PROFILES).join(" or ")})`);
  const outputs = { ...base.outputs };
  if (overrides.outputs) {
    for (const part of overrides.outputs.split(",").filter(Boolean)) {
      const [k, v] = part.split("=");
      if (!k || v === undefined || !(STAGES as readonly string[]).includes(k)) throw new Error(`--output-allowance entries look like stage=tokens with stage one of ${STAGES.join(", ")}; got "${part}"`);
      outputs[k as keyof StageOutputAllowances] = positiveInt(`--output-allowance ${k}`, v);
    }
  }
  const evidenceMaxChars = overrides.evidenceMaxChars === undefined ? base.evidenceMaxChars : positiveInt("--evidence-max-chars", overrides.evidenceMaxChars);
  const customized = !!overrides.outputs || overrides.evidenceMaxChars !== undefined;
  return { name: customized ? `${base.name}+overrides` : base.name, outputs, evidenceMaxChars };
}

/** Configuration problems that make a same-evidence comparison unfair. Empty when fine. */
export function profileProblems(profile: EvalProfile, systems: string[]): string[] {
  const problems: string[] = [];
  if (systems.includes("single_prompt") && systems.includes("staged") && profile.outputs.single_prompt !== profile.outputs.brief) {
    problems.push(`single-prompt output allowance (${profile.outputs.single_prompt}) must equal the staged brief allowance (${profile.outputs.brief}) for this comparison`);
  }
  if (systems.includes("single_prompt_alphabetical") && (profile.name !== "default" || profile.evidenceMaxChars)) problems.push("the alphabetical baseline does not use profiles; run it with the default profile");
  return problems;
}

/** The retrieval options both systems must share, or undefined for the default budget. */
export const retrievalFor = (profile?: EvalProfile): Partial<RetrievalOptions> | undefined => (profile?.evidenceMaxChars ? { maxChars: profile.evidenceMaxChars } : undefined);
