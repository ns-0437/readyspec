// EVALUATION FIXTURE - fictional code.
import type { Ticket } from "../tickets/ticket.ts";
import { targetFor } from "./policy.ts";

const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 17;

/** Business-hour minutes between two instants, UTC only: this fixture has no per-account timezone yet. */
export function businessMinutesBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let minutes = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    const day = cursor.getUTCDay();
    const hour = cursor.getUTCHours();
    const isBusinessHour = day !== 0 && day !== 6 && hour >= BUSINESS_START_HOUR && hour < BUSINESS_END_HOUR;
    if (isBusinessHour) minutes++;
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return minutes;
}

export interface SlaStatus {
  resolutionMinutesElapsed: number;
  resolutionMinutesRemaining: number;
  breached: boolean;
}

/**
 * The clock counts business minutes since creation, minus time spent "pending" (see
 * tickets/lifecycle.ts, which accumulates pendingMinutes across pause/resume cycles). It does
 * NOT separately track first-response elapsed time; only resolution is computed here today.
 */
export function resolutionStatus(ticket: Ticket, now = new Date()): SlaStatus {
  const target = targetFor(ticket.priority).resolutionMinutes;
  const totalBusinessMinutes = businessMinutesBetween(new Date(ticket.createdAt), now);
  let pendingBusinessMinutes = ticket.pendingMinutes;
  if (ticket.pendingSince) pendingBusinessMinutes += businessMinutesBetween(new Date(ticket.pendingSince), now);
  const elapsed = Math.max(0, totalBusinessMinutes - pendingBusinessMinutes);
  return { resolutionMinutesElapsed: elapsed, resolutionMinutesRemaining: target - elapsed, breached: elapsed > target };
}
