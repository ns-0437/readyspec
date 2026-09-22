// EVALUATION FIXTURE - fictional code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTicket } from "../src/tickets/ticket.ts";
import { InvalidTransition, transition } from "../src/tickets/lifecycle.ts";

test("pending accumulates minutes and clears pendingSince on resume", () => {
  const t0 = new Date("2026-01-05T10:00:00Z"); // Monday
  let ticket = createTicket({ subject: "x", requesterId: "r1", requesterEmail: "r@demo.invalid", now: t0 });
  ticket = transition(ticket, "pending", t0);
  assert.equal(ticket.pendingSince, t0.toISOString());
  const t1 = new Date("2026-01-05T10:30:00Z");
  ticket = transition(ticket, "open", t1);
  assert.equal(ticket.pendingSince, null);
  assert.equal(ticket.pendingMinutes, 30);
});

test("closed can only reopen to open", () => {
  const t0 = new Date("2026-01-05T10:00:00Z");
  let ticket = createTicket({ subject: "x", requesterId: "r1", requesterEmail: "r@demo.invalid", now: t0 });
  ticket = transition(ticket, "closed", t0);
  assert.throws(() => transition(ticket, "resolved", t0), InvalidTransition);
  ticket = transition(ticket, "open", t0);
  assert.equal(ticket.status, "open");
});
