import { useRef, useState, type FormEvent } from "react";
import { useBlocker } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Field, PixelButton } from "@/components/pixel";
import { friendlyError, type LedgerCtx } from "@/lib/ledger-api";
import { asCurrency, centsToDecimal, formatMoney, parseAmountExpression } from "@/lib/money";
import { isValidDate, utcToZoned } from "@/lib/time";

type Recurring = {
  id: string; name: string; amount: string; currency: string;
  category_id: string; payment_method_id: string; frequency_months: number;
  start_date: string; next_date: string; enabled: boolean; last_error: string | null;
};

/** Manage schedules for the selected ledger; execution happens in database Cron. */
export function RecurringExpenses({ ctx }: { ctx: LedgerCtx }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("1");
  const today = utcToZoned(new Date(), ctx.ledger.timezone).date;
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState(ctx.categories.find((c) => c.name === "帳單")?.id ?? ctx.categories[0]?.id ?? "");
  const [payment, setPayment] = useState(ctx.methods[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const idRef = useRef<string | null>(null);
  const dirty = open && !!(name.trim() || amount.trim());
  useBlocker({
    shouldBlockFn: () => dirty && !window.confirm("固定支出尚未儲存，確定離開嗎？"),
    enableBeforeUnload: () => dirty,
  });
  const rules = useQuery({
    queryKey: ["recurring", ctx.ledger.id],
    queryFn: async (): Promise<Recurring[]> => {
      const { data, error } = await supabase.from("recurring_expenses")
        .select("id,name,amount:amount::text,currency,category_id,payment_method_id,frequency_months,start_date,next_date,enabled,last_error")
        .eq("ledger_id", ctx.ledger.id).order("created_at");
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Recurring[];
    },
    refetchInterval: 60_000,
  });

  async function change(rule: Recurring, remove: boolean) {
    if (busyRef.current) return;
    if (remove && !window.confirm(`停止並移除「${rule.name}」？已產生的記帳會保留。`)) return;
    busyRef.current = true; setBusy(true);
    try {
      const query = remove ? supabase.from("recurring_expenses").delete()
        : supabase.from("recurring_expenses").update({ enabled: !rule.enabled });
      const { data, error } = await query.eq("id", rule.id).eq("ledger_id", ctx.ledger.id).select("id").single();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("找不到固定支出。");
      await qc.invalidateQueries({ queryKey: ["recurring", ctx.ledger.id] });
      toast.success(remove ? "已停止，原有紀錄保留" : rule.enabled ? "已暫停" : "已恢復，不補記暫停期間");
    } catch (error) { toast.error(friendlyError(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    const cents = parseAmountExpression(amount, asCurrency(ctx.ledger.base_currency));
    if (!name.trim() || name.trim().length > 100) { toast.error("請輸入固定支出名稱，最多 100 字。"); return; }
    if (cents === null) { toast.error("請輸入有效的正數金額，韓元須為整數。"); return; }
    if (!isValidDate(date) || date < today) { toast.error("首次記帳日期請選今天或之後。"); return; }
    if (!category || !payment) { toast.error("請選擇分類與付款方式。"); return; }
    if (!window.confirm(`建立「${name.trim()}」：${frequency === "12" ? "每年" : "每月"} ${formatMoney(cents, ctx.ledger.base_currency)}，從 ${date} 起自動記帳？這只會記帳，不會實際扣款。`)) return;
    busyRef.current = true; setBusy(true);
    idRef.current ??= crypto.randomUUID();
    try {
      const { error } = await supabase.from("recurring_expenses").insert({
        id: idRef.current, ledger_id: ctx.ledger.id, name: name.trim(),
        amount: centsToDecimal(cents) as unknown as number, currency: ctx.ledger.base_currency,
        category_id: category, payment_method_id: payment, frequency_months: Number(frequency), start_date: date,
      });
      if (error) {
        if (error.code !== "23505") throw new Error(error.message);
        const existing = await supabase.from("recurring_expenses").select("id").eq("id", idRef.current).single();
        if (existing.error || !existing.data) throw new Error(error.message);
      }
      setOpen(false); setName(""); setAmount(""); idRef.current = null;
      await qc.invalidateQueries({ queryKey: ["recurring", ctx.ledger.id] });
      toast.success("固定支出已建立，將從指定日期自動記帳");
    } catch (error) { toast.error(friendlyError(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <section className="pixel-box space-y-4 p-4">
    <div><h2 className="text-lg">固定支出</h2>
      <p className="mt-1 text-sm text-muted-foreground">{ctx.ledger.name}・房租、訂閱費等，到期自動記帳，不會實際扣款。</p></div>
    <p className="text-xs text-muted-foreground">依帳本時區，每小時檢查一次。月底沒有指定日期時，改用該月最後一天。修改金額請先停止，再建立新設定。</p>
    {rules.isPending ? <p role="status">讀取中…</p> : rules.error ? <div role="alert"><p>固定支出讀取失敗。</p><PixelButton variant="ghost" onClick={() => rules.refetch()}>重試</PixelButton></div> :
      <ul className="divide-y divide-dashed divide-border">{rules.data?.map((rule) => <li key={rule.id} className="space-y-2 py-3">
        <div className="flex justify-between gap-3"><strong className="min-w-0 break-words">{rule.name}</strong><span className="money shrink-0">{formatMoney(rule.amount, rule.currency)}</span></div>
        <p className="text-sm text-muted-foreground">{rule.frequency_months === 12 ? "每年" : "每月"}・{ctx.categories.find((c) => c.id === rule.category_id)?.name}・{ctx.methods.find((m) => m.id === rule.payment_method_id)?.name}</p>
        <p className="text-sm">{rule.enabled ? `下次：${rule.next_date}` : "已暫停，期間不補記"}</p>
        {rule.last_error && <p role="alert" className="text-sm text-destructive">{rule.last_error}</p>}
        <div className="flex flex-wrap gap-2"><PixelButton variant="ghost" disabled={busy} onClick={() => change(rule, false)}>{rule.enabled ? "暫停" : "恢復"}</PixelButton><PixelButton variant="ghost" disabled={busy} onClick={() => change(rule, true)}>停止並移除</PixelButton></div>
      </li>)}</ul>}
    {!rules.isPending && !rules.error && !rules.data?.length && <p className="text-sm text-muted-foreground">還沒有固定支出。</p>}
    {open ? <form className="space-y-3 border-t border-dashed pt-4" onSubmit={save}>
      <Field label="支出名稱" htmlFor="recurring-name"><input id="recurring-name" className="field-pixel" maxLength={100} placeholder="例如：房租、音樂訂閱" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={`固定金額（${ctx.ledger.base_currency}）`} htmlFor="recurring-amount"><input id="recurring-amount" className="field-pixel money" inputMode={ctx.ledger.base_currency === "KRW" ? "numeric" : "decimal"} maxLength={256} value={amount} disabled={busy} onChange={(e) => setAmount(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="重複週期" htmlFor="recurring-frequency"><select id="recurring-frequency" className="field-pixel" value={frequency} disabled={busy} onChange={(e) => setFrequency(e.target.value)}><option value="1">每月</option><option value="12">每年</option></select></Field>
        <Field label="首次記帳日" htmlFor="recurring-date"><input id="recurring-date" className="field-pixel" type="date" min={today} value={date} disabled={busy} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="分類" htmlFor="recurring-category"><select id="recurring-category" className="field-pixel" value={category} disabled={busy} onChange={(e) => setCategory(e.target.value)}>{ctx.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="付款方式" htmlFor="recurring-payment"><select id="recurring-payment" className="field-pixel" value={payment} disabled={busy} onChange={(e) => setPayment(e.target.value)}>{ctx.methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      <div className="flex gap-2"><PixelButton type="submit" disabled={busy}>{busy ? "儲存中…" : "建立固定支出"}</PixelButton><PixelButton type="button" variant="ghost" disabled={busy} onClick={() => { if (dirty && !window.confirm("放棄尚未儲存的固定支出？")) return; setOpen(false); setName(""); setAmount(""); idRef.current = null; }}>取消</PixelButton></div>
    </form> : <PixelButton variant="secondary" className="w-full" onClick={() => setOpen(true)}>＋ 新增固定支出</PixelButton>}
  </section>;
}
