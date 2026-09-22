// EVALUATION FIXTURE - fictional code.
import type { Ticket, TicketStatus } from "./ticket.ts";

export class InvalidTransition extends Error {
  from: TicketStatus;
  to: TicketStatus;
  constructor(from: TicketStatus, to: TicketStatus) {
    super(`cannot move ticket from ${from} to ${to}`);
    this.from = from;
    this.to = to;
  }
}

/** Allowed next statuses. A closed ticket can only be reopened to "open". */
const ALLOWED: Record<TicketStatus, TicketStatus[]> = {
  open: ["pending", "resolved", "closed"],
  pending: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: ["open"],
};

/** Moves a ticket to a new status, tracking pending time for the SLA clock (see sla/clock.ts). */
export function transition(ticket: Ticket, to: TicketStatus, now = new Date()): Ticket {
  if (ticket.status === to) return ticket;
  if (!ALLOWED[ticket.status].includes(to)) throw new InvalidTransition(ticket.status, to);

  let pendingMinutes = ticket.pendingMinutes;
  let pendingSince = ticket.pendingSince;
  if (ticket.status === "pending" && to !== "pending") {
    if (pendingSince) pendingMinutes += Math.max(0, (now.getTime() - new Date(pendingSince).getTime()) / 60000);
    pendingSince = null;
  }
  if (to === "pending") pendingSince = now.toISOString();

  return {
    ...ticket,
    status: to,
    pendingMinutes,
    pendingSince,
    resolvedAt: to === "resolved" ? now.toISOString() : to === "open" ? null : ticket.resolvedAt,
    updatedAt: now.toISOString(),
  };
}

export function isOpenForWork(ticket: Ticket): boolean {
  return ticket.status === "open" || ticket.status === "pending";
}
