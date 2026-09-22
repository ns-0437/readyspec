// EVALUATION FIXTURE - fictional code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTicket } from "../src/tickets/ticket.ts";
import { transition } from "../src/tickets/lifecycle.ts";
import { markSurveySent, shouldSendSurvey } from "../src/surveys/csat.ts";

test("survey sends once on resolve, never again", () => {
  let ticket = createTicket({ subject: "x", requesterId: "r1", requesterEmail: "r@demo.invalid" });
  ticket = transition(ticket, "resolved");
  assert.equal(shouldSendSurvey(ticket), true);
  ticket = markSurveySent(ticket);
  assert.equal(shouldSendSurvey(ticket), false);
  ticket = transition(ticket, "open");
  ticket = transition(ticket, "resolved");
  assert.equal(shouldSendSurvey(ticket), false);
});
