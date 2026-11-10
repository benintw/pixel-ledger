import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ACTIVE_LEDGER_KEY, ctxQuery, fetchAllTx, friendlyError, type NamedRow } from "@/lib/ledger-api";
import { TIMEZONES, utcToZoned } from "@/lib/time";
import { buildCsv } from "@/lib/csv";
import { isValidKrwRate } from "@/lib/money";
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
  const [tripName, setTripName] = useState("韓國旅遊");
  const [newRate, setNewRate] = useState("");
  const [rateBusy, setRateBusy] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const tzOptions = TIMEZONES.includes(ctx.ledger.timezone) ? TIMEZONES : [ctx.ledger.timezone, ...TIMEZONES];

  const [deletingLedger, setDeletingLedger] = useState(false);

  async function deleteLedger() {
    if (deletingLedger) return;
    const { id, name } = ctx.ledger;
    if (!window.confirm(`確定刪除空帳本「${name}」？這個操作無法復原。`)) return;
    setDeletingLedger(true);
    try {
      const { data, error } = await supabase.from("ledgers").delete().eq("id", id)
        .eq("is_default", false).select("id").maybeSingle();
      if (error?.code === "23503") { toast.error("帳本已有記帳紀錄，不能刪除。"); return; }
      if (error) throw new Error(error.message);
      if (!data) { toast.error("找不到帳本，或此帳本不能刪除。"); return; }
      if (window.localStorage.getItem(ACTIVE_LEDGER_KEY) === id) window.localStorage.removeItem(ACTIVE_LEDGER_KEY);
      await qc.invalidateQueries({ queryKey: ["ctx"] });
      toast.success("空帳本已刪除");
    } catch (error) { toast.error(friendlyError(error)); }
    finally { setDeletingLedger(false); }
  }

  async function changeTz(tz: string) {
    if (tz === ctx.ledger.timezone) return;
    if (!window.confirm(`將「${ctx.ledger.name}」時區改為 ${tz}？所有每日／每月統計會依新時區重新計算。`)) return;
    setTzBusy(true);
    const { error } = await supabase.from("ledgers").update({ timezone: tz }).eq("id", ctx.ledger.id);
    setTzBusy(false);
    if (error) { toast.error(friendlyError(new Error(error.message))); return; }
    await qc.invalidateQueries();
    toast.success("時區已更新");
  }

  async function createKoreaLedger() {
    const name = tripName.trim();
    const rate = newRate.trim();
    if (!name || name.length > 50 || !isValidKrwRate(rate)) { toast.error("請輸入帳本名稱和有效匯率，最多 10 位小數。"); return; }
    if (ctx.ledgers.some((ledger) => ledger.name === name)) { toast.error("帳本名稱已存在。"); return; }
    if (rateBusy) return;
    setRateBusy(true);
    try {
      const { data, error } = await supabase.from("ledgers").insert({ name, type: "travel", base_currency: "KRW", timezone: "Asia/Seoul", default_exchange_rate_to_twd: rate as unknown as number }).select("id").single();
      if (error) throw new Error(error.message);
      window.localStorage.setItem(ACTIVE_LEDGER_KEY, data.id);
      await qc.invalidateQueries({ queryKey: ["ctx"] });
      setNewRate("");
      toast.success("韓國旅遊帳本已建立並切換");
    } catch (error) { toast.error(friendlyError(error)); }
    finally { setRateBusy(false); }
  }

  async function updateRate() {
    const rate = rateInput.trim();
    if (!isValidKrwRate(rate)) { toast.error("請輸入大於 0 且最多 10 位小數的匯率。"); return; }
    if (rateBusy) return;
    setRateBusy(true);
    try {
      const { error } = await supabase.from("ledgers").update({ default_exchange_rate_to_twd: rate as unknown as number }).eq("id", ctx.ledger.id);
      if (error) throw new Error(error.message);
      await qc.invalidateQueries({ queryKey: ["ctx"] });
      setRateInput("");
      toast.success("匯率已更新，既有紀錄不變");
    } catch (error) { toast.error(friendlyError(error)); }
    finally { setRateBusy(false); }
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
            t.amount_twd === null ? { text: "" } : { num: t.amount_twd },
            t.exchange_rate_to_twd === null ? { text: "" } : { num: t.exchange_rate_to_twd },
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
    window.localStorage.removeItem(ACTIVE_LEDGER_KEY);
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
        <h2 className="text-lg">目前帳本</h2>
        <select aria-label="切換帳本" className="field-pixel" value={ctx.ledger.id}
          onChange={async (e) => {
            window.localStorage.setItem(ACTIVE_LEDGER_KEY, e.target.value);
            await qc.invalidateQueries({ queryKey: ["ctx"] });
          }}>
          {ctx.ledgers.map((ledger) => <option key={ledger.id} value={ledger.id}>{ledger.name}（{ledger.base_currency}）</option>)}
        </select>
        <p className="text-sm text-muted-foreground">各帳本分開統計；歐元不換算台幣，韓元使用手動匯率。</p>
        {"is_default" in ctx.ledger && ctx.ledger.is_default === false && <PixelButton variant="danger" className="w-full" disabled={deletingLedger} onClick={deleteLedger}>{deletingLedger ? "刪除中…" : "刪除目前空帳本"}</PixelButton>}
      </section>

      {ctx.ledger.base_currency === "KRW" && <section className="pixel-box space-y-2 p-4">
        <h2 className="text-lg">韓元匯率</h2>
        <p className="text-sm">目前：1 KRW = {ctx.ledger.default_exchange_rate_to_twd ?? "未設定"} TWD</p>
        <p className="text-sm text-muted-foreground">修改只影響新紀錄。既有紀錄保留原匯率；台幣金額為估算。</p>
        <input aria-label="新匯率：1 韓元等於多少台幣" className="field-pixel" type="text" inputMode="decimal" placeholder="輸入 1 韓元等於多少台幣" value={rateInput} onChange={(e) => setRateInput(e.target.value)} />
        <PixelButton className="w-full" disabled={rateBusy} onClick={updateRate}>更新匯率</PixelButton>
      </section>}
      <section className="pixel-box space-y-2 p-4">
        <h2 className="text-lg">建立韓國旅遊帳本</h2>
        <input aria-label="旅遊帳本名稱" className="field-pixel" maxLength={50} value={tripName} onChange={(e) => setTripName(e.target.value)} />
        <label htmlFor="new-trip-rate" className="block text-sm">手動匯率：1 韓元（KRW）等於多少台幣（TWD）？</label>
        <input id="new-trip-rate" className="field-pixel" type="text" inputMode="decimal" placeholder="例如 0.024（僅示意）" value={newRate} onChange={(e) => setNewRate(e.target.value)} />
        <p className="text-sm text-muted-foreground">例如輸入 0.024，₩10,000 約 NT$240。請依你的實際匯率填寫。</p>
        <PixelButton className="w-full" disabled={rateBusy} onClick={createKoreaLedger}>建立並切換</PixelButton>
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
        <p className="text-sm text-muted-foreground">目前帳本 CSV（UTF-8，可用 Excel 開啟）；未換算的台幣金額與匯率留空。</p>
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


