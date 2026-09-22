// EVALUATION FIXTURE - fictional code.
import { requireAgent } from "../auth/session.ts";
import type { Agent } from "../agents/agent.ts";
import { routeTicket, type RoutingRule } from "../routing/rules.ts";
import { createTicket, type Ticket } from "../tickets/ticket.ts";
import { transition } from "../tickets/lifecycle.ts";
import { notifyRequesterCreated } from "../notifications/ticket-notifications.ts";

export interface ApiRequest {
  method: "GET" | "POST" | "PATCH";
  path: string;
  authorization?: string;
  body?: unknown;
}

const tickets = new Map<string, Ticket>();

export function handle(req: ApiRequest, agents: Map<string, Agent>, rules: RoutingRule[]): { status: number; body: unknown } {
  const agent = requireAgent(req.authorization, agents);

  if (req.method === "POST" && req.path === "/tickets") {
    const body = (req.body ?? {}) as { subject?: string; requesterId?: string; requesterEmail?: string };
    if (!body.subject || !body.requesterEmail) return { status: 400, body: { error: "subject and requesterEmail are required" } };
    let ticket = createTicket({ subject: body.subject, requesterId: body.requesterId ?? "", requesterEmail: body.requesterEmail });
    const teamId = routeTicket(ticket, rules);
    if (teamId) ticket = { ...ticket, teamId };
    tickets.set(ticket.id, ticket);
    notifyRequesterCreated(ticket);
    return { status: 201, body: ticket };
  }

  if (req.method === "PATCH" && req.path.startsWith("/tickets/")) {
    const id = req.path.split("/")[2];
    const ticket = id ? tickets.get(id) : undefined;
    if (!ticket) return { status: 404, body: { error: "not found" } };
    const body = (req.body ?? {}) as { status?: Ticket["status"] };
    if (!body.status) return { status: 400, body: { error: "status is required" } };
    const updated = transition(ticket, body.status);
    tickets.set(ticket.id, updated);
    return { status: 200, body: updated };
  }

  if (req.method === "GET" && req.path === "/tickets") {
    void agent;
    return { status: 200, body: [...tickets.values()] };
  }

  return { status: 404, body: { error: "not found" } };
}

export function clearTicketsForTests(): void {
  tickets.clear();
}
