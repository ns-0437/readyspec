// EVALUATION FIXTURE - fictional code.
import type { Ticket, TicketPriority, TicketStatus } from "../tickets/ticket.ts";

export interface Macro {
  id: string;
  name: string;
  setStatus: TicketStatus | null;
  setPriority: TicketPriority | null;
  addTags: string[];
  bodyTemplate: string;
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

/** Fills `{{requester_name}}`-style placeholders. Unknown placeholders are left as-is, not blanked. */
export function renderMacroBody(macro: Macro, ticket: Ticket, requesterName: string): string {
  const vars: Record<string, string> = { requester_name: requesterName, ticket_id: ticket.id, ticket_subject: ticket.subject };
  return macro.bodyTemplate.replace(PLACEHOLDER, (full, key: string) => (key in vars ? vars[key]! : full));
}

/** Applies a macro's field changes to a ticket. Does not transition status via lifecycle.ts's rules; callers must use transition() separately if they want that validated. */
export function applyMacroFields(macro: Macro, ticket: Ticket): Ticket {
  const tags = [...new Set([...ticket.tags, ...macro.addTags.map((t) => t.trim().toLowerCase())])];
  return {
    ...ticket,
    status: macro.setStatus ?? ticket.status,
    priority: macro.setPriority ?? ticket.priority,
    tags,
  };
}
