"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft2, ArrowRight2, Calendar, CloseCircle } from "iconsax-react";

const WEEKDAYS = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
const MONTHS = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "Iyun",
  "Iyul",
  "Avgust",
  "Sentabr",
  "Oktabr",
  "Noyabr",
  "Dekabr",
];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// "YYYY-MM-DD" qaytaradi.
function toIso(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Faqat sana tanlagich (vaqtsiz). Filtrlar uchun — o'tgan sanalar ham ochiq.
// value/onChange "YYYY-MM-DD" formatda.
export default function DatePicker({
  value,
  onChange,
  placeholder = "Sana",
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = value ? new Date(value + "T00:00:00") : null;

  const [viewDate, setViewDate] = useState(() => {
    const base = selected ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const days = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewDate]);

  const label = selected
    ? `${selected.getDate()} ${MONTHS[selected.getMonth()].slice(0, 3)} ${selected.getFullYear()}`
    : placeholder;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-xl border bg-slate-50 px-3 py-2 text-left text-sm transition dark:bg-slate-800 ${
          open
            ? "border-brand-400 ring-2 ring-brand-100 dark:ring-brand-500/20"
            : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
        }`}
      >
        <Calendar size={16} className="text-brand-500" variant="Bold" />
        <span
          className={
            selected
              ? "font-medium text-slate-700 dark:text-slate-100"
              : "text-slate-400"
          }
        >
          {label}
        </span>
        {selected && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
              setOpen(false);
            }}
            className="ml-auto text-slate-300 hover:text-rose-500"
          >
            <CloseCircle size={15} />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-2 w-[270px] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                setViewDate(
                  new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1),
                )
              }
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <ArrowLeft2 size={16} />
            </button>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}
            </div>
            <button
              type="button"
              onClick={() =>
                setViewDate(
                  new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1),
                )
              }
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <ArrowRight2 size={16} />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-400">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((day, i) => {
              if (!day) return <div key={i} />;
              const isToday = sameDay(day, new Date());
              const isSel = selected && sameDay(day, selected);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onChange(toIso(day));
                    setOpen(false);
                  }}
                  className={`h-8 rounded-lg text-sm transition ${
                    isSel
                      ? "bg-brand-600 font-semibold text-white"
                      : `text-slate-600 hover:bg-brand-50 hover:text-brand-700 dark:text-slate-300 dark:hover:bg-brand-500/20 ${
                          isToday ? "font-semibold ring-1 ring-brand-400" : ""
                        }`
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-700">
            <button
              type="button"
              onClick={() => {
                onChange(toIso(new Date()));
                setOpen(false);
              }}
              className="rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10"
            >
              Bugun
            </button>
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              Tozalash
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
