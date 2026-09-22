// EVALUATION FIXTURE - fictional code.
import type { TicketPriority } from "../tickets/ticket.ts";

export interface SlaTarget {
  firstResponseMinutes: number;
  resolutionMinutes: number;
}

/** Business-hour minutes, not wall-clock minutes: see sla/clock.ts. */
const TARGETS: Record<TicketPriority, SlaTarget> = {
  urgent: { firstResponseMinutes: 30, resolutionMinutes: 4 * 60 },
  high: { firstResponseMinutes: 60, resolutionMinutes: 8 * 60 },
  normal: { firstResponseMinutes: 4 * 60, resolutionMinutes: 24 * 60 },
  low: { firstResponseMinutes: 8 * 60, resolutionMinutes: 72 * 60 },
};

export function targetFor(priority: TicketPriority): SlaTarget {
  return TARGETS[priority];
}
