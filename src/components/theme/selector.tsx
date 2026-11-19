import { THEMES } from "@/lib/appearance";
import { useTheme } from "@/components/theme/provider";

export function ThemeSelector() {
  const { theme, setTheme, storageFailed } = useTheme();
  return <section className="pixel-box space-y-3 p-4" aria-labelledby="appearance-heading">
    <div><h2 id="appearance-heading" className="text-lg">外觀</h2>
      <p className="mt-1 text-sm text-muted-foreground">所有主題都採淺色。此裝置會記住選擇，可隨時切換。</p></div>
    <fieldset className="space-y-2">
      <legend className="sr-only">選擇風格主題</legend>
      {THEMES.map((item) => <label key={item.id} className="theme-option" data-selected={theme === item.id}>
        <input type="radio" name="appearance" value={item.id} checked={theme === item.id} onChange={() => setTheme(item.id)} />
        <span className={`theme-swatch theme-swatch-${item.id}`} aria-hidden="true"><i /><i /><i /></span>
        <span className="min-w-0 flex-1"><strong className="block text-sm">{item.name}{item.id === "paper" && <span className="ml-2 text-xs font-normal">預設</span>}</strong><span className="block text-xs text-muted-foreground">{item.description}</span></span>
        {theme === item.id && <span className="theme-check" aria-hidden="true">✓</span>}
      </label>)}
    </fieldset>
    <p role="status" className="text-xs text-muted-foreground">{storageFailed ? "外觀已套用，但瀏覽器無法儲存；關閉後可能需要重新選擇。" : `目前：${THEMES.find((item) => item.id === theme)!.name}`}</p>
  </section>;
}
