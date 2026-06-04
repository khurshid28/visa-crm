"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft2,
  ArrowRight2,
  Calendar,
  Clock,
  ArrowUp2,
  ArrowDown2,
} from "iconsax-react";

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

// "YYYY-MM-DDTHH:mm" formatga keltiradi (datetime-local bilan mos).
function toLocalIso(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate()
  )}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// Kompakt sana-vaqt tanlagich: oddiy input ko'rinadi, bosilganda kalendar
// popover ochiladi. value/onChange "YYYY-MM-DDTHH:mm" formatda.
export default function DateTimePicker({
  value,
  onChange,
  accent = "emerald",
}: {
  value: string;
  onChange: (iso: string) => void;
  accent?: "emerald" | "brand";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = value ? new Date(value) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [viewDate, setViewDate] = useState(() => {
    const base = selected ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const hour = selected ? selected.getHours() : 9;
  const minute = selected ? selected.getMinutes() : 0;

  const accentBg = accent === "brand" ? "bg-brand-600" : "bg-emerald-600";
  const accentText = accent === "brand" ? "text-brand-600" : "text-emerald-600";
  const accentRing = accent === "brand" ? "ring-brand-500" : "ring-emerald-500";
  const accentHover =
    accent === "brand"
      ? "hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-500/20"
      : "hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-500/20";

  // Tashqariga bosilganda yopish.
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
    // Dushanba = 0 bo'lishi uchun siljitamiz (JS: Yakshanba = 0)
    const startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewDate]);

  function pick(day: Date) {
    const d = new Date(day);
    d.setHours(hour, minute, 0, 0);
    onChange(toLocalIso(d));
  }

  function setTime(h: number, m: number) {
    const base = selected ?? new Date();
    const d = new Date(base);
    d.setHours((h + 24) % 24, (m + 60) % 60, 0, 0);
    onChange(toLocalIso(d));
  }

  const label = selected
    ? `${selected.getDate()} ${MONTHS[selected.getMonth()]} ${selected.getFullYear()}, ${pad2(
        hour
      )}:${pad2(minute)}`
    : "Sana va vaqtni tanlang";

  return (
    <div className="relative" ref={ref}>
      {/* Trigger — oddiy input ko'rinishi */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center gap-2.5 rounded-xl border bg-white px-3 py-2.5 text-left text-sm transition dark:bg-slate-800 ${
          open
            ? `border-current ${accentText} ring-2 ${
                accent === "brand" ? "ring-brand-100" : "ring-emerald-100"
              }`
            : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
        }`}
      >
        <Calendar size={17} className={accentText} variant="Bold" />
        <span
          className={
            selected
              ? "font-medium text-slate-700 dark:text-slate-100"
              : "text-slate-400"
          }
        >
          {label}
        </span>
        <ArrowDown2
          size={15}
          className={`ml-auto text-slate-400 transition ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute left-0 z-50 mt-2 w-[300px] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-800">
          {/* Sarlavha + navigatsiya */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                setViewDate(
                  new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1)
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
                  new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)
                )
              }
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <ArrowRight2 size={16} />
            </button>
          </div>

          {/* Hafta kunlari */}
          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-400">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>

          {/* Kunlar grid */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((day, i) => {
              if (!day) return <div key={i} />;
              const isPast = day < today;
              const isToday = sameDay(day, new Date());
              const isSel = selected && sameDay(day, selected);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={isPast}
                  onClick={() => pick(day)}
                  className={`h-8 rounded-lg text-sm transition ${
                    isSel
                      ? `${accentBg} font-semibold text-white`
                      : isPast
                      ? "cursor-not-allowed text-slate-300 dark:text-slate-600"
                      : `text-slate-600 dark:text-slate-300 ${accentHover} ${
                          isToday ? `font-semibold ring-1 ${accentRing}` : ""
                        }`
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          {/* Vaqt tanlagich — stepper */}
          <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
            <Clock size={16} className={accentText} variant="Bold" />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Vaqt
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <TimeSpinner
                value={hour}
                max={24}
                onChange={(h) => setTime(h, minute)}
              />
              <span className="text-lg font-semibold text-slate-300">:</span>
              <TimeSpinner
                value={minute}
                max={60}
                onChange={(m) => setTime(hour, m)}
              />
            </div>
          </div>

          {/* Tugmalar */}
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-700">
            <button
              type="button"
              onClick={() => {
                const d = new Date();
                d.setMinutes(d.getMinutes() + 5, 0, 0);
                onChange(toLocalIso(d));
                setViewDate(new Date(d.getFullYear(), d.getMonth(), 1));
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-slate-700 dark:hover:text-slate-300"
            >
              <Clock size={13} /> +5 daq
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition active:scale-95 ${accentBg} ${
                accent === "brand"
                  ? "hover:bg-brand-700"
                  : "hover:bg-emerald-700"
              }`}
            >
              Tayyor
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Yuqori/past tugmali vaqt qiymati (soat yoki daqiqa).
function TimeSpinner({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-slate-50 px-1 py-0.5 dark:border-slate-600 dark:bg-slate-700/50">
      <button
        type="button"
        onClick={() => onChange((value + 1) % max)}
        className="p-0.5 text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
      >
        <ArrowUp2 size={13} />
      </button>
      <span className="w-7 text-center text-base font-bold tabular-nums text-slate-700 dark:text-slate-100">
        {pad2(value)}
      </span>
      <button
        type="button"
        onClick={() => onChange((value - 1 + max) % max)}
        className="p-0.5 text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200"
      >
        <ArrowDown2 size={13} />
      </button>
    </div>
  );
}
