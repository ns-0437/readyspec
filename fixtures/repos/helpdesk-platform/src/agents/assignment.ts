// EVALUATION FIXTURE - fictional code.
import { isAvailable } from "./availability.ts";
import type { Agent } from "./agent.ts";
import type { Ticket } from "../tickets/ticket.ts";

/** Tickets currently open or pending for each agent, used to enforce capacity. */
function openCountFor(agentId: string, tickets: Ticket[]): number {
  return tickets.filter((t) => t.assigneeId === agentId && (t.status === "open" || t.status === "pending")).length;
}

/**
 * Round-robin among available agents on the given team who are under capacity. Agents are tried
 * in array order starting after the last-assigned index for that team, so load spreads out over
 * repeated calls rather than always picking the first eligible agent.
 */
const lastIndexByTeam = new Map<string, number>();

export function assignRoundRobin(teamAgents: Agent[], allTickets: Ticket[], now = new Date()): Agent | null {
  if (teamAgents.length === 0) return null;
  const teamId = teamAgents[0]!.teamId;
  const start = (lastIndexByTeam.get(teamId) ?? -1) + 1;
  for (let i = 0; i < teamAgents.length; i++) {
    const idx = (start + i) % teamAgents.length;
    const agent = teamAgents[idx]!;
    if (!isAvailable(agent, now)) continue;
    if (openCountFor(agent.id, allTickets) >= agent.capacity) continue;
    lastIndexByTeam.set(teamId, idx);
    return agent;
  }
  return null; // nobody available and under capacity: ticket stays unassigned
}

export function resetAssignmentForTests(): void {
  lastIndexByTeam.clear();
}
