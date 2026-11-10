import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ctxQuery, friendlyError, txListQuery } from "@/lib/ledger-api";
import { utcToZoned } from "@/lib/time";
import { formatMoney, sumCents } from "@/lib/money";
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
  const filters = { q: dq, from, to, categoryId, paymentId };
  const list = useQuery(txListQuery(ctx.ledger.id, ctx.ledger.timezone, filters));
  const rangeError = from && to && to < from ? "結束日期需晚於開始日期" : "";
  const items = list.data ?? [];
  const qc = useQueryClient();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const ids = items.filter((item) => selected.has(item.id)).map((item) => item.id);
  async function deleteSelected() {
    if (busy || !ids.length || !window.confirm(`確定永久刪除這 ${ids.length} 筆紀錄？`)) return;
    setBusy(true);
    try {
      const { count, error } = await supabase.from("transactions").delete({ count: "exact" })
        .eq("ledger_id", ctx.ledger.id).in("id", ids);
      if (error) throw new Error(error.message);
      setSelected(new Set());
      setSelecting(false);
      await Promise.all(["tx", "tx-one", "report", "ledger-total"].map((key) => qc.invalidateQueries({ queryKey: [key] })));
      toast.success(`已刪除 ${count ?? 0} 筆紀錄`);
    } catch (error) { toast.error(friendlyError(error)); }
    finally { setBusy(false); }
  }

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
          <span className="money">{formatMoney(sumCents(items.map((t) => t.original_amount)), ctx.ledger.base_currency)}</span>
        </div>
        <div className="mb-3 flex gap-2">
          <PixelButton variant="ghost" disabled={busy} onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>{selecting ? "取消選取" : "選取紀錄"}</PixelButton>
          {selecting && <PixelButton variant="danger" disabled={busy || !ids.length} onClick={deleteSelected}>刪除選取（{ids.length}/50）</PixelButton>}
        </div>
        {list.isLoading ? <p className="py-4 text-sm">讀取中…</p> : list.error ? <p className="text-destructive">讀取失敗</p> : selecting ? <ul className="divide-y">{items.map((item) => <li key={item.id}><label className="flex min-h-12 items-center gap-3 py-2"><input type="checkbox" disabled={busy || (ids.length >= 50 && !selected.has(item.id))} checked={selected.has(item.id)} onChange={(e) => { const next = new Set(selected); if (e.target.checked) next.add(item.id); else next.delete(item.id); setSelected(next); }} /><span className="min-w-0 flex-1 break-words">{item.description}<small className="block text-muted-foreground">{utcToZoned(item.occurred_at, ctx.ledger.timezone).date} {utcToZoned(item.occurred_at, ctx.ledger.timezone).time}</small></span><span className="money">{formatMoney(item.original_amount, ctx.ledger.base_currency)}</span></label></li>)}</ul> : <TxList ctx={ctx} items={items} empty="沒有符合的紀錄" />}
      </section>
    </div>
  );
}

