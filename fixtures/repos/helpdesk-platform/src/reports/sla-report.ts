// EVALUATION FIXTURE - fictional code. Unrelated to ticket/notification flows on purpose.
import type { Ticket } from "../tickets/ticket.ts";
import { resolutionStatus } from "../sla/clock.ts";

export interface SlaReportRow {
  priority: string;
  total: number;
  breached: number;
}

export function slaComplianceReport(tickets: Ticket[], now = new Date()): SlaReportRow[] {
  const byPriority = new Map<string, { total: number; breached: number }>();
  for (const t of tickets) {
    const row = byPriority.get(t.priority) ?? { total: 0, breached: 0 };
    row.total++;
    if (resolutionStatus(t, now).breached) row.breached++;
    byPriority.set(t.priority, row);
  }
  return [...byPriority.entries()].map(([priority, row]) => ({ priority, ...row }));
}
