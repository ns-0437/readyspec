// EVALUATION FIXTURE - fictional code.
import type { Order } from "../orders/order.ts";

export const outbox: { to: string; subject: string; body: string }[] = [];

/** Sends synchronously; a failure here would surface to the caller of placeOrder. */
export function sendOrderConfirmation(order: Order): void {
  outbox.push({
    to: order.customerEmail,
    subject: `Order ${order.id} confirmed`,
    body: `Thanks! You paid ${(order.paidCents / 100).toFixed(2)}.`,
  });
}
