// EVALUATION FIXTURE - fictional code.
export type OrderStatus = "pending" | "paid" | "shipped" | "refunded" | "cancelled";

export interface OrderLine {
  sku: string;
  qty: number;
  unitCents: number;
}

export interface Order {
  id: string;
  customerId: string;
  customerEmail: string;
  lines: OrderLine[];
  couponCode: string | null;
  status: OrderStatus;
  placedAt: string;
  paidCents: number;
  taxCents: number;
  discountCents: number;
  refundedCents: number;
}
