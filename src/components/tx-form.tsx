import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useBlocker } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Field, PixelButton } from "@/components/pixel";
import { centsToDecimal, parseAmountToCents } from "@/lib/money";
import { isValidDate, isValidTime, zonedToUtc } from "@/lib/time";
import { friendlyError, type LedgerCtx } from "@/lib/ledger-api";

export type TxValues = {
  description: string;
  amount: string;
  date: string;
  time: string;
  categoryId: string;
  paymentId: string;
  notes: string;
};

export const LAST_PAYMENT_KEY = "pixel-ledger:last-payment-method";

type Errors = Partial<Record<keyof TxValues | "form", string>>;

export function validateTx(v: TxValues): Errors {
  const e: Errors = {};
  const d = v.description.trim();
  if (!d) e.description = "請輸入說明。";
  else if (d.length > 100) e.description = "說明最多 100 字。";
  if (!v.amount.trim()) e.amount = "請輸入金額。";
  else if (!parseAmountToCents(v.amount)) e.amount = "金額必須為大於 0 的數字，最多兩位小數。";
  if (!isValidDate(v.date)) e.date = "請選擇日期。";
  if (!isValidTime(v.time)) e.time = "請選擇時間。";
  if (!v.paymentId) e.paymentId = "請選擇付款方式。";
  if (!v.categoryId) e.categoryId = "請選擇分類。";
  if (v.notes.length > 500) e.notes = "備註最多 500 字。";
  return e;
}

export function TxForm({
  ctx,
  initial,
  txId,
  mode,
  onDone,
  extraActions,
}: {
  ctx: LedgerCtx;
  initial: TxValues;
  txId: string;
  mode: "create" | "edit";
  onDone: () => void;
  extraActions?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const [v, setV] = useState<TxValues>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const initialRef = useRef(initial);
  const savedRef = useRef(false);
  const busyRef = useRef(false);
  const dirty = useMemo(() => JSON.stringify(v) !== JSON.stringify(initialRef.current), [v]);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Remember last payment method on this device (create mode only).
  useEffect(() => {
    if (mode !== "create") return;
    const last = window.localStorage.getItem(LAST_PAYMENT_KEY);
    if (last && ctx.methods.some((m) => m.id === last)) {
      setV((s) => ({ ...s, paymentId: last }));
      initialRef.current = { ...initialRef.current, paymentId: last };
    }
  }, [mode, ctx.methods]);

  useBlocker({
    shouldBlockFn: () => {
      if (savedRef.current || !dirtyRef.current) return false;
      return !window.confirm("有尚未儲存的變更，確定要離開嗎？");
    },
    enableBeforeUnload: () => !savedRef.current && dirtyRef.current,
  });

  const set = <K extends keyof TxValues>(k: K, val: TxValues[K]) => {
    setV((s) => ({ ...s, [k]: val }));
    setErrors((e) => ({ ...e, [k]: undefined, form: undefined }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busyRef.current) return; // duplicate-submit guard
    const errs = validateTx(v);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const amount = centsToDecimal(parseAmountToCents(v.amount)!);
      const row = {
        description: v.description.trim(),
        category_id: v.categoryId,
        payment_method_id: v.paymentId,
        original_amount: amount as unknown as number,
        original_currency: "TWD",
        amount_twd: amount as unknown as number,
        exchange_rate_to_twd: 1,
        occurred_at: zonedToUtc(v.date, v.time, ctx.ledger.timezone).toISOString(),
        notes: v.notes.trim() || null,
      };
      if (mode === "create") {
        // Client-generated id makes retries idempotent: a repeated insert hits the PK.
        const { error } = await supabase
          .from("transactions")
          .insert({ ...row, id: txId, ledger_id: ctx.ledger.id });
        if (error && error.code !== "23505") throw new Error(error.message);
        window.localStorage.setItem(LAST_PAYMENT_KEY, v.paymentId);
      } else {
        const { error, count } = await supabase
          .from("transactions")
          .update(row, { count: "exact" })
          .eq("id", txId);
        if (error) throw new Error(error.message);
        if (count === 0) throw new Error("找不到此筆紀錄");
      }
      savedRef.current = true;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["report"] }),
        qc.invalidateQueries({ queryKey: ["tx"] }),
        qc.invalidateQueries({ queryKey: ["tx-one", txId] }),
      ]);
      toast.success(mode === "create" ? "已記下一筆！" : "已更新");
      onDone();
    } catch (err) {
      setErrors({ form: friendlyError(err) });
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field label="說明" htmlFor="description" error={errors.description}>
        <input
          id="description"
          className="field-pixel"
          value={v.description}
          maxLength={100}
          enterKeyHint="next"
          placeholder="例如：午餐便當"
          aria-invalid={!!errors.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      <Field label="金額（TWD）" htmlFor="amount" error={errors.amount}>
        <div className="flex items-stretch">
          <span className="flex items-center border-[3px] border-r-0 border-border bg-muted px-3 font-pixel-latin text-xs">NT$</span>
          <input
            id="amount"
            className="field-pixel money text-xl"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={v.amount}
            aria-invalid={!!errors.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="日期" htmlFor="date" error={errors.date}>
          <input id="date" type="date" className="field-pixel" value={v.date} aria-invalid={!!errors.date} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <Field label="時間" htmlFor="time" error={errors.time}>
          <input id="time" type="time" className="field-pixel" value={v.time} aria-invalid={!!errors.time} onChange={(e) => set("time", e.target.value)} />
        </Field>
      </div>

      <Field label="付款方式（必填）" error={errors.paymentId}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="付款方式">
          {ctx.methods.map((m) => (
            <button type="button" key={m.id} className="chip-pixel" aria-pressed={v.paymentId === m.id} onClick={() => set("paymentId", m.id)}>
              {m.name}
            </button>
          ))}
        </div>
      </Field>

      <Field label="分類" error={errors.categoryId}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="分類">
          {ctx.categories.map((c) => (
            <button type="button" key={c.id} className="chip-pixel" aria-pressed={v.categoryId === c.id} onClick={() => set("categoryId", c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      </Field>

      <Field label="備註（選填）" htmlFor="notes" error={errors.notes}>
        <textarea id="notes" rows={3} maxLength={500} className="field-pixel" value={v.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      {errors.form && (
        <p role="alert" className="pixel-box border-destructive p-3 text-sm font-semibold text-destructive">
          {errors.form}
        </p>
      )}

      <PixelButton type="submit" className="w-full text-lg" disabled={busy}>
        {busy ? "儲存中…" : mode === "create" ? "記下這筆" : "儲存變更"}
      </PixelButton>
      {extraActions}
    </form>
  );
}
