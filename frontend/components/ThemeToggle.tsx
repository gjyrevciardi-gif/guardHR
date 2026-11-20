"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/** Light/dark switch. The initial theme is set by the inline script in the root layout; this only flips and remembers it. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("ng-theme", next); } catch { /* storage can be blocked; the choice then lasts for this visit only */ }
    setTheme(next);
  }

  const dark = theme === "dark";
  return (
    <button type="button" onClick={toggle} aria-pressed={dark} aria-label="Pamje e errët" title={dark ? "Kalo në pamjen e çelët" : "Kalo në pamjen e errët"} className={`btn-ghost !px-3 ${className}`}>
      {dark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
