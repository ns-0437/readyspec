import { z } from "zod";

/**
 * A benchmark case, authored by hand BEFORE any system output was inspected.
 * Keyword groups: a text "matches" a group when EVERY term in the group is found (case-insensitive
 * substring); a term may list alternatives with "|". `anyOf` = matches if any group matches.
 * This is a deliberately crude, deterministic approximation of "the system raised this issue";
 * the human rubric in evals/rubrics/ is the authoritative judgement.
 */
const Group = z.array(z.string().min(1)).min(1);
const AnyOf = z.array(Group).min(1);

export const EvalCase = z.object({
  id: z.string(),
  repo: z.enum(["demo-repository", "shop-orders", "team-tasks"]),
  ticket: z.string(),
  category: z.enum(["clear", "ambiguous", "conflicting-docs", "irrelevant-files", "misleading", "vague", "insufficient-evidence"]),
  heldOut: z.boolean(),
  /** v1 held-out cases were run once and are contaminated by later retrieval tuning; v2 were written before that tuning and run once after it. */
  cohort: z.enum(["v1", "v2"]).default("v1"),
  notes: z.string(),
  expectedFiles: z.object({ required: z.array(z.string()), helpful: z.array(z.string()) }),
  /** Files a good system should NOT need (used for precision). */
  distractors: z.array(z.string()),
  criticalAmbiguities: z.array(z.object({ id: z.string(), description: z.string(), anyOf: AnyOf })),
  /** Question topics that are legitimate but not critical (not counted as unnecessary). */
  acceptableTopics: z.array(AnyOf).default([]),
  expectedContradictions: z.array(z.object({ id: z.string(), description: z.string(), anyOf: AnyOf })).default([]),
  unacceptableAssumptions: z.array(z.object({ id: z.string(), description: z.string(), pattern: z.string() })).default([]),
  /** The ticket cannot be grounded in the code; the system should say so. */
  shouldSayInsufficientEvidence: z.boolean().default(false),
});
export type EvalCase = z.infer<typeof EvalCase>;
