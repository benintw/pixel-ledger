import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { applyTheme, DEFAULT_THEME, isTheme, readTheme, THEME_KEY, type Theme } from "@/lib/appearance";

type Appearance = { theme: Theme; setTheme: (theme: Theme) => void; storageFailed: boolean };
const ThemeContext = createContext<Appearance | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setCurrentTheme] = useState<Theme>(DEFAULT_THEME);
  const [storageFailed, setStorageFailed] = useState(false);
  useEffect(() => {
    const saved = readTheme();
    setCurrentTheme(saved);
    applyTheme(saved);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_KEY && event.key !== null) return;
      const next = isTheme(event.newValue) ? event.newValue : DEFAULT_THEME;
      setCurrentTheme(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function setTheme(next: Theme) {
    if (!isTheme(next)) return;
    applyTheme(next);
    setCurrentTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
      setStorageFailed(false);
    } catch { setStorageFailed(true); }
  }

  return <ThemeContext.Provider value={{ theme, setTheme, storageFailed }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Appearance {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeProvider is required");
  return value;
}
