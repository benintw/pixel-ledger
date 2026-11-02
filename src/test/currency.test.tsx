import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { asCurrency, formatMoney, formatTWD } from "@/lib/money";
import { utcToZoned, zonedToUtc } from "@/lib/time";
import { BreakdownList, DailyBars } from "@/components/breakdown";

describe("ledger currencies", () => {
  it("keeps EUR cents exact and preserves TWD output", () => {
    expect(formatMoney("6630.17", "EUR")).toBe("€6,630.17");
    expect(formatMoney("5", "EUR")).toBe("€5.00");
    expect(formatMoney(10n, "EUR")).toBe("€0.10");
    expect(formatTWD("13608.00")).toBe("NT$13,608");
    expect(formatMoney("9999999999999999.99", "EUR")).toBe("€9,999,999,999,999,999.99");
    expect(() => asCurrency("KRW")).toThrow();
  });
  it("renders EUR breakdowns and chart tooltips without TWD labels", () => {
    const { container } = render(<>
      <BreakdownList title="分類" currency="EUR" total="18.95" rows={[{ id: "a", name: "交通", count: 1, total: "18.95" }]} />
      <DailyBars currency="EUR" days={[{ date: "2026-08-18", total: "18.95", count: 1 }]} />
    </>);
    expect(screen.getByText(/€18.95/)).toBeInTheDocument();
    expect(container.querySelector('[title="2026-08-18：€18.95"]')).not.toBeNull();
    expect(container.textContent).not.toContain("NT$");
  });
});

describe("Berlin dates and daylight saving", () => {
  it("preserves import dates in both summer and winter", () => {
    expect(zonedToUtc("2026-08-18", "12:00", "Europe/Berlin").toISOString()).toBe("2026-08-18T10:00:00.000Z");
    expect(zonedToUtc("2026-10-28", "12:00", "Europe/Berlin").toISOString()).toBe("2026-10-28T11:00:00.000Z");
    expect(utcToZoned("2026-08-31T22:00:00Z", "Europe/Berlin").date).toBe("2026-09-01");
  });
  it("uses 23/25-hour days and rejects a nonexistent local time", () => {
    const duration = (from: string, to: string) =>
      zonedToUtc(to, "00:00", "Europe/Berlin").getTime() - zonedToUtc(from, "00:00", "Europe/Berlin").getTime();
    expect(duration("2026-03-29", "2026-03-30")).toBe(23 * 3600000);
    expect(duration("2026-10-25", "2026-10-26")).toBe(25 * 3600000);
    expect(() => zonedToUtc("2026-03-29", "02:30", "Europe/Berlin")).toThrow(/不存在/);
  });
});
