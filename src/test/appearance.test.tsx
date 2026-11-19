import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme/provider";
import { ThemeSelector } from "@/components/theme/selector";
import { ThemeMasthead } from "@/components/theme/masthead";
import { applyTheme, readTheme, THEME_INIT_SCRIPT, THEME_KEY, THEMES } from "@/lib/appearance";

afterEach(() => {
  cleanup(); vi.restoreAllMocks(); window.localStorage.clear();
  delete document.documentElement.dataset["theme"];
  document.head.querySelector('meta[name="theme-color"]')?.remove();
});
function show() { return render(<ThemeProvider><ThemeSelector /><ThemeMasthead /></ThemeProvider>); }

describe("light appearance preferences", () => {
  it("defaults to paper and exposes exactly the approved three light themes", () => {
    show();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /紙本手帳/ })).toBeChecked();
    expect(document.documentElement.dataset["theme"]).toBe("paper");
    expect(screen.queryByText(/深色|暗色/)).not.toBeInTheDocument();
  });
  it.each(THEMES)("applies and restores $id across a remount", ({ id, name }) => {
    const view = show();
    if (id === "paper") fireEvent.click(screen.getByRole("radio", { name: /無印良品風/ }));
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(name) }));
    expect(window.localStorage.getItem(THEME_KEY)).toBe(id);
    expect(document.documentElement.dataset["theme"]).toBe(id);
    view.unmount(); show();
    expect(screen.getByRole("radio", { name: new RegExp(name) })).toBeChecked();
  });
  it("rejects unknown or injected storage values in React and before first paint", () => {
    window.localStorage.setItem(THEME_KEY, '<script>alert(1)</script>');
    expect(readTheme()).toBe("paper");
    window.eval(THEME_INIT_SCRIPT);
    expect(document.documentElement.dataset["theme"]).toBe("paper");
    expect(document.querySelectorAll("script")).toHaveLength(0);
  });
  it("restores the saved theme and browser chrome before hydration", () => {
    const meta = document.createElement("meta"); meta.name = "theme-color"; document.head.append(meta);
    window.localStorage.setItem(THEME_KEY, "muji");
    window.eval(THEME_INIT_SCRIPT);
    expect(document.documentElement.dataset["theme"]).toBe("muji");
    expect(meta.content).toBe("#f3efe7");
    applyTheme("shinobi"); expect(meta.content).toBe("#f1dfbc");
  });
  it("keeps switching usable when Safari blocks persistent storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readTheme()).toBe("paper");
    expect(() => window.eval(THEME_INIT_SCRIPT)).not.toThrow();
    show(); fireEvent.click(screen.getByRole("radio", { name: /火影忍者風/ }));
    expect(document.documentElement.dataset["theme"]).toBe("shinobi");
    expect(screen.getByRole("status")).toHaveTextContent("瀏覽器無法儲存");
  });
  it("updates another tab and resets on storage clear without touching ledger keys", () => {
    window.localStorage.setItem("pixel-ledger:active-ledger", "existing-ledger");
    show();
    fireEvent(window, new StorageEvent("storage", { key: THEME_KEY, newValue: "shinobi" }));
    expect(screen.getByRole("radio", { name: /火影忍者風/ })).toBeChecked();
    fireEvent(window, new StorageEvent("storage", { key: null, newValue: null }));
    expect(screen.getByRole("radio", { name: /紙本手帳/ })).toBeChecked();
    expect(window.localStorage.getItem("pixel-ledger:active-ledger")).toBe("existing-ledger");
  });
  it("uses the approved Itachi asset without changing financial labels", () => {
    const { container } = show();
    expect(container.querySelector(".theme-itachi img")).toHaveAttribute("src", "/themes/itachi.webp");
    expect(screen.getByText("Pixel Ledger")).toBeInTheDocument();
  });
});
