// EVALUATION FIXTURE - fictional code.
import type { Agent } from "./agent.ts";

export interface Shift {
  agentId: string;
  /** 0 = Sunday. */
  dayOfWeek: number;
  startHourLocal: number;
  endHourLocal: number;
}

const shifts: Shift[] = [];
const offline = new Set<string>();

export function setShift(shift: Shift): void {
  shifts.push(shift);
}

export function setOffline(agentId: string, isOffline: boolean): void {
  if (isOffline) offline.add(agentId);
  else offline.delete(agentId);
}

/** An agent is available if they are not manually marked offline and it is within a configured shift, if any shifts exist for them. */
export function isAvailable(agent: Agent, now: Date): boolean {
  if (offline.has(agent.id)) return false;
  const mine = shifts.filter((s) => s.agentId === agent.id);
  if (mine.length === 0) return true; // no shift configured: always available
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  return mine.some((s) => s.dayOfWeek === day && hour >= s.startHourLocal && hour < s.endHourLocal);
}

export function clearAvailabilityForTests(): void {
  shifts.length = 0;
  offline.clear();
}
