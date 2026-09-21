// EVALUATION FIXTURE - fictional code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTotals, discountCents } from "../src/orders/pricing.ts";
import { validateCoupon } from "../src/orders/discounts.ts";

const lines = [{ sku: "MUG-01", qty: 2, unitCents: 1250 }];

test("percent discount then tax on the discounted amount", () => {
  const coupon = validateCoupon("WELCOME10", 2500, new Date("2026-01-01"));
  assert.equal(coupon.ok, true);
  if (!coupon.ok) return;
  const t = computeTotals(lines, coupon.discount);
  assert.deepEqual(t, { subtotalCents: 2500, discountCents: 250, taxCents: 180, totalCents: 2430 });
});

test("a fixed discount never exceeds the subtotal", () => {
  assert.equal(discountCents(300, { code: "X", kind: "fixed", value: 500, expiresAt: null, minSubtotalCents: 0 }), 300);
});

test("unknown and below-minimum coupons are rejected", () => {
  assert.deepEqual(validateCoupon("NOPE", 5000, new Date()), { ok: false, reason: "unknown" });
  assert.deepEqual(validateCoupon("FIVEOFF", 100, new Date("2026-01-01")), { ok: false, reason: "below_minimum" });
});
