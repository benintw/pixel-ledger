import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecurringExpenses } from "@/components/recurring-expenses";
import type { LedgerCtx } from "@/lib/ledger-api";
const mocks = vi.hoisted(() => ({ insert: vi.fn(), update: vi.fn(), rules: [] as unknown[] }));
vi.mock("@tanstack/react-router", () => ({ useBlocker: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => {
  const chain = { eq: () => chain, select: () => chain, order: async () => ({ data: mocks.rules, error: null }), single: async () => ({ data: { id: "r" }, error: null }) };
  return { ...chain, insert: mocks.insert, update: (v: unknown) => { mocks.update(v); return chain; }, delete: () => chain };
} } }));
const ledger = { id: "ledger", name: "日常生活", type: "daily", base_currency: "TWD", timezone: "Asia/Taipei" };
const ctx: LedgerCtx = { ledger, ledgers: [ledger], email: "test@example.test", categories: [{ id: "cat", name: "帳單", created_at: "" }], methods: [{ id: "pm", name: "現金", created_at: "" }] };
beforeEach(() => { mocks.rules = []; mocks.insert.mockResolvedValue({ error: null }); vi.spyOn(window, "confirm").mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); mocks.insert.mockReset(); mocks.update.mockReset(); });
function show() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RecurringExpenses ctx={ctx} /></QueryClientProvider>); }
function fill() {
  fireEvent.click(screen.getByRole("button", { name: /新增固定支出/ }));
  fireEvent.change(screen.getByLabelText("支出名稱"), { target: { value: "音樂訂閱" } });
  fireEvent.change(screen.getByLabelText("固定金額（TWD）"), { target: { value: "10.10+2.40" } });
  fireEvent.change(screen.getByLabelText("首次記帳日"), { target: { value: "2028-01-31" } });
}
describe("recurring expense settings", () => {
  it("saves exact amounts and the current ledger with monthly defaults", async () => {
    show(); fill();
    fireEvent.click(screen.getByRole("button", { name: "建立固定支出" }));
    await waitFor(() => expect(mocks.insert).toHaveBeenCalledOnce());
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ ledger_id: "ledger", name: "音樂訂閱", amount: "12.50", currency: "TWD", category_id: "cat", payment_method_id: "pm", frequency_months: 1, start_date: "2028-01-31" }));
    await waitFor(() => expect(screen.queryByLabelText("支出名稱")).not.toBeInTheDocument());
  });
  it("does not create a schedule if confirmation is cancelled", () => {
    show(); fill(); vi.mocked(window.confirm).mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "建立固定支出" }));
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("keeps unsaved values after a network failure", async () => {
    mocks.insert.mockResolvedValue({ error: { code: "network", message: "Failed to fetch" } });
    show(); fill(); fireEvent.click(screen.getByRole("button", { name: "建立固定支出" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "建立固定支出" })).not.toBeDisabled());
    expect(screen.getByLabelText("支出名稱")).toHaveValue("音樂訂閱");
    expect(screen.getByLabelText("固定金額（TWD）")).toHaveValue("10.10+2.40");
  });
  it("pauses a schedule without deleting expense history", async () => {
    mocks.rules = [{ id: "r", name: "房租", amount: "1000.00", currency: "TWD", category_id: "cat", payment_method_id: "pm", frequency_months: 1, next_date: "2028-01-31", enabled: true, last_error: null }];
    show(); fireEvent.click(await screen.findByRole("button", { name: "暫停" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ enabled: false }));
  });
});
