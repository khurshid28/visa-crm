"use client";

import { useEffect, useState } from "react";
import { Sun1, Moon } from "iconsax-react";

type Theme = "light" | "dark";

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem("theme", theme);
  } catch {}
}

export default function ThemeToggle({ collapsed }: { collapsed?: boolean }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
  }, []);

  function set(next: Theme) {
    setTheme(next);
    apply(next);
  }

  const dark = mounted && theme === "dark";

  // Yig'ilgan (icon-only) holatda — bitta yumaloq tugma.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => set(dark ? "light" : "dark")}
        className="icon-btn mx-auto"
        aria-label="Mavzuni almashtirish"
        suppressHydrationWarning
      >
        {dark ? (
          <Sun1 size={18} variant="Bold" />
        ) : (
          <Moon size={18} variant="Bold" />
        )}
      </button>
    );
  }

  // Yorliq + aniq toggle switch.
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100 dark:bg-slate-800/50 dark:ring-slate-700/60"
      suppressHydrationWarning
    >
      <span className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
        {dark ? (
          <Moon size={16} variant="Bold" className="text-brand-400" />
        ) : (
          <Sun1 size={16} variant="Bold" className="text-amber-500" />
        )}
        {dark ? "Tungi rejim" : "Yorug' rejim"}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label="Mavzuni almashtirish"
        onClick={() => set(dark ? "light" : "dark")}
        className={`relative h-6 w-11 shrink-0 rounded-full ring-1 transition-colors duration-300 ${
          dark
            ? "bg-brand-600 ring-brand-500"
            : "bg-slate-200 ring-slate-300"
        }`}
      >
        <span
          className={`absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-all duration-300 ease-[cubic-bezier(.16,1,.3,1)] ${
            dark ? "left-[22px] text-brand-600" : "left-0.5 text-amber-500"
          }`}
        >
          {dark ? (
            <Moon size={11} variant="Bold" />
          ) : (
            <Sun1 size={11} variant="Bold" />
          )}
        </span>
      </button>
    </div>
  );
}
