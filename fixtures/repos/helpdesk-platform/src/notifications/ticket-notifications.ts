// EVALUATION FIXTURE - fictional code.
import type { Ticket } from "../tickets/ticket.ts";

export const outbox: { to: string; subject: string; body: string }[] = [];

export function notifyRequesterCreated(ticket: Ticket): void {
  outbox.push({ to: ticket.requesterEmail, subject: `[${ticket.id}] We received your request`, body: ticket.subject });
}

/** Only public replies notify the requester; internal notes never do (see comments handling upstream). */
export function notifyRequesterReply(ticket: Ticket, replyBody: string, isPublic: boolean): void {
  if (!isPublic) return;
  outbox.push({ to: ticket.requesterEmail, subject: `[${ticket.id}] New reply`, body: replyBody });
}

export function notifyAgentAssigned(ticket: Ticket, agentEmail: string): void {
  outbox.push({ to: agentEmail, subject: `[${ticket.id}] Assigned to you`, body: ticket.subject });
}

/** Fires only once per breach transition; callers are responsible for not calling this every poll. */
export function notifyAgentSlaBreach(ticket: Ticket, agentEmail: string): void {
  outbox.push({ to: agentEmail, subject: `[${ticket.id}] SLA breached`, body: `Resolution target missed for: ${ticket.subject}` });
}

export function clearOutboxForTests(): void {
  outbox.length = 0;
}
