import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ctxQuery } from "@/lib/ledger-api";
import { utcToZoned } from "@/lib/time";
import { TxForm, type TxValues } from "@/components/tx-form";
import { PageHeader } from "@/components/pixel";

export const Route = createFileRoute("/_authenticated/add")({
  head: () => ({
    meta: [
      { title: "記一筆｜Pixel Ledger" },
      { name: "description", content: "新增一筆支出紀錄。" },
      { property: "og:title", content: "記一筆｜Pixel Ledger" },
      { property: "og:description", content: "新增一筆支出紀錄。" },
    ],
  }),
  component: AddPage,
});

function AddPage() {
  const { data: ctx } = useSuspenseQuery(ctxQuery);
  const navigate = useNavigate();
  const [txId] = useState(() => crypto.randomUUID());
  const [initial] = useState<TxValues>(() => {
    const now = utcToZoned(new Date(), ctx.ledger.timezone);
    const other = ctx.categories.find((c) => c.name === "其他") ?? ctx.categories[0];
    return {
      description: "",
      amount: "",
      date: now.date,
      time: now.time,
      categoryId: other?.id ?? "",
      paymentId: "",
      notes: "",
    };
  });
  return (
    <div className="pt-4">
      <PageHeader title="記一筆" sub={`${ctx.ledger.name}・TWD`} />
      <div className="pixel-box p-4">
        <TxForm ctx={ctx} initial={initial} txId={txId} mode="create" onDone={() => navigate({ to: "/" })} />
      </div>
    </div>
  );
}
