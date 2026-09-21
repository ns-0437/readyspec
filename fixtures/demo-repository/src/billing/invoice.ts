// DEMO FIXTURE - fictional code, not BetterMe's. Unrelated to notifications on purpose.
export function invoiceTotal(lines: { cents: number; qty: number }[]): number {
  return lines.reduce((sum, l) => sum + l.cents * l.qty, 0);
}
