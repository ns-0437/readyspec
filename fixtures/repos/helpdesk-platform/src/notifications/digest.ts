// EVALUATION FIXTURE - fictional code.
import type { Ticket } from "../tickets/ticket.ts";
import { resolutionStatus } from "../sla/clock.ts";

/** A morning digest of an agent's tickets at risk: not yet breached but within 20% of the resolution target. */
export function ticketsAtRisk(myTickets: Ticket[], now = new Date()): Ticket[] {
  return myTickets.filter((t) => {
    if (t.status === "resolved" || t.status === "closed") return false;
    const status = resolutionStatus(t, now);
    if (status.breached) return false;
    return status.resolutionMinutesRemaining <= 0.2 * (status.resolutionMinutesElapsed + status.resolutionMinutesRemaining);
  });
}
