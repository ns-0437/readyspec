// EVALUATION FIXTURE - fictional code.
export interface Discount {
  code: string;
  kind: "percent" | "fixed";
  /** percent: 0-100; fixed: cents */
  value: number;
  expiresAt: string | null;
  minSubtotalCents: number;
}

const COUPONS = new Map<string, Discount>([
  ["WELCOME10", { code: "WELCOME10", kind: "percent", value: 10, expiresAt: null, minSubtotalCents: 0 }],
  ["FIVEOFF", { code: "FIVEOFF", kind: "fixed", value: 500, expiresAt: "2030-01-01T00:00:00Z", minSubtotalCents: 2000 }],
]);

export function findCoupon(code: string): Discount | null {
  return COUPONS.get(code.trim().toUpperCase()) ?? null;
}

export type CouponResult = { ok: true; discount: Discount } | { ok: false; reason: "unknown" | "expired" | "below_minimum" };

/** A single coupon is validated per order; there is no notion of combining coupons. */
export function validateCoupon(code: string, subtotalCents: number, now: Date): CouponResult {
  const discount = findCoupon(code);
  if (!discount) return { ok: false, reason: "unknown" };
  if (discount.expiresAt && new Date(discount.expiresAt) < now) return { ok: false, reason: "expired" };
  if (subtotalCents < discount.minSubtotalCents) return { ok: false, reason: "below_minimum" };
  return { ok: true, discount };
}
