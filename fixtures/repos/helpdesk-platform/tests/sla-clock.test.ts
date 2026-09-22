// EVALUATION FIXTURE - fictional code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTicket } from "../src/tickets/ticket.ts";
import { resolutionStatus } from "../src/sla/clock.ts";

test("resolution clock excludes weekends and off-hours", () => {
  const created = new Date("2026-01-02T16:00:00Z"); // Friday 4pm
  const ticket = createTicket({ subject: "x", requesterId: "r1", requesterEmail: "r@demo.invalid", priority: "normal", now: created });
  const checkedAt = new Date("2026-01-05T10:00:00Z"); // Monday 10am
  const status = resolutionStatus(ticket, checkedAt);
  // Only Friday 16:00-17:00 (60 min) and Monday 09:00-10:00 (60 min) are business hours.
  assert.equal(status.resolutionMinutesElapsed, 120);
});

test("pending time does not count toward the resolution clock", () => {
  const created = new Date("2026-01-05T09:00:00Z"); // Monday 9am
  let ticket = createTicket({ subject: "x", requesterId: "r1", requesterEmail: "r@demo.invalid", priority: "urgent", now: created });
  ticket = { ...ticket, pendingMinutes: 90 };
  const checkedAt = new Date("2026-01-05T13:00:00Z"); // 4 business hours later
  const status = resolutionStatus(ticket, checkedAt);
  assert.equal(status.resolutionMinutesElapsed, 240 - 90);
});
