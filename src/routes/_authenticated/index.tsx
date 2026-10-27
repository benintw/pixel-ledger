import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { ctxQuery, reportQuery, txListQuery } from "@/lib/ledger-api";
import { formatTWD } from "@/lib/money";
import { formatDateZh, monthRange, todayIn } from "@/lib/time";
import { TxList } from "@/components/tx-list";
import { useNow } from "@/hooks/use-now";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "今日｜Pixel Ledger" },
      { name: "description", content: "今天花了多少？今日與本月支出總覽。" },
      { property: "og:title", content: "今日｜Pixel Ledger" },
      { property: "og:description", content: "今天花了多少？今日與本月支出總覽。" },
    ],
  }),
  component: Today,
});

function Today() {
  const { data: ctx } = useSuspenseQuery(ctxQuery);
  const tz = ctx.ledger.timezone;
  const today = todayIn(tz, useNow());
  const month = monthRange(today.slice(0, 7));
  const day = useQuery(reportQuery(ctx.ledger.id, today, today));
  const mon = useQuery(reportQuery(ctx.ledger.id, month.from, month.to));
  const recent = useQuery(txListQuery(ctx.ledger.id, tz, { limit: 6 }));

  return (
    <div className="space-y-5 pt-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="font-pixel text-sm text-muted-foreground">{ctx.ledger.name}</p>
          <h1 className="text-xl">{formatDateZh(today)}</h1>
        </div>
        <img src="/icons/icon-192.png" alt="" width={44} height={44} className="border-[3px] border-border" />
      </header>

      <section className="pixel-screen p-5" aria-live="polite">
        <p className="font-pixel text-sm">今日支出</p>
        <p className="money mt-1 text-4xl">{day.data ? formatTWD(day.data.total) : "…"}</p>
        <div className="mt-3 flex justify-between font-pixel text-sm">
          <span>{day.data ? `${day.data.count} 筆` : ""}</span>
          <span>本月 {mon.data ? formatTWD(mon.data.total) : "…"}</span>
        </div>
        {(day.error || mon.error) && <p className="mt-2 text-sm text-destructive">讀取失敗，請重新整理。</p>}
      </section>

      <Link to="/add" className="btn-pixel btn-primary w-full py-4 text-xl">
        <Plus className="h-6 w-6" strokeWidth={3} /> 記一筆
      </Link>

      <section className="pixel-box p-4">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg">最近紀錄</h2>
          <Link to="/history" className="text-sm underline">全部</Link>
        </div>
        {recent.data ? <TxList ctx={ctx} items={recent.data} empty="還沒有任何紀錄，記下第一筆吧！" /> : <p className="py-4 text-sm">讀取中…</p>}
      </section>
    </div>
  );
}
