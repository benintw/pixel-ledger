import { decimalToCents, formatTWD, ratioPercent } from "@/lib/money";
import type { Breakdown as B } from "@/lib/ledger-api";
import { Empty } from "@/components/pixel";

export function BreakdownList({ title, rows, total }: { title: string; rows: B[]; total: string }) {
  const t = decimalToCents(total);
  return (
    <section className="pixel-box p-4">
      <h2 className="mb-3 text-lg">{title}</h2>
      {!rows.length ? (
        <Empty>沒有資料</Empty>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const pct = ratioPercent(decimalToCents(r.total), t);
            return (
              <li key={r.id}>
                <div className="flex justify-between text-sm">
                  <span>
                    {r.name} <span className="text-muted-foreground">×{r.count}</span>
                  </span>
                  <span className="money">
                    {formatTWD(r.total)} <span className="text-xs font-normal text-muted-foreground">{pct}%</span>
                  </span>
                </div>
                <div className="mt-1 h-3 border-2 border-border bg-muted">
                  <div className="h-full bg-secondary" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function DailyBars({ days }: { days: { date: string; total: string; count: number }[] }) {
  const vals = days.map((d) => decimalToCents(d.total));
  const max = vals.reduce((a, b) => (b > a ? b : a), 0n);
  return (
    <section className="pixel-box p-4">
      <h2 className="mb-3 text-lg">每日支出</h2>
      <div className="flex h-40 items-end gap-[2px]" role="img" aria-label="每日支出長條圖">
        {days.map((d, i) => (
          <div key={d.date} className="flex h-full flex-1 flex-col justify-end" title={`${d.date}：${formatTWD(d.total)}`}>
            {(vals[i] ?? 0n) > 0n && <div className="bar-pixel" style={{ height: `${Math.max(ratioPercent(vals[i] ?? 0n, max), 3)}%` }} />}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between font-pixel-latin text-[10px] text-muted-foreground">
        <span>1</span>
        <span>{Math.ceil(days.length / 2)}</span>
        <span>{days.length}</span>
      </div>
    </section>
  );
}
