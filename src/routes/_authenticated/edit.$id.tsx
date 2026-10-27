import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ctxQuery, friendlyError, txQuery } from "@/lib/ledger-api";
import { utcToZoned } from "@/lib/time";
import { centsToInput, decimalToCents } from "@/lib/money";
import { TxForm } from "@/components/tx-form";
import { PageHeader, PixelButton } from "@/components/pixel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/edit/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(txQuery(params.id)),
  head: () => ({
    meta: [
      { title: "編輯紀錄｜Pixel Ledger" },
      { name: "description", content: "編輯或刪除一筆支出紀錄。" },
      { property: "og:title", content: "編輯紀錄｜Pixel Ledger" },
      { property: "og:description", content: "編輯或刪除一筆支出紀錄。" },
    ],
  }),
  component: EditPage,
});

function EditPage() {
  const { id } = Route.useParams();
  const { data: ctx } = useSuspenseQuery(ctxQuery);
  const { data: tx } = useSuspenseQuery(txQuery(id));
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!tx) {
    return (
      <div className="pt-8 text-center">
        <p className="font-pixel">找不到這筆紀錄</p>
        <Link to="/history" className="btn-pixel btn-ghost mt-4">回到紀錄</Link>
      </div>
    );
  }
  const local = utcToZoned(tx.occurred_at, ctx.ledger.timezone);
  const initial = {
    description: tx.description,
    amount: centsToInput(decimalToCents(tx.amount_twd)),
    date: local.date,
    time: local.time,
    categoryId: tx.category_id,
    paymentId: tx.payment_method_id,
    notes: tx.notes ?? "",
  };

  async function doDelete() {
    if (deleting) return;
    setDeleting(true);
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) {
      setDeleting(false);
      toast.error(friendlyError(new Error(error.message)));
      return;
    }
    qc.removeQueries({ queryKey: ["tx-one", id] });
    await Promise.all([qc.invalidateQueries({ queryKey: ["report"] }), qc.invalidateQueries({ queryKey: ["tx"] })]);
    toast.success("已刪除");
    navigate({ to: "/history", replace: true });
  }

  return (
    <div className="pt-4">
      <PageHeader title="編輯紀錄" />
      <div className="pixel-box p-4">
        <TxForm
          key={tx.updated_at}
          ctx={ctx}
          initial={initial}
          txId={id}
          mode="edit"
          onDone={() => navigate({ to: "/history" })}
          extraActions={
            <PixelButton type="button" variant="danger" className="w-full" onClick={() => setOpen(true)}>
              刪除這筆
            </PixelButton>
          }
        />
      </div>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="pixel-box rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-pixel">確定刪除？</AlertDialogTitle>
            <AlertDialogDescription>「{tx.description}」將永久刪除，無法復原。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="btn-pixel btn-ghost rounded-none">取消</AlertDialogCancel>
            <AlertDialogAction className="btn-pixel btn-danger rounded-none" disabled={deleting} onClick={(e) => { e.preventDefault(); doDelete(); }}>
              {deleting ? "刪除中…" : "刪除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
