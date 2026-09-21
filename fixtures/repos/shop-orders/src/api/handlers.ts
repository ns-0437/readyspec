// EVALUATION FIXTURE - fictional code.
import { placeOrder, type PlaceOrderInput } from "../orders/checkout.ts";
import type { Order } from "../orders/order.ts";
import { refundOrder, RefundNotAllowed } from "../orders/refunds.ts";

export interface Caller {
  userId: string;
  role: "customer" | "support";
}

const orders = new Map<string, Order>();

export function postOrder(caller: Caller, input: Omit<PlaceOrderInput, "customerId">) {
  const order = placeOrder({ ...input, customerId: caller.userId });
  orders.set(order.id, order);
  return { status: 201, body: order };
}

/** Only support staff may refund. */
export function postRefund(caller: Caller, orderId: string) {
  if (caller.role !== "support") return { status: 403, body: { error: "forbidden" } };
  const order = orders.get(orderId);
  if (!order) return { status: 404, body: { error: "not found" } };
  try {
    const refunded = refundOrder(order);
    orders.set(orderId, refunded);
    return { status: 200, body: refunded };
  } catch (e) {
    if (e instanceof RefundNotAllowed) return { status: 409, body: { error: e.reason } };
    throw e;
  }
}
