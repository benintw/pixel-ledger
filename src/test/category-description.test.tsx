import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LedgerCtx, Tx } from "@/lib/ledger-api";
import { TxList } from "@/components/tx-list";
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
afterEach(cleanup);
const ledger = { id: "l", name: "日常生活", type: "daily", base_currency: "TWD", timezone: "Asia/Taipei" };
const ctx: LedgerCtx = { ledger, ledgers: [ledger], categories: [{ id: "c", name: "早餐", created_at: "" }], methods: [{ id: "p", name: "現金", created_at: "" }], email: "test@example.test" };
const tx: Tx = { id: "t", ledger_id: "l", description: "", category_id: "c", payment_method_id: "p", original_amount: "50.00", original_currency: "TWD", amount_twd: "50.00", exchange_rate_to_twd: "1", occurred_at: "2026-11-19T00:00:00Z", notes: null, created_at: "", updated_at: "" };
describe("optional supplementary description", () => {
  it("shows the category as the expense title when description is blank", () => {
    render(<TxList ctx={ctx} items={[tx]} />);
    expect(screen.getByText("早餐", { selector: "p.font-semibold, p.truncate" })).toBeInTheDocument();
    expect(screen.getByText("NT$50")).toBeInTheDocument();
  });
  it("keeps an existing supplementary description", () => {
    render(<TxList ctx={ctx} items={[{ ...tx, description: "蛋餅＋豆漿" }]} />);
    expect(screen.getByText("蛋餅＋豆漿")).toBeInTheDocument();
  });
});
