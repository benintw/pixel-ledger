import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LedgerCtx } from "@/lib/ledger-api";
import { TxForm, type TxValues } from "@/components/tx-form";

const mocks = vi.hoisted(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ insert: mocks.insert }) } }));
vi.mock("@tanstack/react-router", () => ({ useBlocker: vi.fn() }));

afterEach(() => { cleanup(); mocks.insert.mockClear(); window.localStorage.clear(); });

function showForm(currency: string, date = "2026-08-18", time = "12:00") {
  const ledger = { id: "ledger", name: "帳本", type: "daily", base_currency: currency, timezone: "Europe/Berlin", default_exchange_rate_to_twd: currency === "KRW" ? "0.024" : null };
  const ctx: LedgerCtx = { ledger, ledgers: [ledger], email: "test@example.test", categories: [{ id: "cat", name: "餐飲", created_at: "" }], methods: [{ id: "pm", name: "現金", created_at: "" }] };
  const initial: TxValues = { description: "午餐", amount: "18.95", date, time, categoryId: "cat", paymentId: "pm", notes: "" };
  const done = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><TxForm ctx={ctx} initial={initial} mode="create" txId="transaction" onDone={done} /></QueryClientProvider>);
  return done;
}

describe("currency-aware expense writes", () => {
  it("writes exact EUR original amounts without inventing TWD conversion", async () => {
    const done = showForm("EUR");
    expect(screen.getByText("金額（EUR）")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "記下這筆" }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ original_amount: "18.95", original_currency: "EUR", amount_twd: null, exchange_rate_to_twd: null, occurred_at: "2026-08-18T10:00:00.000Z" }));
  });
  it("keeps TWD writes identical to the existing contract", async () => {
    const done = showForm("TWD");
    fireEvent.click(screen.getByRole("button", { name: "記下這筆" }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ original_amount: "18.95", original_currency: "TWD", amount_twd: "18.95", exchange_rate_to_twd: 1 }));
  });
  it("sends KRW as an exact integer and lets the database apply its rate snapshot", async () => {
    const done = showForm("KRW");
    fireEvent.change(screen.getByLabelText("金額（KRW）"), { target: { value: "10000" } });
    fireEvent.click(screen.getByRole("button", { name: "記下這筆" }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ original_amount: "10000.00", original_currency: "KRW", amount_twd: null, exchange_rate_to_twd: null }));
  });
  it("rejects fractional KRW instead of rounding the expense", async () => {
    showForm("KRW");
    fireEvent.click(screen.getByRole("button", { name: "記下這筆" }));
    expect(await screen.findByText("韓元金額請輸入整數。")).toBeInTheDocument();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("does not save a nonexistent Berlin daylight-saving time", async () => {
    showForm("EUR", "2026-03-29", "02:30");
    fireEvent.click(screen.getByRole("button", { name: "記下這筆" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("不存在"));
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
