// EVALUATION FIXTURE - fictional code. Unrelated to checkout or refunds on purpose.
export interface SalesRow {
  day: string;
  orders: number;
  grossCents: number;
}

export function totalGross(rows: SalesRow[]): number {
  return rows.reduce((s, r) => s + r.grossCents, 0);
}

export function bestDay(rows: SalesRow[]): SalesRow | undefined {
  return [...rows].sort((a, b) => b.grossCents - a.grossCents)[0];
}
