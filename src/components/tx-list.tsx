import { Link } from "@tanstack/react-router";
import { formatMoney } from "@/lib/money";
import { utcToZoned } from "@/lib/time";
import type { LedgerCtx, Tx } from "@/lib/ledger-api";
import { Empty } from "@/components/pixel";

export function TxList({ ctx, items, showDate = true, empty = "還沒有紀錄" }: { ctx: LedgerCtx; items: Tx[]; showDate?: boolean; empty?: string }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  const cat = new Map(ctx.categories.map((c) => [c.id, c.name]));
  const pm = new Map(ctx.methods.map((m) => [m.id, m.name]));
  return (
    <ul className="divide-y-2 divide-dashed divide-border">
      {items.map((t) => {
        const local = utcToZoned(t.occurred_at, ctx.ledger.timezone);
        return (
          <li key={t.id}>
            <Link to="/edit/$id" params={{ id: t.id }} className="flex min-h-[56px] items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-semibold">{t.description}</p>
                <p className="text-xs text-muted-foreground">
                  {showDate ? `${local.date.slice(5).replace("-", "/")} ` : ""}
                  {local.time}・{cat.get(t.category_id) ?? "—"}・{pm.get(t.payment_method_id) ?? "—"}
                </p>
              </div>
              <span className="shrink-0 text-right"><span className="money block">{formatMoney(t.original_amount, t.original_currency)}</span>{t.original_currency === "KRW" && t.amount_twd !== null && <span className="text-xs text-muted-foreground">約 {formatMoney(t.amount_twd, "TWD")}</span>}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}


