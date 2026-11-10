import { describe, expect, it } from "vitest";
import { asCurrency, formatMoney, isValidKrwRate, parseAmountToCents } from "@/lib/money";
import { todayIn, zonedToUtc } from "@/lib/time";

describe("KRW travel ledger", () => {
  it("formats whole won and leaves other currency formats unchanged", () => {
    expect(asCurrency("KRW")).toBe("KRW");
    expect(formatMoney("10000.00", "KRW")).toBe("₩10,000");
    expect(formatMoney("0.50", "KRW")).toBe("₩1");
    expect(formatMoney("240.00", "TWD")).toBe("NT$240");
    expect(formatMoney("2.00", "EUR")).toBe("€2.00");
    expect(parseAmountToCents("10000")! % 100n).toBe(0n);
    expect(parseAmountToCents("1.5")! % 100n).not.toBe(0n);
  });
  it("validates a positive exact rate with at most ten decimal places", () => {
    for (const x of ["0.024", "1", "0.0000000001", "9999999999.9999999999"]) expect(isValidKrwRate(x)).toBe(true);
    for (const x of ["0", "-1", "1e-3", "0.00000000001", "10000000000", "NaN"]) expect(isValidKrwRate(x)).toBe(false);
  });
  it("uses Seoul local midnight", () => {
    expect(todayIn("Asia/Seoul", new Date("2026-11-02T15:00:00Z"))).toBe("2026-11-03");
    expect(zonedToUtc("2026-11-03", "00:00", "Asia/Seoul").toISOString()).toBe("2026-11-02T15:00:00.000Z");
  });
});
