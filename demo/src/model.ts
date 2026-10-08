export const questions = [
  { id: "security", title: "Should security alerts bypass a pause?", why: "The current delivery function lets security alerts bypass category preferences. A pause needs an explicit policy.", evidenceId: "delivery", options: [
    { id: "preserve", label: "Keep security alerts eligible", detail: "Preserve the current security exception." },
    { id: "pause", label: "Pause every category", detail: "An intentional product-policy change, including security." },
  ] },
  { id: "duration", title: "How does a pause end?", why: "The preferences model has no pause window. Decide whether to store an expiry or a manual toggle.", evidenceId: "preferences", options: [
    { id: "24h", label: "Automatically after 24 hours", detail: "Resume ordinary notifications at the expiry boundary." },
    { id: "manual", label: "Only when the user resumes", detail: "No automatic expiry; the setting persists until changed." },
  ] },
  { id: "channels", title: "Which channels should the pause cover?", why: "Email, push, and SMS are separate delivery destinations. Channel scope changes where the new check belongs.", evidenceId: "channels", options: [
    { id: "all", label: "All enabled channels", detail: "Apply the pause before dispatching to any destination." },
    { id: "push", label: "Push notifications only", detail: "Keep email and SMS on their existing delivery path." },
  ] },
] as const;
export type QuestionId = typeof questions[number]["id"];
export type Choices = Record<QuestionId, string | null>;
export const emptyChoices = (): Choices => ({ security: null, duration: null, channels: null });
export function validChoices(value: unknown): value is Choices {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === questions.length && questions.every((q) => record[q.id] === null || q.options.some((o) => o.id === record[q.id]));
}
export interface DemoCriterion { id: string; text: string; evidenceId: string; test: string; blockedBy: QuestionId[] }
export function createCriteria(choices: Choices): DemoCriterion[] {
  return [
    { id: "AC-01", text: choices.security === "preserve" ? "While a pause is active, keep security alerts eligible for delivery; suppress other categories within the selected channel scope." : choices.security === "pause" ? "While a pause is active, suppress all categories including security within the selected channel scope." : "Implement the pause only after the security-alert exception has been decided.", evidenceId: "delivery", test: "Test ordinary and security categories with a pause active and inactive.", blockedBy: [!choices.security ? "security" : null, !choices.channels ? "channels" : null].filter((x): x is QuestionId => x !== null) },
    { id: "AC-02", text: choices.duration === "24h" ? "Store a pause expiry 24 hours from activation; resume automatically when current time equals or exceeds it." : choices.duration === "manual" ? "Persist the pause until the user explicitly resumes notifications; do not expire it automatically." : "Choose automatic expiry or manual resume before implementing pause persistence.", evidenceId: "preferences", test: choices.duration === "24h" ? "Test just before, at, and after the expiry using a controlled clock." : "Test that pause state survives reload and explicit resume restores delivery.", blockedBy: choices.duration ? [] : ["duration"] },
    { id: "AC-03", text: choices.channels === "all" ? "Apply the pause policy to all enabled channels without changing the user's channel preferences." : choices.channels === "push" ? "Apply the pause policy only to push; leave email and SMS behavior unchanged." : "Confirm channel scope before placing the pause check in the dispatch path.", evidenceId: "channels", test: "Exercise email, push, and SMS with distinct enablement and pause states.", blockedBy: choices.channels ? [] : ["channels"] },
  ];
}
