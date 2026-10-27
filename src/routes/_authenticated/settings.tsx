import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ctxQuery, fetchAllTx, friendlyError, type NamedRow } from "@/lib/ledger-api";
import { TIMEZONES, utcToZoned } from "@/lib/time";
import { buildCsv } from "@/lib/csv";
import { PageHeader, PixelButton } from "@/components/pixel";
import { LAST_PAYMENT_KEY } from "@/components/tx-form";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "設定｜Pixel Ledger" },
      { name: "description", content: "帳號、時區、分類、付款方式與 CSV 匯出。" },
      { property: "og:title", content: "設定｜Pixel Ledger" },
      { property: "og:description", content: "帳號、時區、分類、付款方式與 CSV 匯出。" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data: ctx } = useSuspenseQuery(ctxQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tzBusy, setTzBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const tzOptions = TIMEZONES.includes(ctx.ledger.timezone) ? TIMEZONES : [ctx.ledger.timezone, ...TIMEZONES];

  async function changeTz(tz: string) {
    if (tz === ctx.ledger.timezone) return;
    if (!window.confirm(`將「${ctx.ledger.name}」時區改為 ${tz}？所有每日／每月統計會依新時區重新計算。`)) return;
    setTzBusy(true);
    const { error } = await supabase.from("ledgers").update({ timezone: tz }).eq("id", ctx.ledger.id);
    setTzBusy(false);
    if (error) return toast.error(friendlyError(new Error(error.message)));
    await qc.invalidateQueries();
    toast.success("時區已更新");
  }

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const rows = await fetchAllTx(ctx.ledger.id);
      const cat = new Map(ctx.categories.map((c) => [c.id, c.name]));
      const pm = new Map(ctx.methods.map((m) => [m.id, m.name]));
      const tz = ctx.ledger.timezone;
      const csv = buildCsv(
        ["日期", "時間", "說明", "分類", "付款方式", "原始金額", "原始幣別", "台幣金額", "匯率", "備註", "時區", "建立時間(UTC)", "ID"],
        rows.map((t) => {
          const l = utcToZoned(t.occurred_at, tz);
          return [
            { text: l.date },
            { text: l.time },
            { text: t.description },
            { text: cat.get(t.category_id) ?? "" },
            { text: pm.get(t.payment_method_id) ?? "" },
            { num: t.original_amount },
            { text: t.original_currency },
            { num: t.amount_twd },
            { num: t.exchange_rate_to_twd },
            { text: t.notes ?? "" },
            { text: tz },
            { text: t.created_at },
            { text: t.id },
          ];
        }),
      );
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pixel-ledger-${utcToZoned(new Date(), tz).date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success(`已匯出 ${rows.length} 筆`);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setExporting(false);
    }
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    window.localStorage.removeItem(LAST_PAYMENT_KEY);
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="space-y-4 pt-4">
      <PageHeader title="設定" />
      <section className="pixel-box space-y-2 p-4">
        <h2 className="text-lg">帳號</h2>
        <p className="break-all text-sm">{ctx.email}</p>
        <PixelButton variant="ghost" className="w-full" onClick={signOut}>登出</PixelButton>
      </section>

      <section className="pixel-box space-y-2 p-4">
        <h2 className="text-lg">帳本時區</h2>
        <p className="text-sm text-muted-foreground">{ctx.ledger.name}・{ctx.ledger.base_currency}</p>
        <select aria-label="時區" className="field-pixel" disabled={tzBusy} value={ctx.ledger.timezone} onChange={(e) => changeTz(e.target.value)}>
          {tzOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </section>

      <NameManager title="分類" table="categories" rows={ctx.categories} />
      <NameManager title="付款方式" table="payment_methods" rows={ctx.methods} />

      <section className="pixel-box space-y-2 p-4">
        <h2 className="text-lg">匯出資料</h2>
        <p className="text-sm text-muted-foreground">CSV（UTF-8，可用 Excel 開啟）</p>
        <PixelButton variant="secondary" className="w-full" disabled={exporting} onClick={exportCsv}>
          {exporting ? "匯出中…" : "下載 CSV"}
        </PixelButton>
      </section>
      <p className="pb-4 text-center text-xs text-muted-foreground">
        需要網路連線才能記帳；目前不支援離線新增或同步。
      </p>
    </div>
  );
}

function NameManager({ title, table, rows }: { title: string; table: "categories" | "payment_methods"; rows: NamedRow[] }) {
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    if (busy) return false;
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) {
      toast.error(friendlyError(new Error(error.message)));
      return false;
    }
    await qc.invalidateQueries({ queryKey: ["ctx"] });
    await qc.invalidateQueries({ queryKey: ["report"] });
    toast.success(ok);
    return true;
  }

  const valid = (n: string) => n.trim().length >= 1 && n.trim().length <= 20;

  return (
    <section className="pixel-box space-y-3 p-4">
      <h2 className="text-lg">{title}</h2>
      <ul className="divide-y-2 divide-dashed divide-border">
        {rows.map((r) => (
          <li key={r.id} className="flex min-h-[52px] items-center gap-2 py-1">
            {editing === r.id ? (
              <>
                <input className="field-pixel flex-1" maxLength={20} value={editName} onChange={(e) => setEditName(e.target.value)} aria-label={`重新命名${r.name}`} />
                <button className="btn-pixel btn-primary w-12 p-0" aria-label="儲存" disabled={busy || !valid(editName)}
                  onClick={async () => { if (await run(() => supabase.from(table).update({ name: editName.trim() }).eq("id", r.id), "已更新")) setEditing(null); }}>
                  <Check />
                </button>
                <button className="btn-pixel btn-ghost w-12 p-0" aria-label="取消" onClick={() => setEditing(null)}><X /></button>
              </>
            ) : (
              <>
                <span className="flex-1">{r.name}</span>
                <button className="btn-pixel btn-ghost w-12 p-0" aria-label={`編輯${r.name}`} onClick={() => { setEditing(r.id); setEditName(r.name); }}><Pencil className="h-4 w-4" /></button>
                <button className="btn-pixel btn-ghost w-12 p-0" aria-label={`刪除${r.name}`} disabled={busy || rows.length <= 1}
                  onClick={() => { if (window.confirm(`刪除「${r.name}」？若已有紀錄使用將無法刪除。`)) run(() => supabase.from(table).delete().eq("id", r.id), "已刪除"); }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (valid(newName) && (await run(() => supabase.from(table).insert({ name: newName.trim() }), "已新增"))) setNewName(""); }}>
        <input className="field-pixel flex-1" maxLength={20} placeholder={`新增${title}`} value={newName} onChange={(e) => setNewName(e.target.value)} aria-label={`新增${title}`} />
        <PixelButton type="submit" disabled={busy || !valid(newName)}>新增</PixelButton>
      </form>
    </section>
  );
}
