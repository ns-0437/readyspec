// EVALUATION FIXTURE - fictional code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assignRoundRobin, resetAssignmentForTests } from "../src/agents/assignment.ts";
import { clearAvailabilityForTests } from "../src/agents/availability.ts";
import type { Agent } from "../src/agents/agent.ts";

const agents: Agent[] = [
  { id: "a1", name: "A", email: "a@demo.invalid", teamId: "t1", role: "agent", capacity: 2 },
  { id: "a2", name: "B", email: "b@demo.invalid", teamId: "t1", role: "agent", capacity: 2 },
];

test("round robin spreads assignments across agents", () => {
  resetAssignmentForTests();
  clearAvailabilityForTests();
  const first = assignRoundRobin(agents, []);
  const second = assignRoundRobin(agents, []);
  assert.notEqual(first?.id, second?.id);
});

test("an agent at capacity is skipped", () => {
  resetAssignmentForTests();
  clearAvailabilityForTests();
  const full = { assigneeId: "a1", status: "open" as const };
  const tickets = [full, full] as never[];
  const picked = assignRoundRobin(agents, tickets);
  assert.equal(picked?.id, "a2");
});
