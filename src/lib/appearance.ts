/** Device-local, light-only appearance preferences. No financial data is stored here. */
export const THEME_KEY = "pixel-ledger:appearance";
export const THEMES = [
  { id: "paper", name: "紙本手帳", description: "橫線紙、手帳裝訂與淡紫便條", color: "#eee7d8" },
  { id: "muji", name: "無印良品風", description: "米白留白、細線與酒紅重點", color: "#f3efe7" },
  { id: "shinobi", name: "火影忍者風", description: "淺色卷軸、橘色與曉組織的鼬", color: "#f1dfbc" },
] as const;
export type Theme = (typeof THEMES)[number]["id"];
export const DEFAULT_THEME: Theme = "paper";

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((item) => item.id === value);
}

/** Invalid, missing or blocked storage falls back to the paper journal. */
export function readTheme(): Theme {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return isTheme(value) ? value : DEFAULT_THEME;
  } catch { return DEFAULT_THEME; }
}

/** Apply only allowlisted themes, including Safari's browser chrome color. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset["theme"] = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = THEMES.find((item) => item.id === theme)!.color;
}

// Static allowlisted script, run in the head before CSS to avoid a wrong-theme flash.
// Never interpolate storage values into HTML or CSS.
export const THEME_INIT_SCRIPT = `(()=>{let t=${JSON.stringify(DEFAULT_THEME)};try{const v=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(${JSON.stringify(THEMES.map((t) => t.id))}.includes(v))t=v;}catch{}document.documentElement.dataset.theme=t;const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=${JSON.stringify(Object.fromEntries(THEMES.map((t) => [t.id,t.color])))}[t];})();`;
