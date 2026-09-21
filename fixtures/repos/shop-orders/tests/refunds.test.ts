// EVALUATION FIXTURE - fictional code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeOrder } from "../src/orders/checkout.ts";
import { refundOrder, RefundNotAllowed } from "../src/orders/refunds.ts";
import { available } from "../src/inventory/stock.ts";

const place = () => placeOrder({ customerId: "c1", customerEmail: "c@demo.invalid", lines: [{ sku: "MUG-01", qty: 1, unitCents: 1000 }] }, new Date("2026-03-01T00:00:00Z"));

test("full refund restocks and returns everything paid", () => {
  const before = available("MUG-01");
  const order = place();
  const refunded = refundOrder(order, new Date("2026-03-05T00:00:00Z"));
  assert.equal(refunded.status, "refunded");
  assert.equal(refunded.refundedCents, order.paidCents);
  assert.equal(available("MUG-01"), before);
});

test("outside the window is rejected", () => {
  const order = place();
  assert.throws(() => refundOrder(order, new Date("2026-04-15T00:00:00Z")), (e: unknown) => e instanceof RefundNotAllowed && e.reason === "outside_window");
});

test("double refunds are rejected", () => {
  const refunded = refundOrder(place(), new Date("2026-03-02T00:00:00Z"));
  assert.throws(() => refundOrder(refunded, new Date("2026-03-03T00:00:00Z")), (e: unknown) => e instanceof RefundNotAllowed && e.reason === "already_refunded");
});
