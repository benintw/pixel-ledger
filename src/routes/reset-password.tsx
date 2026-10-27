import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Field, PixelButton } from "@/components/pixel";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "重設密碼｜Pixel Ledger" },
      { name: "description", content: "設定新的 Pixel Ledger 密碼。" },
      { property: "og:title", content: "重設密碼｜Pixel Ledger" },
      { property: "og:description", content: "設定新的 Pixel Ledger 密碼。" },
    ],
  }),
  component: Reset,
});

function Reset() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const isRecovery = window.location.hash.includes("type=recovery");
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && isRecovery)) setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr("");
    if (pw.length < 8) return setErr("密碼至少 8 個字元。");
    if (pw !== pw2) return setErr("兩次輸入的密碼不一致。");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(error.message);
    navigate({ to: "/", replace: true });
  }

  return (
    <main className="checker-bg flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="pixel-box w-full max-w-sm space-y-4 p-6" noValidate>
        <h1 className="text-xl">重設密碼</h1>
        {!ready ? (
          <p className="text-sm">正在驗證連結… 若一直停在這裡，請重新從信件中點擊重設連結。</p>
        ) : (
          <>
            <Field label="新密碼" htmlFor="pw">
              <input id="pw" type="password" autoComplete="new-password" className="field-pixel" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            <Field label="再次輸入" htmlFor="pw2" error={err}>
              <input id="pw2" type="password" autoComplete="new-password" className="field-pixel" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </Field>
            <PixelButton type="submit" className="w-full" disabled={busy}>
              {busy ? "儲存中…" : "儲存新密碼"}
            </PixelButton>
          </>
        )}
      </form>
    </main>
  );
}
