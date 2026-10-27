// Exact money handling via integer minor units (cents) with BigInt. Never uses floats.

const AMOUNT_RE = /^(\d{1,16})(?:\.(\d{1,2}))?$/;

/** Parse user input like "1,234.5" into cents. Returns null if invalid or not positive. */
export function parseAmountToCents(input: string): bigint | null {
  const s = input.trim().replace(/[,，\s]/g, "");
  const m = AMOUNT_RE.exec(s);
  if (!m) return null;
  const cents = BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
  if (cents <= 0n) return null;
  return cents;
}

/** Parse a decimal string from the database (e.g. "123.45", "0", "-1.5") into cents. */
export function decimalToCents(dec: string | number | null | undefined): bigint {
  if (dec === null || dec === undefined || dec === "") return 0n;
  const s = String(dec).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`invalid decimal: ${s}`);
  const frac = (m[3] ?? "").padEnd(2, "0");
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) throw new Error(`too many decimals: ${s}`);
  const v = BigInt(m[2]!) * 100n + BigInt(frac.slice(0, 2));
  return m[1] === "-" ? -v : v;
}

/** Cents → canonical decimal string "1234.50" for DB writes. */
export function centsToDecimal(cents: bigint): string {
  const neg = cents < 0n;
  const a = neg ? -cents : cents;
  const s = `${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/** Display: "NT$1,234" or "NT$1,234.50". */
export function formatTWD(value: bigint | string | number): string {
  const cents = typeof value === "bigint" ? value : decimalToCents(value);
  const neg = cents < 0n;
  const a = neg ? -cents : cents;
  const int = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = a % 100n;
  return `${neg ? "-" : ""}NT$${int}${frac === 0n ? "" : "." + frac.toString().padStart(2, "0")}`;
}

/** Plain decimal for editing inputs, e.g. "1234.5" → "1234.5", "100.00" → "100". */
export function centsToInput(cents: bigint): string {
  const int = cents / 100n;
  const frac = cents % 100n;
  if (frac === 0n) return int.toString();
  return `${int}.${frac.toString().padStart(2, "0").replace(/0$/, "")}`;
}

export function sumCents(values: Array<string | bigint>): bigint {
  return values.reduce<bigint>((acc, v) => acc + (typeof v === "bigint" ? v : decimalToCents(v)), 0n);
}

/** Integer division rounded half-up (for positive totals). */
export function divRoundCents(cents: bigint, divisor: number): bigint {
  if (divisor <= 0) return 0n;
  const d = BigInt(divisor);
  return (cents * 2n + d) / (2n * d);
}

/** Percentage 0–100 with one decimal for display widths only. */
export function ratioPercent(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return Number((part * 1000n) / whole) / 10;
}
