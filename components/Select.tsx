"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown2, TickCircle } from "iconsax-react";

export type SelectOption = {
  value: string;
  label: string;
  iso2?: string;
  // Yo'nalish (slot) uchun ikki bayroq: from → to.
  fromIso2?: string;
  toIso2?: string;
};

// Bayroq rasmi (flagcdn). Windowsda emoji bayroqlar ko'rinmaydi.
function Flag({ iso2 }: { iso2?: string }) {
  if (!iso2) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/${iso2}.svg`}
      alt=""
      width={20}
      height={15}
      className="h-[15px] w-[20px] shrink-0 rounded-sm object-cover ring-1 ring-black/5"
    />
  );
}

// Yo'nalish belgisi: 🇺🇿 → 🇱🇻. Ikkala bayroq ham bo'lsa shu ko'rinadi.
function FlagPair({ from, to }: { from?: string; to?: string }) {
  if (!from && !to) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Flag iso2={from} />
      <span className="text-xs text-brand-400">→</span>
      <Flag iso2={to} />
    </span>
  );
}

// Tanlovga mos bayroq(lar)ni chizadi: yo'nalish bo'lsa juft, aks holda bitta.
function OptionFlag({ option }: { option: SelectOption }) {
  if (option.fromIso2 || option.toIso2) {
    return <FlagPair from={option.fromIso2} to={option.toIso2} />;
  }
  return <Flag iso2={option.iso2} />;
}

// Chiroyli, to'liq stillangan dropdown (native <select> o'rniga).
// Ochilganda yumshoq animatsiya, tanlangan element belgilanadi.
export default function Select({
  value,
  onChange,
  options,
  placeholder = "Tanlang",
  disabled = false,
  className = "",
  buttonClassName = "",
  leftIcon,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  leftIcon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // Tanlangan qiymat ro'yxatda bo'lmasa ham (masalan eski/qisqartirilgan
  // ro'yxatdan tushib qolgan davlat), uni ko'rsatish uchun vaqtincha qo'shamiz.
  const inList = options.find((o) => o.value === value);
  const displayOptions =
    value && !inList
      ? [{ value, label: value }, ...options]
      : options;
  const selected = displayOptions.find((o) => o.value === value);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function choose(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(displayOptions.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = displayOptions[highlight];
      if (opt) choose(opt.value);
    }
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={`flex w-full items-center gap-2 rounded-xl border bg-white px-3.5 py-2.5 text-left text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:opacity-60 ${
          open ? "border-brand-500 ring-2 ring-brand-100" : "border-slate-200"
        } ${buttonClassName}`}
      >
        {leftIcon}
        <span
          className={`flex flex-1 items-center gap-2 truncate ${
            selected ? "font-medium text-slate-700" : "text-slate-400"
          }`}
        >
          {selected && <OptionFlag option={selected} />}
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <ArrowDown2
          size={16}
          className={`shrink-0 text-slate-400 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 max-h-64 w-full origin-top animate-[popIn_.12s_ease-out] overflow-auto rounded-xl border border-slate-100 bg-white p-1.5 shadow-xl ring-1 ring-black/5">
          {displayOptions.length === 0 && (
            <div className="px-3 py-2 text-sm text-slate-400">Bo'sh</div>
          )}
          {displayOptions.map((o, i) => {
            const active = o.value === value;
            return (
              <button
                key={o.value || `opt-${i}`}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(o.value)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                  active
                    ? "bg-brand-50 font-semibold text-brand-700"
                    : highlight === i
                      ? "bg-slate-50 text-slate-700"
                      : "text-slate-600"
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <OptionFlag option={o} />
                  <span className="truncate">{o.label}</span>
                </span>
                {active && (
                  <TickCircle
                    size={16}
                    variant="Bold"
                    className="shrink-0 text-brand-500"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
