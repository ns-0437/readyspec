// EVALUATION FIXTURE - fictional code.
import type { Discount } from "./discounts.ts";
import type { OrderLine } from "./order.ts";

export const TAX_RATE = 0.08;

export function subtotal(lines: OrderLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty * l.unitCents, 0);
}

/** Cents taken off the subtotal. A fixed discount can never exceed the subtotal. */
export function discountCents(subtotalCents: number, discount: Discount | null): number {
  if (!discount) return 0;
  if (discount.kind === "percent") return Math.round((subtotalCents * discount.value) / 100);
  return Math.min(discount.value, subtotalCents);
}

export interface Totals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

/** Tax is charged on the discounted subtotal and rounded half up to a whole cent. */
export function computeTotals(lines: OrderLine[], discount: Discount | null): Totals {
  const sub = subtotal(lines);
  const off = discountCents(sub, discount);
  const taxable = sub - off;
  const tax = Math.round(taxable * TAX_RATE);
  return { subtotalCents: sub, discountCents: off, taxCents: tax, totalCents: taxable + tax };
}
