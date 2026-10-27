import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { zonedToUtc, addDays } from "@/lib/time";

export type Ledger = { id: string; name: string; type: string; base_currency: string; timezone: string };
export type NamedRow = { id: string; name: string; created_at: string };
export type LedgerCtx = { ledger: Ledger; categories: NamedRow[]; methods: NamedRow[]; email: string };

export type Tx = {
  id: string;
  description: string;
  category_id: string;
  payment_method_id: string;
  amount_twd: string;
  original_amount: string;
  original_currency: string;
  exchange_rate_to_twd: string;
  occurred_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

// Cast numerics to text so money never passes through JS floats.
export const TX_SELECT =
  "id, description, category_id, payment_method_id, amount_twd:amount_twd::text, original_amount:original_amount::text, original_currency, exchange_rate_to_twd:exchange_rate_to_twd::text, occurred_at, notes, created_at, updated_at";

export type Breakdown = { id: string; name: string; total: string; count: number };
export type Report = {
  total: string;
  count: number;
  by_category: Breakdown[];
  by_payment: Breakdown[];
  by_day: { date: string; total: string; count: number }[];
};

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message);
}

export const ctxQuery = queryOptions({
  queryKey: ["ctx"],
  queryFn: async (): Promise<LedgerCtx> => {
    const { data: u } = await supabase.auth.getUser();
    const r0 = await supabase.rpc("ensure_my_defaults");
    fail(r0.error);
    const [l, c, m] = await Promise.all([
      supabase.from("ledgers").select("id,name,type,base_currency,timezone").eq("is_default", true).single(),
      supabase.from("categories").select("id,name,created_at").order("created_at").order("name"),
      supabase.from("payment_methods").select("id,name,created_at").order("created_at").order("name"),
    ]);
    fail(l.error);
    fail(c.error);
    fail(m.error);
    return { ledger: l.data as Ledger, categories: c.data ?? [], methods: m.data ?? [], email: u.user?.email ?? "" };
  },
  staleTime: 60_000,
});

export const reportQuery = (ledgerId: string, from: string, to: string) =>
  queryOptions({
    queryKey: ["report", ledgerId, from, to],
    queryFn: async (): Promise<Report> => {
      const { data, error } = await supabase.rpc("ledger_report", { p_ledger: ledgerId, p_from: from, p_to: to });
      fail(error);
      return data as unknown as Report;
    },
  });

export type TxFilters = {
  q?: string;
  from?: string;
  to?: string;
  categoryId?: string;
  paymentId?: string;
  limit?: number;
};

export function sanitizeSearch(q: string): string {
  return q.replace(/[%_*,()"\\.:]/g, " ").trim().slice(0, 50);
}

export const txListQuery = (ledgerId: string, tz: string, f: TxFilters) =>
  queryOptions({
    queryKey: ["tx", ledgerId, tz, f],
    queryFn: async (): Promise<Tx[]> => {
      let q = supabase
        .from("transactions")
        .select(TX_SELECT)
        .eq("ledger_id", ledgerId)
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(f.limit ?? 500);
      if (f.from) q = q.gte("occurred_at", zonedToUtc(f.from, "00:00", tz).toISOString());
      if (f.to) q = q.lt("occurred_at", zonedToUtc(addDays(f.to, 1), "00:00", tz).toISOString());
      if (f.categoryId) q = q.eq("category_id", f.categoryId);
      if (f.paymentId) q = q.eq("payment_method_id", f.paymentId);
      const s = f.q ? sanitizeSearch(f.q) : "";
      if (s) q = q.or(`description.ilike.*${s}*,notes.ilike.*${s}*`);
      const { data, error } = await q;
      fail(error);
      return (data ?? []) as unknown as Tx[];
    },
  });

export const txQuery = (id: string) =>
  queryOptions({
    queryKey: ["tx-one", id],
    queryFn: async (): Promise<Tx | null> => {
      const { data, error } = await supabase.from("transactions").select(TX_SELECT).eq("id", id).maybeSingle();
      fail(error);
      return data as unknown as Tx | null;
    },
  });

/** Fetch every transaction (paged) for CSV export. */
export async function fetchAllTx(ledgerId: string): Promise<Tx[]> {
  const out: Tx[] = [];
  const page = 1000;
  for (let i = 0; ; i += page) {
    const { data, error } = await supabase
      .from("transactions")
      .select(TX_SELECT)
      .eq("ledger_id", ledgerId)
      .order("occurred_at", { ascending: true })
      .order("id")
      .range(i, i + page - 1);
    fail(error);
    out.push(...((data ?? []) as unknown as Tx[]));
    if (!data || data.length < page) break;
  }
  return out;
}

export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/foreign key|violates.*fkey|_owner_fk/i.test(msg)) return "此項目仍有紀錄使用中，無法刪除。";
  if (/duplicate key|unique/i.test(msg)) return "名稱已存在。";
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return "網路連線失敗，請確認連線後再試一次。";
  if (/check constraint/i.test(msg)) return "資料格式不正確。";
  return "發生錯誤：" + msg;
}
