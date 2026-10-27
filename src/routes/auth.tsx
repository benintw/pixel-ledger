import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Field, PixelButton } from "@/components/pixel";
import logo from "/icons/icon-192.png?url";

type Search = { redirect?: string };

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    redirect: typeof s.redirect === "string" ? s.redirect : undefined,
  }),
  head: () => ({
    meta: [
      { title: "登入｜Pixel Ledger" },
      { name: "description", content: "登入或註冊 Pixel Ledger 像素記帳。" },
      { property: "og:title", content: "登入｜Pixel Ledger" },
      { property: "og:description", content: "登入或註冊 Pixel Ledger 像素記帳。" },
    ],
  }),
  component: AuthPage,
});

function safePath(p?: string): string {
  if (!p) return "/";
  try {
    const u = new URL(p, window.location.origin);
    if (u.origin !== window.location.origin || u.pathname.startsWith("/auth")) return "/";
    return u.pathname + u.search;
  } catch {
    return "/";
  }
}

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const go = () => navigate({ to: safePath(redirect), replace: true });
    supabase.auth.getSession().then(({ data }) => data.session && go());
    const { data } = supabase.auth.onAuthStateChange((_e, session) => session && go());
    return () => data.subscription.unsubscribe();
  }, [navigate, redirect]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("請輸入有效的 Email。");
    if (password.length < 8) return setError("密碼至少 8 個字元。");
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(
            /confirm/i.test(error.message)
              ? "此帳號尚未完成 Email 驗證，請先點擊信件中的連結。"
              : "Email 或密碼錯誤。",
          );
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth` },
        });
        if (error) setError(error.message);
        else if (!data.session) setSent(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth` },
    });
    setError(error ? error.message : "已重新寄出驗證信。");
  }

  return (
    <main className="checker-bg safe-top flex min-h-screen items-center justify-center px-4 py-10">
      <div className="pixel-box w-full max-w-sm p-6">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src={logo} alt="" width={72} height={72} className="border-[3px] border-border" />
          <h1 className="text-2xl">Pixel Ledger</h1>
          <p className="text-sm text-muted-foreground">像素記帳・你的每日小帳本</p>
        </div>

        {sent ? (
          <div className="space-y-4 text-center" role="status">
            <p className="font-pixel">請到信箱收信</p>
            <p className="text-sm">
              驗證信已寄到 <b>{email}</b>，點擊信中連結即可完成註冊並登入。
            </p>
            <PixelButton variant="ghost" className="w-full" onClick={resend}>
              重新寄送驗證信
            </PixelButton>
            <PixelButton variant="secondary" className="w-full" onClick={() => { setSent(false); setMode("signin"); }}>
              返回登入
            </PixelButton>
            {error && <p className="text-sm">{error}</p>}
          </div>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-2" role="tablist">
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  aria-pressed={mode === m}
                  className="chip-pixel font-pixel"
                  onClick={() => { setMode(m); setError(""); }}
                >
                  {m === "signin" ? "登入" : "註冊"}
                </button>
              ))}
            </div>
            <form onSubmit={submit} className="space-y-4" noValidate>
              <Field label="Email" htmlFor="email">
                <input id="email" type="email" autoComplete="email" inputMode="email" className="field-pixel" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="密碼" htmlFor="password" hint={mode === "signup" ? "至少 8 個字元" : undefined}>
                <input id="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} className="field-pixel" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              {error && <p role="alert" className="text-sm font-semibold text-destructive">{error}</p>}
              <PixelButton type="submit" className="w-full" disabled={busy}>
                {busy ? "處理中…" : mode === "signin" ? "登入" : "建立帳號"}
              </PixelButton>
              {mode === "signin" && (
                <div className="flex justify-between text-sm">
                  <Link to="/forgot-password" className="underline">忘記密碼？</Link>
                  {error.includes("驗證") && <button type="button" className="underline" onClick={resend}>重寄驗證信</button>}
                </div>
              )}
            </form>
          </>
        )}
      </div>
    </main>
  );
}
