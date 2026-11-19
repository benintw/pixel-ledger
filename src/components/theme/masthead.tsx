import { NotebookPen } from "lucide-react";

/** Decorative theme artwork never replaces navigation labels or financial values. */
export function ThemeMasthead() {
  return <div className="theme-masthead">
    <span className="journal-mark" aria-hidden="true"><NotebookPen size={30} strokeWidth={1.5} /></span>
    <div className="min-w-0"><p className="theme-brand">Pixel Ledger</p><p className="theme-tagline">把日子，一筆一筆記下來。</p></div>
    <div className="theme-itachi" aria-hidden="true"><img src="/themes/itachi.webp" alt="" width={360} height={240} decoding="async" /></div>
  </div>;
}
