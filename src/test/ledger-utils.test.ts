import { describe, expect, it } from "vitest";
import { parseAmountToCents, centsToDecimal, decimalToCents, sumCents } from "@/lib/money";
import { addDays, isValidDate, monthRange, utcToZoned, zonedToUtc } from "@/lib/time";
import { buildCsv, csvNumber } from "@/lib/csv";

describe("exact money", () => {
  it("round trips amounts without floating point loss", () => {
    const cents = parseAmountToCents("1,234.56");
    expect(cents).toBe(123456n);
    expect(centsToDecimal(cents!)).toBe("1234.56");
    expect(sumCents(["0.10", "0.20", "1234.56"])).toBe(123486n);
    expect(decimalToCents("9999999999999999.99")).toBe(999999999999999999n);
  });
  it("rejects zero, negatives and excessive decimal places", () => {
    for (const value of ["0", "-1", "1.001", "abc"]) expect(parseAmountToCents(value)).toBeNull();
  });
});

describe("Taipei calendar boundaries", () => {
  it("uses the ledger date around local midnight", () => {
    expect(utcToZoned("2026-01-31T15:59:00Z", "Asia/Taipei").date).toBe("2026-01-31");
    expect(utcToZoned("2026-01-31T16:00:00Z", "Asia/Taipei").date).toBe("2026-02-01");
    expect(zonedToUtc("2026-02-01", "00:00", "Asia/Taipei").toISOString()).toBe("2026-01-31T16:00:00.000Z");
  });
  it("handles leap days and month boundaries", () => {
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29", days: 29 });
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(isValidDate("2025-02-29")).toBe(false);
  });
});

describe("CSV export", () => {
  it("quotes Chinese text, quotes and formula-like values and includes a BOM", () => {
    const csv = buildCsv(["說明", "金額"], [[{ text: '=1+1,"午餐"' }, { num: "12.50" }]]);
    expect(csv).toBe('\uFEFF"說明","金額"\r\n"\'=1+1,""午餐""",12.50\r\n');
    expect(() => csvNumber("=1+1")).toThrow();
  });
});
