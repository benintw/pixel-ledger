import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function PixelButton({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={cn("btn-pixel", `btn-${variant}`, className)} {...props} />;
}

export function PixelCard({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("pixel-box p-4", className)}>{children}</section>;
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block font-pixel text-sm">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function PageHeader({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 pb-4 pt-2">
      <div>
        <h1 className="text-2xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center font-pixel text-sm text-muted-foreground">{children}</p>;
}
