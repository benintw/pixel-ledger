import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { Home, List, BarChart3, Settings, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ctxQuery } from "@/lib/ledger-api";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    return { user: data.user };
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(ctxQuery),
  pendingComponent: () => (
    <div className="flex min-h-screen items-center justify-center font-pixel">讀取中…</div>
  ),
  component: Layout,
});

const items = [
  { to: "/", label: "今日", icon: Home },
  { to: "/history", label: "紀錄", icon: List },
  { to: "/reports", label: "報表", icon: BarChart3 },
  { to: "/settings", label: "設定", icon: Settings },
] as const;

function Layout() {
  return (
    <div className="checker-bg min-h-screen">
      <main className="safe-top mx-auto max-w-lg px-4 pb-32">
        <Outlet />
      </main>
      <nav
        aria-label="主選單"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-border bg-card"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5 items-end">
          {items.slice(0, 2).map((it) => <NavItem key={it.to} {...it} />)}
          <div className="flex justify-center">
            <Link
              to="/add"
              aria-label="記一筆"
              className="btn-pixel btn-secondary -mt-6 h-16 w-16 flex-col gap-0 p-0 text-xs"
            >
              <Plus className="h-7 w-7" strokeWidth={3} />
              記一筆
            </Link>
          </div>
          {items.slice(2).map((it) => <NavItem key={it.to} {...it} />)}
        </div>
      </nav>
    </div>
  );
}

function NavItem({ to, label, icon: Icon }: (typeof items)[number]) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className="flex min-h-[60px] flex-col items-center justify-center gap-1 font-pixel text-xs text-muted-foreground data-[status=active]:text-foreground data-[status=active]:underline data-[status=active]:decoration-2 data-[status=active]:underline-offset-4"
    >
      <Icon className="h-6 w-6" aria-hidden />
      {label}
    </Link>
  );
}
