// EVALUATION FIXTURE - fictional code.
export interface AuditEntry {
  ticketId: string;
  actorId: string;
  field: "status" | "priority" | "assigneeId";
  oldValue: string | null;
  newValue: string | null;
  at: string;
}

const entries: AuditEntry[] = [];

/** Comments are intentionally NOT recorded here; they live in the ticket's own comment history. */
export function record(entry: AuditEntry): void {
  entries.push(entry);
}

export function historyFor(ticketId: string): AuditEntry[] {
  return entries.filter((e) => e.ticketId === ticketId).sort((a, b) => a.at.localeCompare(b.at));
}

export function clearAuditForTests(): void {
  entries.length = 0;
}
