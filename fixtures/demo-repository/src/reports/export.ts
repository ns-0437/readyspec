// DEMO FIXTURE - fictional code, not BetterMe's. Unrelated to notifications on purpose.
export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(",")).join("\n");
}
