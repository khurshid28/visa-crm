"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CloseCircle,
  Timer1,
  Clock,
  Pause,
  Play,
  Stop,
  CalendarTick,
  ProfileCircle,
  TickCircle,
  Refresh,
} from "iconsax-react";
import { fmtDateTime } from "@/lib/date";
import { useToast } from "@/components/Toast";
import DateTimePicker from "@/components/DateTimePicker";

type MonitorState = {
  active: boolean;
  paused: boolean;
  slotAt: string | null;
  intervalSeconds: number;
  windowMinutes: number;
  registerLeadMinutes: number;
  lastCheckAt: string | null;
  lastMessage: string;
  openedAt: string | null;
};

type Queue = {
  groups: number;
  registeredTotal: number;
  registeredComplete: number;
};

type SlotEvent = {
  id: number;
  type: string;
  slotAt: string | null;
  closeAt: string | null;
  message: string | null;
  usersQueued: number;
  usersDone: number;
  durationSec: number | null;
  source: string;
  username: string | null;
  createdAt: string;
};

const EVENT_META: Record<
  string,
  { label: string; cls: string; dot: string }
> = {
  configure: {
    label: "Sozlandi",
    cls: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  open: {
    label: "Ochildi",
    cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  close: {
    label: "Yopildi",
    cls: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  expired: {
    label: "Tugadi",
    cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  pause: {
    label: "Pauza",
    cls: "bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300",
    dot: "bg-slate-400",
  },
  go: {
    label: "Davom",
    cls: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
    dot: "bg-indigo-500",
  },
  stop: {
    label: "To'xtatildi",
    cls: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
    dot: "bg-rose-500",
  },
  check: {
    label: "Tekshiruv",
    cls: "bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-300",
    dot: "bg-slate-400",
  },
};

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, "0");
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}d ${pad2(s)}s`;
  const h = Math.floor(m / 60);
  return `${h}s ${pad2(m % 60)}d`;
}

// Slot oynasini (slotAt -> closeAt) o'qiladigan ko'rinishga keltiradi.
function fmtWindow(slotAt: string | null, closeAt: string | null): string {
  if (!slotAt || !closeAt) return "—";
  const mins = Math.round(
    (new Date(closeAt).getTime() - new Date(slotAt).getTime()) / 60_000,
  );
  if (mins <= 0) return "—";
  if (mins < 60) return `${mins} daq`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} soat ${m} daq` : `${h} soat`;
}

export default function SlotMonitorModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [state, setState] = useState<MonitorState | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [events, setEvents] = useState<SlotEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [slotInput, setSlotInput] = useState("");
  const [windowMin, setWindowMin] = useState(5);

  // Har soniyada tikiladigan soat (countdown uchun).
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  async function refresh() {
    try {
      const res = await fetch("/api/slot-monitor", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) return;
      setState(data.state ?? null);
      setQueue(data.queue ?? null);
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch {
      // jim
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, []);

  // Slot vaqti o'rnatilganda inputni to'ldiramiz (mahalliy vaqt).
  useEffect(() => {
    if (state?.slotAt && !slotInput) {
      const d = new Date(state.slotAt);
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
      setSlotInput(local.toISOString().slice(0, 16));
    }
  }, [state?.slotAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Server'dagi davomiylikni inputga sinxronlash.
  useEffect(() => {
    if (state?.windowMinutes) setWindowMin(state.windowMinutes);
  }, [state?.windowMinutes]);

  async function action(
    type: "configure" | "pause" | "go" | "stop",
    slotAt?: string,
  ) {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { action: type };
      if (type === "configure") {
        body.slotAt = slotAt;
        body.windowMinutes = windowMin;
      }
      const res = await fetch("/api/slot-monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error ?? "Amal bajarilmadi");
      toast(
        type === "configure"
          ? "Monitoring vaqti o'rnatildi"
          : "Monitoring holati yangilandi",
      );
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Amal bajarilmadi", "error");
    } finally {
      setBusy(false);
    }
  }

  function startMonitor() {
    if (!slotInput) {
      toast("Avval slot vaqtini tanlang", "error");
      return;
    }
    const d = new Date(slotInput);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      toast("Kelajakdagi to'g'ri vaqtni tanlang", "error");
      return;
    }
    action("configure", d.toISOString());
  }

  // Countdown hisoblari.
  const timer = useMemo(() => {
    if (!state?.slotAt) return null;
    const target = new Date(state.slotAt).getTime();
    const windowMs = state.windowMinutes * 60_000;
    const leadMs = state.registerLeadMinutes * 60_000;
    const checkStart = target - windowMs;
    const end = target + windowMs;
    const diff = target - now;
    let phase: "lead" | "check" | "ended" | "wait";
    let label: string;
    let ms: number;
    if (now < checkStart - leadMs) {
      phase = "wait";
      label = "Boshlanishigacha";
      ms = checkStart - leadMs - now;
    } else if (now < checkStart) {
      phase = "lead";
      label = "Register oynasi";
      ms = checkStart - now;
    } else if (now <= end) {
      phase = "check";
      label = diff > 0 ? "Slotgacha" : "Oyna tugashiga";
      ms = Math.abs(diff > 0 ? diff : end - now);
    } else {
      phase = "ended";
      label = "Oyna tugadi";
      ms = 0;
    }
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return { phase, label, h, m, s, end, checkStart };
  }, [state?.slotAt, state?.windowMinutes, state?.registerLeadMinutes, now]);

  const statusInfo = (() => {
    if (!state) return { text: "Yuklanmoqda", cls: "text-slate-400", dot: "bg-slate-300" };
    if (!state.active)
      return { text: "Faol emas", cls: "text-slate-500", dot: "bg-slate-400" };
    if (state.paused)
      return { text: "Pauza", cls: "text-amber-600", dot: "bg-amber-500" };
    return { text: "Ishlamoqda", cls: "text-emerald-600", dot: "bg-emerald-500" };
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 bg-gradient-to-br from-brand-600 to-brand-700 px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <Timer1 size={22} variant="Bold" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Slot monitoring</h2>
              <div className="flex items-center gap-2 text-xs text-white/80">
                <span
                  className={`h-2 w-2 rounded-full ${statusInfo.dot} ${
                    state?.active && !state.paused ? "animate-pulse" : ""
                  }`}
                />
                {statusInfo.text}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <CloseCircle size={24} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {/* Countdown */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/50">
            {timer ? (
              <div className="flex flex-col items-center gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {timer.label}
                </span>
                <div className="flex items-end gap-1 font-mono text-4xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
                  {timer.phase === "ended" ? (
                    <span className="text-2xl text-slate-400">— tugadi —</span>
                  ) : (
                    <>
                      <span>{pad2(timer.h)}</span>
                      <span className="text-slate-300">:</span>
                      <span>{pad2(timer.m)}</span>
                      <span className="text-slate-300">:</span>
                      <span className="text-brand-600">{pad2(timer.s)}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <CalendarTick size={14} />
                  Slot vaqti:{" "}
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {state?.slotAt ? fmtDateTime(state.slotAt) : "—"}
                  </span>
                </div>
                {/* Faza chiziqlari */}
                <div className="flex w-full max-w-md items-center gap-1 pt-1">
                  {(["lead", "check"] as const).map((p) => {
                    const active =
                      (timer.phase === "lead" && p === "lead") ||
                      timer.phase === "check";
                    return (
                      <div
                        key={p}
                        className={`h-1.5 flex-1 rounded-full ${
                          active
                            ? "bg-brand-500"
                            : "bg-slate-200 dark:bg-slate-700"
                        }`}
                      />
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-2 text-center text-sm text-slate-500 dark:text-slate-400">
                <Clock size={28} className="text-slate-300" />
                Slot vaqti hali belgilanmagan. Quyidan vaqtni tanlang.
              </div>
            )}
          </div>

          {/* Vaqt o'rnatish + boshqaruv */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/40">
            <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <CalendarTick size={14} /> Slot vaqtini belgilash
            </label>
            <DateTimePicker
              value={slotInput}
              onChange={setSlotInput}
              accent="brand"
            />

            {/* Tez tanlash presetlari — kalendardan keyin */}
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {[
                { label: "+15 daq", min: 15 },
                { label: "+30 daq", min: 30 },
                { label: "+1 soat", min: 60 },
                { label: "+2 soat", min: 120 },
                { label: "+1 kun", min: 1440 },
              ].map((p) => (
                <button
                  key={p.min}
                  onClick={() => {
                    const d = new Date(Date.now() + p.min * 60_000);
                    const local = new Date(
                      d.getTime() - d.getTimezoneOffset() * 60_000,
                    );
                    setSlotInput(local.toISOString().slice(0, 16));
                  }}
                  className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-brand-100 hover:text-brand-700 active:scale-95 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-brand-500/20"
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Davomiylik (slot oynasi) — ajratilgan bo'lim */}
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/30">
              <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <Clock size={13} /> Slot qancha vaqt ochiq turadi
              </label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: "2 daq", min: 2 },
                  { label: "5 daq", min: 5 },
                  { label: "10 daq", min: 10 },
                  { label: "15 daq", min: 15 },
                  { label: "20 daq", min: 20 },
                  { label: "30 daq", min: 30 },
                  { label: "1 soat", min: 60 },
                  { label: "2 soat", min: 120 },
                ].map((w) => (
                  <button
                    key={w.min}
                    onClick={() => setWindowMin(w.min)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition active:scale-95 ${
                      windowMin === w.min
                        ? "bg-brand-600 text-white shadow-sm"
                        : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700"
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>

            {/* O'rnatish — eng oxirida, chiroyli to'liq tugma */}
            <button
              onClick={startMonitor}
              disabled={busy}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:from-brand-700 hover:to-brand-600 hover:shadow-lg active:scale-[0.98] disabled:opacity-60"
            >
              <CalendarTick size={18} variant="Bold" />
              {busy ? "O'rnatilmoqda..." : "O'rnatish"}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => action("pause")}
              disabled={busy || !state?.active}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 active:scale-95 disabled:opacity-50 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30"
            >
              <Pause size={15} variant="Bold" /> Pauza
            </button>
            <button
              onClick={() => action("go")}
              disabled={busy || !state?.active}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100 active:scale-95 disabled:opacity-50 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30"
            >
              <Play size={15} variant="Bold" /> Davom (GO)
            </button>
            <button
              onClick={() => action("stop")}
              disabled={busy || !state?.active}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 active:scale-95 disabled:opacity-50 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30"
            >
              <Stop size={15} variant="Bold" /> To'xtatish
            </button>
            <button
              onClick={refresh}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-200 active:scale-95 dark:bg-slate-800 dark:text-slate-300"
            >
              <Refresh size={15} /> Yangilash
            </button>
          </div>

          {/* Statistika */}
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="REGISTERED"
              value={queue?.registeredTotal ?? 0}
              hint="kutyapti"
            />
            <Stat
              label="To'liq"
              value={queue?.registeredComplete ?? 0}
              hint="tayyor"
            />
            <Stat label="Guruhlar" value={queue?.groups ?? 0} hint="ta" />
          </div>

          {/* Oxirgi holat */}
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
            <span className="font-medium text-slate-500 dark:text-slate-400">
              Oxirgi holat:
            </span>{" "}
            {state?.lastMessage ?? "—"}
            {state?.lastCheckAt ? (
              <span className="text-slate-400">
                {" "}
                · {fmtDateTime(state.lastCheckAt)}
              </span>
            ) : null}
          </div>

          {/* Voqealar tarixi */}
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Clock size={16} /> Voqealar tarixi
            </h3>
            <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
              {loading ? (
                <div className="p-6 text-center text-sm text-slate-400">
                  Yuklanmoqda...
                </div>
              ) : events.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-400">
                  Hozircha voqealar yo'q.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Voqea</th>
                        <th className="px-3 py-2 font-medium">Slot vaqti</th>
                        <th className="px-3 py-2 font-medium">Davomiyligi</th>
                        <th className="px-3 py-2 font-medium">Userlar</th>
                        <th className="px-3 py-2 font-medium">Sodir bo'ldi</th>
                        <th className="px-3 py-2 font-medium">Manba</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {events.map((ev) => {
                        const meta = EVENT_META[ev.type] ?? {
                          label: ev.type,
                          cls: "bg-slate-100 text-slate-600",
                          dot: "bg-slate-400",
                        };
                        const windowLabel = fmtWindow(ev.slotAt, ev.closeAt);
                        return (
                          <tr
                            key={ev.id}
                            className="text-slate-600 dark:text-slate-300"
                          >
                            <td className="px-3 py-2">
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${meta.dot}`}
                                />
                                {meta.label}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700 dark:text-slate-200">
                              {ev.slotAt ? fmtDateTime(ev.slotAt) : "—"}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-500 dark:text-slate-400">
                              {windowLabel !== "—"
                                ? windowLabel
                                : fmtDuration(ev.durationSec)}
                            </td>
                            <td className="px-3 py-2">
                              {ev.usersQueued > 0 ? (
                                <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                                  <TickCircle size={13} variant="Bold" />
                                  {ev.usersQueued}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-slate-400 dark:text-slate-500">
                              {fmtDateTime(ev.createdAt)}
                            </td>
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center gap-1 text-slate-400">
                                <ProfileCircle size={13} />
                                {ev.source}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-700 dark:bg-slate-800/50">
      <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
        {value}
      </div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="text-[10px] text-slate-400">{hint}</div>
    </div>
  );
}
