// EVALUATION FIXTURE - fictional code.
import type { Ticket } from "../tickets/ticket.ts";

export interface RoutingRule {
  id: string;
  /** Rules are evaluated in this order; the first match wins. */
  order: number;
  matchRequesterDomain: string | null;
  matchSubjectKeyword: string | null;
  matchTag: string | null;
  assignTeamId: string;
}

function matches(rule: RoutingRule, ticket: Ticket): boolean {
  if (rule.matchRequesterDomain) {
    const domain = ticket.requesterEmail.split("@")[1]?.toLowerCase();
    if (domain !== rule.matchRequesterDomain.toLowerCase()) return false;
  }
  if (rule.matchSubjectKeyword && !ticket.subject.toLowerCase().includes(rule.matchSubjectKeyword.toLowerCase())) return false;
  if (rule.matchTag && !ticket.tags.includes(rule.matchTag.toLowerCase())) return false;
  return rule.matchRequesterDomain !== null || rule.matchSubjectKeyword !== null || rule.matchTag !== null;
}

/** Returns the team id from the first matching rule, in `order`, or null if none match. */
export function routeTicket(ticket: Ticket, rules: RoutingRule[]): string | null {
  const sorted = [...rules].sort((a, b) => a.order - b.order);
  for (const rule of sorted) if (matches(rule, ticket)) return rule.assignTeamId;
  return null;
}
