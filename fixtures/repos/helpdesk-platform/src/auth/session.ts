// EVALUATION FIXTURE - fictional code.
import type { Agent } from "../agents/agent.ts";

const tokenTable = new Map<string, string>();

export class Unauthorized extends Error {
  constructor() {
    super("unauthorized");
  }
}

export function issueToken(agent: Agent): string {
  const token = `tok_${agent.id}_${tokenTable.size + 1}`;
  tokenTable.set(token, agent.id);
  return token;
}

export function requireAgent(authorization: string | undefined, agents: Map<string, Agent>): Agent {
  const token = authorization?.replace(/^Bearer\s+/i, "");
  const id = token ? tokenTable.get(token) : undefined;
  const agent = id ? agents.get(id) : undefined;
  if (!agent) throw new Unauthorized();
  return agent;
}

export function requireAdmin(agent: Agent): void {
  if (agent.role !== "admin") throw new Unauthorized();
}
