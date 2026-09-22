// EVALUATION FIXTURE - fictional code.
import type { Ticket, TicketPriority } from "./ticket.ts";

const RANK: Record<TicketPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

export function isHigherPriority(a: TicketPriority, b: TicketPriority): boolean {
  return RANK[a] > RANK[b];
}

/**
 * Priority is not fully automatic: it is only ever raised, never lowered, by keyword match on
 * the subject. An agent's manual priority change always wins over this heuristic afterwards
 * because this function is only called at ticket creation, not on every update.
 */
const URGENT_WORDS = ["down", "outage", "security breach", "data loss", "cannot log in"];
const HIGH_WORDS = ["blocked", "broken", "urgent", "asap"];

export function suggestedPriority(subject: string): TicketPriority {
  const s = subject.toLowerCase();
  if (URGENT_WORDS.some((w) => s.includes(w))) return "urgent";
  if (HIGH_WORDS.some((w) => s.includes(w))) return "high";
  return "normal";
}

export function applySuggestedPriority(ticket: Ticket): Ticket {
  const suggested = suggestedPriority(ticket.subject);
  if (!isHigherPriority(suggested, ticket.priority)) return ticket;
  return { ...ticket, priority: suggested };
}
