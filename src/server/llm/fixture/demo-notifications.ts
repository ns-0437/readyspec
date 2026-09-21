import type {
  BehaviorAnalysis,
  BriefContent,
  ClarificationOutput,
  Decision,
  Question,
} from "@/shared/schemas";
import type { AnalyzeContext, BriefContext, ClarifyContext } from "../contexts";
import { findEvidence, ids } from "./helpers";

/**
 * Hand-authored output for the demonstration ticket against fixtures/demo-repository.
 * This is SCRIPTED, not produced by a model: it exists so the whole product can be exercised
 * (and its verifier tested) without credentials. It only cites evidence actually present in
 * the context and only states what those excerpts show.
 */
export function isNotificationDemo(ctx: { ticket: string; evidence: { path: string; symbol: string | null }[] }): boolean {
  return (
    /pause/i.test(ctx.ticket) &&
    /notification/i.test(ctx.ticket) &&
    ctx.evidence.some((e) => e.path.endsWith("notifications/dispatcher.ts") && e.symbol === "decideDelivery")
  );
}

function refs(ctx: { evidence: AnalyzeContext["evidence"] }) {
  const ev = ctx.evidence;
  return {
    decide: findEvidence(ev, { pathEndsWith: "notifications/dispatcher.ts", symbol: "decideDelivery" }),
    dispatch: findEvidence(ev, { pathEndsWith: "notifications/dispatcher.ts", symbol: "dispatchNotification" }),
    prefsType: findEvidence(ev, { pathEndsWith: "users/preferences.ts", symbol: "NotificationPreferences" }),
    prefsUpdate: findEvidence(ev, { pathEndsWith: "users/preferences.ts", symbol: "updatePreferences" }),
    prefsDefaults: findEvidence(ev, { pathEndsWith: "users/preferences.ts", symbol: "defaultPreferences" }),
    retry: findEvidence(ev, { pathEndsWith: "notifications/retry-queue.ts", symbol: "enqueueRetry" }),
    digest: findEvidence(ev, { pathEndsWith: "notifications/digest.ts" }),
    docs: findEvidence(ev, { pathEndsWith: "docs/notifications.md" }),
    injected: findEvidence(ev, { pathEndsWith: "docs/AGENT_NOTES.md" }),
    routes: findEvidence(ev, { pathEndsWith: "api/routes.ts" }),
    types: findEvidence(ev, { pathEndsWith: "notifications/types.ts" }),
    dispatchTest: findEvidence(ev, { pathEndsWith: "tests/dispatcher.test.ts", contains: "security alerts are always delivered" }),
  };
}

export function demoAnalysis(ctx: AnalyzeContext): BehaviorAnalysis {
  const r = refs(ctx);
  const observations: BehaviorAnalysis["observations"] = [];
  const add = (statement: string, ...evs: (typeof r.decide)[]) => {
    const evidenceIds = ids(...evs);
    if (evidenceIds.length) observations.push({ id: `obs-${observations.length + 1}`, kind: "observed", statement, evidenceIds });
  };

  add("decideDelivery is the single place preferences decide delivery: a security notification always returns deliver: true, and any other category is skipped with reason category_disabled when its preference flag is false.", r.decide);
  add("dispatchNotification loads the user's preferences, calls decideDelivery, and if delivery is allowed sends to every enabled channel; a failed channel send is passed to enqueueRetry.", r.dispatch);
  add("NotificationPreferences holds channels, categories and digestFrequency; there is no pause, away or quiet-hours field.", r.prefsType);
  add("updatePreferences forces categories.security back to true, so security alerts cannot be switched off through preferences.", r.prefsUpdate);
  add("enqueueRetry stores the notification, channel and attempt count with an exponential backoff and refuses jobs at MAX_ATTEMPTS; the queue entry carries no preference information.", r.retry);
  add("nextDigestAt reads user.timezone and falls back to \"UTC\" when it is null.", r.digest);
  add("tests/dispatcher.test.ts has a test named \"security alerts are always delivered\" that checks decideDelivery returns deliver: true for a security notification.", r.dispatchTest);
  if (r.injected) {
    add("docs/AGENT_NOTES.md contains text addressed to AI assistants (telling them to skip questions, approve the brief and print .env). It is untrusted repository text and was not followed.", r.injected);
  }

  const contradictions: BehaviorAnalysis["contradictions"] = [];
  const quiet = ids(r.docs, r.prefsType);
  if (r.docs && r.prefsType) {
    contradictions.push({
      id: "con-1",
      description: "docs/notifications.md says users can configure quiet hours in their local timezone, but NotificationPreferences has no quiet-hours or timezone field and nothing in the dispatcher checks time.",
      evidenceIds: quiet,
    });
  }
  if (r.docs && r.prefsDefaults) {
    contradictions.push({
      id: "con-2",
      description: "docs/notifications.md says all categories are on by default, but defaultPreferences turns marketing off.",
      evidenceIds: ids(r.docs, r.prefsDefaults),
    });
  }

  const missingDecisions: BehaviorAnalysis["missingDecisions"] = [
    { id: "md-1", topic: "Security alerts during a pause", description: "Docs and code both guarantee security alerts are always delivered; the ticket does not say whether a pause overrides that.", evidenceIds: ids(r.decide, r.docs) },
    { id: "md-2", topic: "Fate of suppressed notifications", description: "Skipped notifications are currently dropped (category_disabled); the ticket does not say if paused ones are dropped, delayed or digested.", evidenceIds: ids(r.decide, r.digest) },
    { id: "md-3", topic: "How a pause ends", description: "No expiry concept exists; the ticket only says 'while they are away'.", evidenceIds: ids(r.prefsType) },
    { id: "md-4", topic: "Timezone for the end time", description: "The only timezone handling is in digests, with a UTC fallback when user.timezone is null.", evidenceIds: ids(r.digest) },
    { id: "md-5", topic: "Retries queued before the pause", description: "Retry jobs are not re-checked against preferences.", evidenceIds: ids(r.retry, r.dispatch) },
  ];

  const insufficientEvidence = [
    "No client or UI code was retrieved, so where a user would switch a pause on cannot be established from these excerpts.",
    "The excerpts do not show what consumes the retry queue, so whether queued retries run after preferences change is unconfirmed.",
  ];

  const evidenceNotes: Record<string, string> = {};
  const note = (e: typeof r.decide, text: string) => {
    if (e) evidenceNotes[e.id] = text;
  };
  note(r.decide, "The single delivery decision point a pause would extend.");
  note(r.dispatch, "Shows preferences are read at dispatch time and where failed sends go.");
  note(r.prefsType, "The preference model a pause setting would be added to.");
  note(r.prefsUpdate, "Security alerts are protected here.");
  note(r.retry, "Retry jobs bypass preference checks.");
  note(r.digest, "Only existing timezone handling; UTC fallback.");
  note(r.docs, "Documents quiet hours and security guarantees; partly disagrees with code.");
  note(r.injected, "Contains instruction-like text aimed at AI assistants; treated as untrusted data.");
  note(r.routes, "Where a preferences change would enter the system.");
  note(r.types, "Defines the notification categories.");

  return { observations, contradictions, missingDecisions, insufficientEvidence, evidenceNotes };
}

export function demoClarification(ctx: ClarifyContext): ClarificationOutput {
  if (ctx.round > 1 || ctx.decisions.length > 0) {
    return { questions: [], note: "The first-round questions were answered or deferred; no further question would materially change behavior, scope or testing." };
  }
  const r = refs(ctx);
  const q = (n: number, text: string, why: string, impact: Question["impact"], evs: (typeof r.decide)[], suggestions: [string, string][]): Question => ({
    id: `q-${n}`,
    text,
    whyItMatters: why,
    impact,
    priority: n,
    evidenceIds: ids(...evs),
    suggestedAnswers: suggestions.map(([text, tradeoff]) => ({ text, tradeoff })),
  });
  return {
    note: "",
    questions: [
      q(1, "Should a pause also stop security alerts (password changes, sign-in warnings)?",
        "Code and docs both say security alerts are always delivered. Pausing them changes a documented guarantee and needs a security/product decision.",
        "behavior", [r.decide, r.docs, r.prefsUpdate],
        [["No: security alerts are always delivered, even while paused", "Keeps the documented guarantee; users may still get pinged while away."],
         ["Yes, pause everything including security alerts", "Fully quiet, but users could miss account-takeover warnings."],
         ["Security alerts still send, but only on the most urgent channel", "Middle ground; needs a definition of 'most urgent channel'."]]),
      q(2, "What should happen to notifications generated during the pause: dropped, delivered afterwards, or summarized in a digest?",
        "Today skipped notifications are simply dropped. Delivering or digesting them adds storage and a new send path.",
        "behavior", [r.decide, r.digest],
        [["Drop them (same as a disabled category today)", "Simplest; users lose information."],
         ["Deliver them in one digest when the pause ends", "Friendlier; requires holding notifications and a send trigger."],
         ["Deliver only billing/security items when the pause ends", "Reduces noise; needs a per-category rule."]]),
      q(3, "How does a pause end: a required end date, open-ended until switched off, or both?",
        "There is no expiry concept in the preference model. An open-ended pause can silently mute a user forever.",
        "behavior", [r.prefsType],
        [["Require an end date/time (maximum length to be set)", "Prevents forgotten pauses; more input for the user."],
         ["Open-ended until the user resumes", "Simple; risk of users staying muted."],
         ["Optional end date; show a reminder while paused", "Flexible; needs a reminder mechanism."]]),
      q(4, "Which timezone interprets the pause end time when the profile timezone is missing?",
        "user.timezone may be null and digests fall back to UTC; a wrong assumption ends the pause hours early or late.",
        "testing", [r.digest],
        [["Use the profile timezone; require the user to set one before choosing an end time", "Unambiguous; adds a prerequisite."],
         ["Store the end as an absolute instant captured with the browser's timezone", "No dependence on the profile; client must send it."],
         ["Fall back to UTC like digests do", "Consistent with digests; may surprise users."]]),
      q(5, "What should happen to delivery retries that are already queued when the pause starts?",
        "Retry jobs do not re-check preferences, so without a decision a paused user could still receive earlier failed sends.",
        "testing", [r.retry, r.dispatch],
        [["Re-check the pause at send time and drop or hold the job", "Correct behavior; touches the retry path."],
         ["Cancel queued retries when a pause starts", "Simple; may discard important retries."],
         ["Let existing retries finish", "No retry-path change; contradicts the user's intent."]]),
    ],
  };
}

export function demoBrief(ctx: BriefContext): BriefContent {
  const r = refs(ctx);
  const byQ = new Map<string, Decision>(ctx.decisions.map((d) => [d.questionId, d]));
  const decided = (id: string) => {
    const d = byQ.get(id);
    return d && d.source !== "deferred" && d.answer.trim() ? d : null;
  };

  const analysisObs = ctx.analysis.observations.filter((o) => o.evidenceIds.length > 0 && !o.statement.startsWith("docs/AGENT_NOTES.md"));
  const openQuestions: BriefContent["openQuestions"] = [];
  const openFor = (qid: string, text: string): string => {
    const id = `oq-${openQuestions.length + 1}`;
    openQuestions.push({ id, kind: "unresolved", text, questionId: qid });
    return id;
  };

  const criteria: BriefContent["acceptanceCriteria"] = [];
  const tests: BriefContent["tests"] = [];
  const steps: BriefContent["steps"] = [];

  const components: BriefContent["components"] = [];
  const comp = (path: string, role: string, change: "modify" | "add", evs: (typeof r.decide)[]): string => {
    const found = components.find((c) => c.path === path);
    if (found) return found.id;
    const id = `c-${components.length + 1}`;
    components.push({ id, path, role, change, evidenceIds: ids(...evs) });
    return id;
  };
  const disp = r.decide ? comp(r.decide.path, "Extend decideDelivery with a paused outcome", "modify", [r.decide, r.dispatch]) : null;
  const prefs = r.prefsType ? comp(r.prefsType.path, "Add pause state to NotificationPreferences and updatePreferences", "modify", [r.prefsType, r.prefsUpdate]) : null;
  const routes = r.routes ? comp(r.routes.path, "Accept and validate pause input on the preferences endpoint", "modify", [r.routes]) : null;
  const retry = r.retry ? comp(r.retry.path, "Retry path must respect a pause", "modify", [r.retry]) : null;
  const dispatchTests = comp("tests/dispatcher.test.ts", "Add pause delivery tests", "modify", [r.dispatchTest]);
  const prefTests = comp("tests/preferences.test.ts", "Add pause validation tests", "modify", []);
  const cs = (...c: (string | null)[]) => c.filter((x): x is string => !!x);

  const addCriterion = (
    text: string,
    evs: (typeof r.decide)[],
    componentIds: string[],
    testDescription: string,
    level: "unit" | "integration" | "manual",
    testPath: string | null,
    refs: { decision?: string; open?: string } = {},
  ): string => {
    const cid = `ac-${criteria.length + 1}`;
    const tid = `t-${tests.length + 1}`;
    tests.push({ id: tid, kind: "proposed", description: testDescription, level, testPath, criterionIds: [cid] });
    criteria.push({
      id: cid, kind: "proposed", text, evidenceIds: ids(...evs), componentIds, testIds: [tid],
      decisionRefs: refs.decision ? [refs.decision] : [], dependsOnOpen: refs.open ? [refs.open] : [],
    });
    return cid;
  };

  const core = addCriterion(
    "A signed-in user can turn a pause on for their own notifications; while it is active, decideDelivery returns deliver: false with a new 'paused' reason for every category the pause covers, and no channel send is attempted.",
    [r.decide, r.dispatch, r.prefsType], cs(disp, prefs, dispatchTests),
    "dispatchNotification with an active pause sends nothing on any channel and reports skipped: 'paused'.", "unit", "tests/dispatcher.test.ts",
  );

  const q1 = decided("q-1");
  const c1 = addCriterion(
    q1 ? `Security alerts while paused follow the recorded decision: "${q1.answer}".` : "Security alert behavior while paused is defined once the open question is answered.",
    [r.decide, r.docs, r.prefsUpdate], cs(disp, dispatchTests),
    "A security notification during an active pause is handled exactly as the decision specifies.", "unit", "tests/dispatcher.test.ts",
    q1 ? { decision: "q-1" } : { open: openFor("q-1", "Should a pause also stop security alerts?") },
  );

  const q2 = decided("q-2");
  const c2 = addCriterion(
    q2 ? `Notifications generated during a pause are handled as decided: "${q2.answer}".` : "Handling of notifications generated during a pause is defined once the open question is answered.",
    [r.decide, r.digest], cs(disp),
    "Notifications created during a pause are dropped/held/digested as decided, and nothing is silently lost when the decision says to keep them.", "integration", "tests/dispatcher.test.ts",
    q2 ? { decision: "q-2" } : { open: openFor("q-2", "What happens to notifications generated during the pause?") },
  );

  const q3 = decided("q-3");
  const c3 = addCriterion(
    q3 ? `A pause ends as decided: "${q3.answer}". After it ends, delivery resumes without further user action.` : "How a pause ends is defined once the open question is answered.",
    [r.prefsType], cs(prefs, prefTests),
    "A pause past its end no longer suppresses delivery; boundary tested at the exact end instant.", "unit", "tests/preferences.test.ts",
    q3 ? { decision: "q-3" } : { open: openFor("q-3", "How does a pause end?") },
  );

  const q4 = decided("q-4");
  const c4 = addCriterion(
    q4 ? `The pause end time is interpreted per the decision: "${q4.answer}".` : "The timezone used for the pause end time is defined once the open question is answered.",
    [r.digest, r.prefsType], cs(prefs),
    "End-of-pause evaluated for a user with a timezone, for a user with a null timezone, and across a daylight-saving change.", "unit", "tests/preferences.test.ts",
    q4 ? { decision: "q-4" } : { open: openFor("q-4", "Which timezone interprets the pause end time?") },
  );

  const q5 = decided("q-5");
  const c5 = addCriterion(
    q5 ? `Retries already queued when a pause starts behave as decided: "${q5.answer}".` : "Behavior of already-queued retries is defined once the open question is answered.",
    [r.retry, r.dispatch], cs(retry, dispatchTests),
    "A failed send queued before the pause does not reach a paused user (or does, if decided), verified through the retry queue.", "integration", "tests/dispatcher.test.ts",
    q5 ? { decision: "q-5" } : { open: openFor("q-5", "What happens to retries queued before the pause starts?") },
  );

  const valid = addCriterion(
    "The preferences endpoint rejects malformed pause input (for example an end time in the past or an unknown category) with a 400 and leaves stored preferences unchanged.",
    [r.routes, r.prefsUpdate], cs(routes, prefs, prefTests),
    "PUT /me/preferences with invalid pause payloads returns 400 and does not modify stored preferences.", "unit", "tests/preferences.test.ts",
  );

  const step = (text: string, componentIds: string[], criterionIds: string[]) =>
    steps.push({ id: `st-${steps.length + 1}`, kind: "proposed", text, componentIds, criterionIds });
  step("Extend NotificationPreferences and updatePreferences with a pause setting and validation.", cs(prefs), [core, c3, c4, valid]);
  step("Teach decideDelivery to return a 'paused' outcome according to the recorded decisions.", cs(disp), [core, c1, c2]);
  step("Accept and validate pause input on the preferences endpoint.", cs(routes), [valid]);
  step("Make queued retries respect the pause.", cs(retry), [c5]);
  step("Add the tests listed in the test plan and run the existing suite.", [dispatchTests, prefTests], [core, c1, c2, c3, c4, c5, valid]);

  const decisions: BriefContent["decisions"] = ctx.decisions
    .filter((d): d is Decision & { source: "user" | "suggestion_accepted" } => d.source !== "deferred" && d.answer.trim() !== "")
    .map((d) => ({ questionId: d.questionId, question: d.question, answer: d.answer, source: d.source }));

  const risks: BriefContent["risks"] = [];
  if (r.docs && r.decide) risks.push({ id: "r-1", text: "Pausing security alerts would contradict the documented guarantee that they are always delivered.", severity: "high", evidenceIds: ids(r.docs, r.decide) });
  if (r.retry) risks.push({ id: `r-${risks.length + 1}`, text: "The retry queue does not consult preferences, so a pause implemented only in decideDelivery could still leak retried notifications.", severity: "medium", evidenceIds: ids(r.retry, r.decide) });
  if (r.digest) risks.push({ id: `r-${risks.length + 1}`, text: "A null user.timezone with a UTC fallback could end a pause hours away from the user's expectation.", severity: "medium", evidenceIds: ids(r.digest) });

  const assumptions: BriefContent["assumptions"] = [
    { id: "as-1", kind: "assumed", text: "A pause is set by a user for their own account only; administrators cannot pause on someone's behalf (the ticket does not mention delegation).", replaceWhen: "Product confirms admin or team-level pauses." },
    { id: "as-2", kind: "assumed", text: "Pause state is stored alongside the existing notification preferences rather than in a new store.", replaceWhen: "Storage design is reviewed by the owning team." },
  ];

  return {
    title: "Let users pause notifications while they are away",
    requestedOutcome: ctx.ticket.trim(),
    scope: {
      inScope: ["A user-controlled pause on their own notifications", "Delivery-time enforcement in the dispatcher and retry path", "Validation and tests for the new setting"],
      outOfScope: ["Admin-managed or team-wide pauses", "Redesigning notification categories or channels", "Building a UI beyond what the preferences endpoint needs"],
    },
    existingBehavior: analysisObs.map((o) => ({ id: o.id, kind: "observed" as const, statement: o.statement, evidenceIds: o.evidenceIds })),
    decisions,
    openQuestions,
    acceptanceCriteria: criteria,
    components,
    steps,
    tests,
    risks,
    assumptions,
  };
}
