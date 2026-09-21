// EVALUATION FIXTURE - fictional code.
import { release } from "../inventory/stock.ts";
import type { Order } from "./order.ts";

/** Refund window in days. NOTE: docs/orders.md says 30. */
export const REFUND_WINDOW_DAYS = 14;

export class RefundNotAllowed extends Error {
  reason: "already_refunded" | "outside_window" | "not_paid";
  constructor(reason: "already_refunded" | "outside_window" | "not_paid") {
    super(`refund not allowed: ${reason}`);
    this.reason = reason;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Full refunds only: the whole paid amount is returned and every line goes back into stock. */
export function refundOrder(order: Order, now = new Date()): Order {
  if (order.status === "refunded") throw new RefundNotAllowed("already_refunded");
  if (order.status !== "paid" && order.status !== "shipped") throw new RefundNotAllowed("not_paid");
  const ageDays = (now.getTime() - new Date(order.placedAt).getTime()) / DAY_MS;
  if (ageDays > REFUND_WINDOW_DAYS) throw new RefundNotAllowed("outside_window");
  for (const line of order.lines) release(line.sku, line.qty);
  return { ...order, status: "refunded", refundedCents: order.paidCents };
}
