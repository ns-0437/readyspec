// EVALUATION FIXTURE - fictional code.
import type { Ticket } from "../tickets/ticket.ts";

export interface SurveyResponse {
  ticketId: string;
  score: 1 | 2 | 3 | 4 | 5;
  comment: string | null;
  respondedAt: string;
}

const responses: SurveyResponse[] = [];

/** A survey is sent once a ticket resolves, and never again for the same ticket (surveySentAt is sticky, even across reopen/re-resolve). */
export function shouldSendSurvey(ticket: Ticket): boolean {
  return ticket.status === "resolved" && ticket.surveySentAt === null;
}

export function markSurveySent(ticket: Ticket, now = new Date()): Ticket {
  return { ...ticket, surveySentAt: now.toISOString() };
}

export function recordResponse(response: SurveyResponse): void {
  responses.push(response);
}

export function averageScore(ticketIds: string[]): number | null {
  const relevant = responses.filter((r) => ticketIds.includes(r.ticketId));
  if (relevant.length === 0) return null;
  return relevant.reduce((s, r) => s + r.score, 0) / relevant.length;
}

export function clearSurveysForTests(): void {
  responses.length = 0;
}
