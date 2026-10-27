import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Field, PixelButton } from "@/components/pixel";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "忘記密碼｜Pixel Ledger" },
      { name: "description", content: "寄送 Pixel Ledger 重設密碼連結。" },
      { property: "og:title", content: "忘記密碼｜Pixel Ledger" },
      { property: "og:description", content: "寄送 Pixel Ledger 重設密碼連結。" },
    ],
  }),
  component: Forgot,
});

function Forgot() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr("");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr("請輸入有效的 Email。");
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setMsg("若此 Email 已註冊，重設密碼信已寄出，請到信箱查看。");
  }

  return (
    <main className="checker-bg flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="pixel-box w-full max-w-sm space-y-4 p-6" noValidate>
        <h1 className="text-xl">忘記密碼</h1>
        <Field label="Email" htmlFor="email" error={err}>
          <input id="email" type="email" autoComplete="email" className="field-pixel" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {msg && <p role="status" className="text-sm">{msg}</p>}
        <PixelButton type="submit" className="w-full" disabled={busy}>
          {busy ? "寄送中…" : "寄送重設連結"}
        </PixelButton>
        <Link to="/auth" className="block text-center text-sm underline">返回登入</Link>
      </form>
    </main>
  );
}
