import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { ctxQuery, txListQuery } from "@/lib/ledger-api";
import { formatTWD, sumCents } from "@/lib/money";
import { TxList } from "@/components/tx-list";
import { Field, PageHeader, PixelButton } from "@/components/pixel";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "紀錄｜Pixel Ledger" },
      { name: "description", content: "搜尋與篩選所有支出紀錄。" },
      { property: "og:title", content: "紀錄｜Pixel Ledger" },
      { property: "og:description", content: "搜尋與篩選所有支出紀錄。" },
    ],
  }),
  component: History,
});

function History() {
  const { data: ctx } = useSuspenseQuery(ctxQuery);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const dq = useDeferredValue(q);
  const filters = { q: dq, from: from || undefined, to: to || undefined, categoryId: categoryId || undefined, paymentId: paymentId || undefined };
  const list = useQuery(txListQuery(ctx.ledger.id, ctx.ledger.timezone, filters));
  const rangeError = from && to && to < from ? "結束日期需晚於開始日期" : "";
  const items = list.data ?? [];

  return (
    <div className="pt-4">
      <PageHeader title="紀錄" />
      <div className="pixel-box mb-4 space-y-3 p-4">
        <input type="search" className="field-pixel" placeholder="搜尋說明或備註" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="從" htmlFor="from"><input id="from" type="date" className="field-pixel" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="到" htmlFor="to" error={rangeError}><input id="to" type="date" className="field-pixel" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="分類" htmlFor="cat">
            <select id="cat" className="field-pixel" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">全部</option>
              {ctx.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="付款" htmlFor="pm">
            <select id="pm" className="field-pixel" value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
              <option value="">全部</option>
              {ctx.methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
        </div>
        <PixelButton variant="ghost" className="w-full" onClick={() => { setQ(""); setFrom(""); setTo(""); setCategoryId(""); setPaymentId(""); }}>
          清除篩選
        </PixelButton>
      </div>
      <section className="pixel-box p-4">
        <div className="mb-1 flex justify-between font-pixel text-sm">
          <span>{items.length} 筆{items.length >= 500 ? "（顯示前 500 筆）" : ""}</span>
          <span className="money">{formatTWD(sumCents(items.map((t) => t.amount_twd)))}</span>
        </div>
        {list.isLoading ? <p className="py-4 text-sm">讀取中…</p> : list.error ? <p className="text-destructive">讀取失敗</p> : <TxList ctx={ctx} items={items} empty="沒有符合的紀錄" />}
      </section>
    </div>
  );
}
