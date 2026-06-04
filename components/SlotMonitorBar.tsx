"use client";

import { useEffect, useRef, useState } from "react";
import { Timer1, CalendarTick, Setting4 } from "iconsax-react";
import { fmtDateTime } from "@/lib/date";
import SlotMonitorModal from "@/components/SlotMonitorModal";

type MonitorState = {
  active: boolean;
  paused: boolean;
  slotAt: string | null;
  lastMessage: string;
  lastCheckAt: string | null;
};

type Queue = {
  groups: number;
  registeredTotal: number;
  registeredComplete: number;
};

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, "0");
}

export default function SlotMonitorBar() {
  const [state, setState] = useState<MonitorState | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  // Tick (slot tekshiruvi) ustma-ust ishlamasligi uchun qulf.
  const ticking = useRef(false);

  async function refresh() {
    try {
      const res = await fetch("/api/slot-monitor", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) return;
      setState(data.state ?? null);
      setQueue(data.queue ?? null);
    } catch {
      // jim
    }
  }

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, []);

  // Slot tekshiruvini har 5 soniyada global tarzda yuritamiz.
  // Faqat monitoring faol bo'lganda; ustma-ust ishlamaydi.
  useEffect(() => {
    const id = window.setInterval(async () => {
      if (ticking.current) return;
      if (!state?.active) return;
      ticking.current = true;
      try {
        const res = await fetch("/api/slot-monitor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "tick" }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.state) {
          setState(data.state);
          if (data.queue) setQueue(data.queue);
        }
      } catch {
        // jim
      } finally {
        ticking.current = false;
      }
    }, 5000);
    return () => window.clearInterval(id);
  }, [state?.active]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const status = (() => {
    if (!state || !state.active)
      return {
        text: "Faol emas",
        dot: "bg-slate-400",
        ring: "ring-slate-200 dark:ring-slate-700",
      };
    if (state.paused)
      return {
        text: "Pauza",
        dot: "bg-amber-500",
        ring: "ring-amber-200 dark:ring-amber-500/30",
      };
    return {
      text: "Ishlamoqda",
      dot: "bg-emerald-500",
      ring: "ring-emerald-200 dark:ring-emerald-500/30",
    };
  })();

  // Slotgacha countdown.
  const countdown = (() => {
    if (!state?.active || !state.slotAt) return null;
    const diff = new Date(state.slotAt).getTime() - now;
    if (diff <= 0) return null;
    const sec = Math.floor(diff / 1000);
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (d > 0) return `${d} kun ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  })();

  return (
    <>
      {open && <SlotMonitorModal onClose={() => setOpen(false)} />}

      <button
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-left shadow-sm ring-1 transition hover:shadow-md dark:border-slate-700 dark:bg-slate-900 ${status.ring}`}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10">
          <Timer1 size={22} variant="Bold" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Slot monitoring
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <span
                className={`h-1.5 w-1.5 rounded-full ${status.dot} ${
                  state?.active && !state.paused ? "animate-pulse" : ""
                }`}
              />
              {status.text}
            </span>
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {state?.slotAt ? (
              <span className="inline-flex items-center gap-1">
                <CalendarTick size={12} />
                Slot: {fmtDateTime(state.slotAt)}
              </span>
            ) : (
              state?.lastMessage || "Slot vaqti belgilanmagan"
            )}
            {queue ? (
              <span className="text-slate-400">
                {" · "}
                {queue.registeredTotal} REGISTERED · {queue.groups} guruh
              </span>
            ) : null}
          </div>
        </div>

        {countdown && (
          <div className="hidden shrink-0 text-right sm:block">
            <div className="font-mono text-lg font-bold tabular-nums text-brand-600">
              {countdown}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">
              slotgacha
            </div>
          </div>
        )}

        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition group-hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
          <Setting4 size={18} />
        </span>
      </button>
    </>
  );
}
