// EVALUATION FIXTURE - fictional code. Unrelated to ticket/notification flows on purpose.
import type { Ticket } from "../tickets/ticket.ts";

export function openTicketCountByAgent(tickets: Ticket[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tickets) {
    if (!t.assigneeId) continue;
    if (t.status !== "open" && t.status !== "pending") continue;
    counts.set(t.assigneeId, (counts.get(t.assigneeId) ?? 0) + 1);
  }
  return counts;
}
