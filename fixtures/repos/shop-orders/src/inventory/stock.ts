// EVALUATION FIXTURE - fictional code.
const stock = new Map<string, number>([
  ["MUG-01", 40],
  ["TEE-02", 12],
  ["CAP-03", 6],
]);

export const LOW_STOCK_THRESHOLD = 5;

export class OutOfStock extends Error {
  sku: string;
  constructor(sku: string) {
    super(`out of stock: ${sku}`);
    this.sku = sku;
  }
}

export function available(sku: string): number {
  return stock.get(sku) ?? 0;
}

export function reserve(sku: string, qty: number): void {
  const have = available(sku);
  if (have < qty) throw new OutOfStock(sku);
  stock.set(sku, have - qty);
}

export function release(sku: string, qty: number): void {
  stock.set(sku, available(sku) + qty);
}

export function isLowStock(sku: string): boolean {
  return available(sku) <= LOW_STOCK_THRESHOLD;
}
