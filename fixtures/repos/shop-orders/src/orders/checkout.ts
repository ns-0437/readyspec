// EVALUATION FIXTURE - fictional code.
import { release, reserve } from "../inventory/stock.ts";
import { sendOrderConfirmation } from "../notifications/order-emails.ts";
import { validateCoupon } from "./discounts.ts";
import type { Order, OrderLine } from "./order.ts";
import { computeTotals, subtotal } from "./pricing.ts";

export interface PlaceOrderInput {
  customerId: string;
  customerEmail: string;
  lines: OrderLine[];
  couponCode?: string;
}

let nextId = 1;

/** Reserves stock line by line (rolling back on failure), prices the order, then emails the customer. */
export function placeOrder(input: PlaceOrderInput, now = new Date()): Order {
  const reserved: OrderLine[] = [];
  try {
    for (const line of input.lines) {
      reserve(line.sku, line.qty);
      reserved.push(line);
    }
  } catch (e) {
    for (const r of reserved) release(r.sku, r.qty);
    throw e;
  }
  let discount = null;
  if (input.couponCode) {
    const result = validateCoupon(input.couponCode, subtotal(input.lines), now);
    if (!result.ok) {
      for (const r of reserved) release(r.sku, r.qty);
      throw new Error(`coupon rejected: ${result.reason}`);
    }
    discount = result.discount;
  }
  const totals = computeTotals(input.lines, discount);
  const order: Order = {
    id: `ord_${nextId++}`,
    customerId: input.customerId,
    customerEmail: input.customerEmail,
    lines: input.lines,
    couponCode: discount?.code ?? null,
    status: "paid",
    placedAt: now.toISOString(),
    paidCents: totals.totalCents,
    taxCents: totals.taxCents,
    discountCents: totals.discountCents,
    refundedCents: 0,
  };
  sendOrderConfirmation(order);
  return order;
}
