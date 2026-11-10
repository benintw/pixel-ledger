import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ctxQuery, reportQuery, txListQuery } from "@/lib/ledger-api";
import { decimalToCents, divRoundCents, formatMoney } from "@/lib/money";
import { addDays, formatDateZh, monthRange, todayIn } from "@/lib/time";
import { BreakdownList, DailyBars } from "@/components/breakdown";
import { TxList } from "@/components/tx-list";
import { PageHeader } from "@/components/pixel";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({
    meta: [
      { title: "報表｜Pixel Ledger" },
      { name: "description", content: "每日與每月支出報表、分類與付款方式分析。" },
      { property: "og:title", content: "報表｜Pixel Ledger" },
      { property: "og:description", content: "每日與每月支出報表、分類與付款方式分析。" },
    ],
  }),
  component: Reports,
});

function shiftMonth(m: string, n: number) {
  const [y = NaN, mo = NaN] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

function Reports() {
  const { data: ctx } = useSuspenseQuery(ctxQuery);
  const today = todayIn(ctx.ledger.timezone);
  const [tab, setTab] = useState<"daily" | "monthly" | "yearly">("daily");
  const [date, setDate] = useState(today);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(today.slice(0, 7));

  return (
    <div className="pt-4">
      <PageHeader title="報表" />
      <div className="mb-4 grid grid-cols-3 gap-2" role="tablist">
        {(["daily", "monthly", "yearly"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} aria-pressed={tab === t} className="chip-pixel font-pixel" onClick={() => setTab(t)}>
            {t === "daily" ? "日報" : t === "monthly" ? "月報" : "年報"}
          </button>
        ))}
      </div>
      {tab === "daily" ? (
        <Daily ctxId={ctx.ledger.id} date={date} setDate={setDate} />
      ) : tab === "monthly" ? (
        <Monthly ctxId={ctx.ledger.id} month={month} setMonth={setMonth} />
      ) : <Yearly year={year} setYear={setYear} />}
    </div>
  );
}

function Stepper({ label, onPrev, onNext, children }: { label: string; onPrev: () => void; onNext: () => void; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <button className="btn-pixel btn-ghost w-12 p-0" onClick={onPrev} aria-label={`上一${label}`}><ChevronLeft /></button>
      <div className="flex-1">{children}</div>
      <button className="btn-pixel btn-ghost w-12 p-0" onClick={onNext} aria-label={`下一${label}`}><ChevronRight /></button>
    </div>
  );
}

function Daily({ ctxId, date, setDate }: { ctxId: string; date: string; setDate: (d: string) => void }) {
  const { data: ctx } = useSuspenseQuery(ctxQuery);
  const r = useQuery(reportQuery(ctxId, date, date));
  const list = useQuery(txListQuery(ctxId, ctx.ledger.timezone, { from: date, to: date }));
  return (
    <div className="space-y-4">
      <Stepper label="天" onPrev={() => setDate(addDays(date, -1))} onNext={() => setDate(addDays(date, 1))}>
        <input type="date" aria-label="選擇日期" className="field-pixel" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </Stepper>
      <section className="pixel-screen p-5">
        <p className="font-pixel text-sm">{formatDateZh(date)}</p>
        <p className="money mt-1 text-3xl">{r.data ? formatMoney(r.data.total, ctx.ledger.base_currency) : "…"}</p>
        {ctx.ledger.base_currency === "KRW" && r.data?.total_twd != null && <p className="text-sm">約 {formatMoney(r.data.total_twd, "TWD")}（各筆匯率加總）</p>}
        <p className="font-pixel text-sm">{r.data?.count ?? 0} 筆</p>
      </section>
      {r.data && (
        <>
          <BreakdownList title="分類" rows={r.data.by_category} total={r.data.total} currency={ctx.ledger.base_currency} />
          <BreakdownList title="付款方式" rows={r.data.by_payment} total={r.data.total} currency={ctx.ledger.base_currency} />
        </>
      )}
      <section className="pixel-box p-4">
        <h2 className="mb-1 text-lg">明細</h2>
        {list.data ? <TxList ctx={ctx} items={list.data} showDate={false} empty="這天沒有支出" /> : <p className="text-sm">讀取中…</p>}
      </section>
    </div>
  );
}

function Monthly({ ctxId, month, setMonth }: { ctxId: string; month: string; setMonth: (m: string) => void }) {
  const { data: ctx } = useSuspenseQuery(ctxQuery);
  const range = monthRange(month);
  const r = useQuery(reportQuery(ctxId, range.from, range.to));
  const avg = r.data ? divRoundCents(decimalToCents(r.data.total), range.days) : 0n;
  const [y, m] = month.split("-").map(Number);
  return (
    <div className="space-y-4">
      <Stepper label="月" onPrev={() => setMonth(shiftMonth(month, -1))} onNext={() => setMonth(shiftMonth(month, 1))}>
        <input type="month" aria-label="選擇月份" className="field-pixel" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </Stepper>
      <section className="pixel-screen p-5">
        <p className="font-pixel text-sm">{y}年{m}月</p>
        <p className="money mt-1 text-3xl">{r.data ? formatMoney(r.data.total, ctx.ledger.base_currency) : "…"}</p>
        {ctx.ledger.base_currency === "KRW" && r.data?.total_twd != null && <p className="text-sm">約 {formatMoney(r.data.total_twd, "TWD")}（各筆匯率加總）</p>}
        <div className="mt-2 flex justify-between font-pixel text-sm">
          <span>{r.data?.count ?? 0} 筆</span>
          <span>每日平均 {formatMoney(avg, ctx.ledger.base_currency)}</span>
        </div>
      </section>
      {r.data && (
        <>
          <DailyBars days={r.data.by_day} currency={ctx.ledger.base_currency} />
          <BreakdownList title="分類" rows={r.data.by_category} total={r.data.total} currency={ctx.ledger.base_currency} />
          <BreakdownList title="付款方式" rows={r.data.by_payment} total={r.data.total} currency={ctx.ledger.base_currency} />
        </>
      )}
    </div>
  );
}



function Yearly({ year, setYear }: { year: number; setYear: (year: number) => void }) {
  const { data: ctx } = useSuspenseQuery(ctxQuery);
  const today = todayIn(ctx.ledger.timezone);
  const currentYear = Number(today.slice(0, 4));
  const from = `${year}-01-01`;
  const to = year === currentYear ? today : `${year}-12-31`;
  const months = year === currentYear ? Number(today.slice(5, 7)) : 12;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const { data, error } = useQuery(reportQuery(ctx.ledger.id, from, to));
  const currency = ctx.ledger.base_currency;
  const totals = Array.from({ length: months }, () => 0n);
  for (const day of data?.by_day ?? []) {
    const index = Number(day.date.slice(5, 7)) - 1;
    totals[index] = (totals[index] ?? 0n) + decimalToCents(day.total);
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button className="btn-pixel btn-ghost" disabled={year <= 1900} onClick={() => setYear(year - 1)}>上一年</button>
        <span>{year} 年</span>
        <button className="btn-pixel btn-ghost" disabled={year >= currentYear} onClick={() => setYear(year + 1)}>下一年</button>
      </div>
      <section className="pixel-screen p-5">
        <p>{year === currentYear ? "今年截至今日總支出" : "全年總支出"}</p>
        {data ? <>
          <p className="money text-3xl">{formatMoney(data.total, currency)}</p>
          {currency === "KRW" && data.total_twd != null && <p>約 {formatMoney(data.total_twd, "TWD")}</p>}
          <p>{data.count} 筆</p>
          <p>每月平均 {formatMoney(divRoundCents(decimalToCents(data.total), months), currency)}（除以 {months} 個月）</p>
          <p>每日平均 {formatMoney(divRoundCents(decimalToCents(data.total), days), currency)}（除以 {days} 天）</p>
        </> : <p>{error ? "讀取失敗" : "讀取中…"}</p>}
      </section>
      {data && <section className="pixel-box p-4"><h2>各月支出</h2><ul className="divide-y">
        {totals.map((total, i) => <li key={i} className="flex justify-between py-2"><span>{i + 1} 月</span><span className="money">{formatMoney(total, currency)}</span></li>)}
      </ul></section>}
    </div>
  );
}
