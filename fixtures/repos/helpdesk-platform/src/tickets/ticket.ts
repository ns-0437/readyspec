// EVALUATION FIXTURE - fictional code.
export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface Ticket {
  id: string;
  subject: string;
  requesterId: string;
  requesterEmail: string;
  assigneeId: string | null;
  teamId: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  tags: string[];
  customFields: Record<string, string | number>;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** Total minutes spent in "pending" status so far, accumulated across pause/resume cycles. */
  pendingMinutes: number;
  /** When the ticket most recently entered "pending", or null if not currently pending. */
  pendingSince: string | null;
  firstResponseAt: string | null;
  surveySentAt: string | null;
}

let nextId = 1;

export function createTicket(input: {
  subject: string;
  requesterId: string;
  requesterEmail: string;
  priority?: TicketPriority;
  now?: Date;
}): Ticket {
  const now = (input.now ?? new Date()).toISOString();
  return {
    id: `tkt_${nextId++}`,
    subject: input.subject,
    requesterId: input.requesterId,
    requesterEmail: input.requesterEmail,
    assigneeId: null,
    teamId: null,
    status: "open",
    priority: input.priority ?? "normal",
    tags: [],
    customFields: {},
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    pendingMinutes: 0,
    pendingSince: null,
    firstResponseAt: null,
    surveySentAt: null,
  };
}

export function addTag(ticket: Ticket, tag: string): Ticket {
  const clean = tag.trim().toLowerCase();
  if (!clean || ticket.tags.includes(clean)) return ticket;
  return { ...ticket, tags: [...ticket.tags, clean] };
}
