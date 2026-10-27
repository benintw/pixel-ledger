// Single guarded service-worker registrar. Never registers in dev, iframes or Lovable previews.
const PREVIEW_LABEL = /^(?:id-preview|preview)(?:-[a-z0-9]+)?--.+$/;

function isRefusedContext(): boolean {
  if (!import.meta.env.PROD) return true;
  if (window.self !== window.top) return true;
  const host = window.location.hostname.toLowerCase();
  const label = host.split(".")[0];
  if (/\.(lovable\.app|gpt-eng\.com|gptengineer\.run)$/.test(host)) {
    if (PREVIEW_LABEL.test(label)) return true;
    if (/^project--.+-dev$/.test(label)) return true;
  }
  if (host === "lovableproject.com" || host.endsWith(".lovableproject.com")) return true;
  if (host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com")) return true;
  if (host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev")) return true;
  if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

export async function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    if (isRefusedContext()) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs.filter((r) => r.active?.scriptURL.endsWith("/sw.js")).map((r) => r.unregister()),
      );
      return;
    }
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (e) {
    console.warn("service worker registration failed", e);
  }
}
