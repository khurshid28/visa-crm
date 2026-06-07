"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Add,
  ArrowRight2,
  CloseCircle,
  Lock1,
  Play,
  Pause,
  Stop,
  Calendar as CalendarIcon,
  Setting4,
  TickCircle,
  Profile2User,
  People,
  Clock,
} from "iconsax-react";
import Select from "@/components/Select";
import DateTimePicker from "@/components/DateTimePicker";
import { ORIGIN_COUNTRIES, DEST_COUNTRIES } from "@/lib/options";
import { fmtDateTime } from "@/lib/date";
import type { SlotView } from "@/lib/slots";

const FLAG = (iso2: string) =>
  iso2 ? `https://flagcdn.com/${iso2.toLowerCase()}.svg` : "";

function Flag({ code, size = 22 }: { code: string; size?: number }) {
  const iso2 =
    ORIGIN_COUNTRIES.find((c) => c.value === code)?.iso2 ||
    DEST_COUNTRIES.find((c) => c.value === code)?.iso2 ||
    "";
  if (!iso2) return <span>🏳️</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={FLAG(iso2)}
      alt={code}
      style={{ width: size, height: size * 0.72 }}
      className="shrink-0 rounded-[3px] object-cover ring-1 ring-black/10"
    />
  );
}

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, "0");
}

export default function SlotsManager({
  slots: initial,
}: {
  slots: SlotView[];
}) {
  const router = useRouter();
  const [slots, setSlots] = useState<SlotView[]>(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SlotView | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const ticking = useRef(false);

  // Server'dan slotlarni 5 soniyada yangilab turamiz.
  async function refresh() {
    try {
      const res = await fetch("/api/slots", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.slots) setSlots(data.slots as SlotView[]);
    } catch {
      // jim
    }
  }

  useEffect(() => {
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, []);

  // Faol (active && !paused) slotlar uchun monitoring tick'ini yuritamiz.
  useEffect(() => {
    const id = window.setInterval(async () => {
      if (ticking.current) return;
      const live = slots.filter((s) => s.active && !s.paused);
      if (live.length === 0) return;
      ticking.current = true;
      try {
        await Promise.all(
          live.map((s) =>
            fetch(`/api/slots/${s.id}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "tick" }),
            }).catch(() => {}),
          ),
        );
        await refresh();
      } finally {
        ticking.current = false;
      }
    }, 5000);
    return () => window.clearInterval(id);
  }, [slots]);

  async function control(id: number, action: "go" | "pause" | "stop") {
    setBusy(id);
    await fetch(`/api/slots/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
    setBusy(null);
    await refresh();
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            Slotlar
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Yo'nalishlar bo'yicha slotlar. Har biri mustaqil monitoring qiladi.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          <Add size={18} variant="Bold" />
          Yangi slot
        </button>
      </div>

      {slots.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/50 p-10 text-center dark:border-slate-700 dark:bg-slate-900/40">
          <CalendarIcon
            size={40}
            variant="Bulk"
            className="mx-auto text-slate-300 dark:text-slate-600"
          />
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            Hali slot yo'q. "Yangi slot" tugmasi orqali qo'shing.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {slots.map((s) => (
            <SlotCard
              key={s.id}
              slot={s}
              busy={busy === s.id}
              onAction={(action) => control(s.id, action)}
              onEdit={() => setEditing(s)}
            />
          ))}
        </div>
      )}

      {open && (
        <SlotFormModal
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            refresh();
            router.refresh();
          }}
        />
      )}
      {editing && (
        <SlotFormModal
          slot={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

type Phase = {
  label: string;
  cls: string;
  dot: string;
  pulse: boolean;
};

function phaseOf(slot: SlotView): Phase {
  const msg = (slot.lastMessage || "").toLowerCase();
  if (slot.active && slot.paused)
    return {
      label: "Pauzada",
      cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
      dot: "bg-amber-500",
      pulse: false,
    };
  if (slot.active) {
    if (msg.includes("yopiq") || msg.includes("tekshir"))
      return {
        label: "Tekshirilmoqda",
        cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
        dot: "bg-sky-500",
        pulse: true,
      };
    return {
      label: "Kutilmoqda",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
      dot: "bg-emerald-500",
      pulse: true,
    };
  }
  if (slot.openedAt)
    return {
      label: "Ochildi",
      cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
      dot: "bg-emerald-500",
      pulse: false,
    };
  if (msg.includes("tugadi"))
    return {
      label: "Tugadi",
      cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
      dot: "bg-rose-500",
      pulse: false,
    };
  return {
    label: "To'xtagan",
    cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    dot: "bg-slate-400",
    pulse: false,
  };
}

function StatusPill({ slot }: { slot: SlotView }) {
  const p = phaseOf(slot);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${p.cls}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${p.dot} ${p.pulse ? "animate-pulse" : ""}`}
      />
      {p.label}
    </span>
  );
}

const EVENT_META: Record<string, { label: string; cls: string }> = {
  open: { label: "Ochildi", cls: "text-emerald-600" },
  expired: { label: "Tugadi", cls: "text-rose-600" },
  configure: { label: "Sozlandi", cls: "text-slate-500" },
  go: { label: "Boshlandi", cls: "text-emerald-600" },
  pause: { label: "Pauza", cls: "text-amber-600" },
  stop: { label: "To'xtatildi", cls: "text-slate-500" },
};

function Countdown({ slot }: { slot: SlotView }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!slot.active || slot.paused || !slot.slotAt) return null;
  const diff = new Date(slot.slotAt).getTime() - now;
  if (diff <= 0) return null;
  const sec = Math.floor(diff / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const text =
    d > 0
      ? `${d} kun ${pad2(h)}:${pad2(m)}:${pad2(s)}`
      : `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  return (
    <div className="rounded-xl bg-brand-50 px-3 py-2 text-center dark:bg-brand-500/10">
      <div className="font-mono text-base font-bold tabular-nums text-brand-600">
        {text}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">
        slotgacha
      </div>
    </div>
  );
}

// Qisqa vaqt formati: "14:05" yoki "11 Iyun, 14:05".
function fmtClock(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// Slotning vaqt oynalarini (register, tekshiruv, oxiri) hisoblaydi.
function slotWindows(slot: SlotView) {
  if (!slot.slotAt) return null;
  const target = new Date(slot.slotAt).getTime();
  const windowMs = slot.windowMinutes * 60_000;
  const leadMs = slot.registerLeadMinutes * 60_000;
  return {
    target,
    leadStart: target - windowMs - leadMs, // register boshlanadi
    checkStart: target - windowMs, // tekshiruv boshlanadi
    end: target + windowMs, // oyna tugaydi
  };
}

type LivePhaseKey = "idle" | "wait" | "register" | "check" | "open" | "done";

const PHASE_STEPS: { key: LivePhaseKey; label: string }[] = [
  { key: "wait", label: "Kutish" },
  { key: "register", label: "Register" },
  { key: "check", label: "Tekshiruv" },
  { key: "open", label: "Natija" },
];

// Jonli faza paneli — vaqtlar, progress va konfiglarni ko'rsatadi.
function MonitorPanel({ slot }: { slot: SlotView }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const w = slotWindows(slot);

  // Joriy fazani aniqlaymiz.
  let phase: LivePhaseKey = "idle";
  if (slot.openedAt) phase = "open";
  else if ((slot.lastMessage || "").toLowerCase().includes("tugadi"))
    phase = "done";
  else if (w && slot.active && !slot.paused) {
    if (now < w.leadStart) phase = "wait";
    else if (now < w.checkStart) phase = "register";
    else if (now <= w.end) phase = "check";
    else phase = "done";
  } else if (w) {
    if (now < w.leadStart) phase = "wait";
    else if (now < w.checkStart) phase = "register";
    else if (now <= w.end) phase = "check";
  }

  const activeIdx = PHASE_STEPS.findIndex((s) => s.key === phase);

  return (
    <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
      {/* Faza chizig'i */}
      {w && (
        <div className="flex items-center gap-1">
          {PHASE_STEPS.map((step, i) => {
            const done = activeIdx >= 0 && i < activeIdx;
            const current = i === activeIdx;
            return (
              <div key={step.key} className="flex-1">
                <div
                  className={`h-1.5 rounded-full transition ${
                    current
                      ? phase === "open"
                        ? "bg-emerald-500"
                        : phase === "done"
                          ? "bg-rose-400"
                          : "animate-pulse bg-brand-500"
                      : done
                        ? "bg-brand-300"
                        : "bg-slate-200 dark:bg-slate-700"
                  }`}
                />
                <p
                  className={`mt-1 text-center text-[9px] font-medium uppercase tracking-wide ${
                    current
                      ? "text-brand-600 dark:text-brand-300"
                      : "text-slate-400"
                  }`}
                >
                  {step.label}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Vaqtlar jadvali */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <TimeRow label="Slot vaqti" value={fmtDateTime(slot.slotAt)} strong />
        <TimeRow
          label="Register boshlanishi"
          value={w ? fmtClock(new Date(w.leadStart).toISOString()) : "—"}
        />
        <TimeRow
          label="Tekshiruv boshlanishi"
          value={w ? fmtClock(new Date(w.checkStart).toISOString()) : "—"}
        />
        <TimeRow
          label="Oyna tugaydi"
          value={w ? fmtClock(new Date(w.end).toISOString()) : "—"}
        />
        <TimeRow label="Oxirgi tekshiruv" value={fmtClock(slot.lastCheckAt)} />
        <TimeRow
          label="Ochilgan"
          value={slot.openedAt ? fmtDateTime(slot.openedAt) : "—"}
          highlight={!!slot.openedAt}
        />
      </div>

      {/* Konfiglar + ta'sir */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200/70 pt-2 dark:border-slate-700/70">
        <Chip>{slot.windowMinutes} daq oyna</Chip>
        <Chip>{slot.registerLeadMinutes} daq oldin register</Chip>
        <Chip accent>{slot.groupsCount} guruh</Chip>
        <Chip accent>{slot.applicantsCount} ariza ta'sir</Chip>
      </div>
    </div>
  );
}

function TimeRow({
  label,
  value,
  strong = false,
  highlight = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-400">{label}</span>
      <span
        className={`tabular-nums ${
          highlight
            ? "font-semibold text-emerald-600"
            : strong
              ? "font-semibold text-slate-700 dark:text-slate-200"
              : "text-slate-600 dark:text-slate-300"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function Chip({
  children,
  accent = false,
}: {
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${
        accent
          ? "bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
          : "bg-slate-200/70 text-slate-600 dark:bg-slate-700/70 dark:text-slate-300"
      }`}
    >
      {children}
    </span>
  );
}


function SlotCard({
  slot,
  busy,
  onAction,
  onEdit,
}: {
  slot: SlotView;
  busy: boolean;
  onAction: (action: "go" | "pause" | "stop") => void;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-800 dark:text-slate-100">
            {slot.name}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {slot.slotAt ? fmtDateTime(slot.slotAt) : "Vaqt belgilanmagan"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusPill slot={slot} />
          <button
            onClick={onEdit}
            title="Sozlash"
            className="text-slate-300 transition hover:text-brand-500"
          >
            <Setting4 size={16} />
          </button>
        </div>
      </div>

      {/* Yo'nalish — bayroqlar bilan */}
      <div className="flex items-center justify-center gap-3 rounded-xl bg-slate-50 py-3 dark:bg-slate-800/50">
        <div className="flex flex-col items-center gap-1">
          <Flag code={slot.direction.fromCountry} />
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {slot.direction.fromName}
          </span>
        </div>
        <ArrowRight2 size={18} className="text-brand-500" />
        <div className="flex flex-col items-center gap-1">
          <Flag code={slot.direction.toCountry} />
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {slot.direction.toName}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <Profile2User size={15} variant="Bold" className="text-brand-500" />
          {slot.groupsCount} guruh
        </span>
        <span className="inline-flex items-center gap-1.5">
          <People size={15} variant="Bold" className="text-brand-500" />
          {slot.applicantsCount} ariza
        </span>
        <span className="ml-auto">{slot.windowMinutes} daq oyna</span>
      </div>

      <Countdown slot={slot} />

      {/* Jonli monitoring paneli — fazalar, vaqtlar, konfiglar, ta'sir */}
      <MonitorPanel slot={slot} />

      {/* Oxirgi holat xabari */}
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
        {slot.lastMessage}
      </p>

      {/* Voqealar tarixi — nima o'zgardi (ochildi/yopildi/tugadi/sozlandi) */}
      {slot.events.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-slate-100 p-2.5 dark:border-slate-800">
          <p className="px-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Nima o'zgardi
          </p>
          {slot.events.map((e) => {
            const meta = EVENT_META[e.type] ?? {
              label: e.type,
              cls: "text-slate-500",
            };
            return (
              <div
                key={e.id}
                className="flex items-center gap-2 text-[11px] text-slate-400"
              >
                <TickCircle size={12} variant="Bold" className={meta.cls} />
                <span className={`font-semibold ${meta.cls}`}>
                  {meta.label}
                </span>
                {e.usersQueued > 0 && (
                  <span className="rounded bg-brand-50 px-1 text-brand-600 dark:bg-brand-500/10">
                    {e.usersQueued} user
                  </span>
                )}
                {e.groupsCount > 0 && <span>· {e.groupsCount} guruh</span>}
                {e.durationSec != null && (
                  <span>· {Math.round(e.durationSec / 60)} daq</span>
                )}
                <span className="ml-auto tabular-nums">
                  {fmtDateTime(e.createdAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        {!slot.active || slot.paused ? (
          <button
            disabled={busy}
            onClick={() => onAction("go")}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            <Play size={15} variant="Bold" /> Boshlash
          </button>
        ) : (
          <button
            disabled={busy}
            onClick={() => onAction("pause")}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            <Pause size={15} variant="Bold" /> Pauza
          </button>
        )}
        <button
          disabled={busy || !slot.active}
          onClick={() => onAction("stop")}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Stop size={15} variant="Bold" /> To'xtatish
        </button>
      </div>
    </div>
  );
}

function SlotFormModal({
  slot,
  onClose,
  onSaved,
}: {
  slot?: SlotView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!slot;
  const [name, setName] = useState(slot?.name ?? "");
  const [fromCountry, setFromCountry] = useState(
    slot?.direction.fromCountry ?? "UZB",
  );
  const [toCountry, setToCountry] = useState(slot?.direction.toCountry ?? "LVA");
  const [slotAt, setSlotAt] = useState(
    slot?.slotAt ? slot.slotAt.slice(0, 16) : "",
  );
  const [windowMinutes, setWindowMinutes] = useState(slot?.windowMinutes ?? 10);
  const [registerLeadMinutes, setRegisterLeadMinutes] = useState(
    slot?.registerLeadMinutes ?? 5,
  );
  const [centre, setCentre] = useState(slot?.centre ?? "");
  const [category, setCategory] = useState(slot?.category ?? "");
  const [subCategory, setSubCategory] = useState(slot?.subCategory ?? "");
  const [superUsername, setSuperUsername] = useState("");
  const [superPassword, setSuperPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError("");
    if (!name.trim()) return setError("Slot nomini kiriting");
    if (!isEdit && (!superUsername.trim() || !superPassword.trim()))
      return setError("Super login va parolni kiriting");
    setSaving(true);
    const res = isEdit
      ? await fetch(`/api/slots/${slot!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "configure",
            name,
            fromCountry,
            toCountry,
            slotAt: slotAt || null,
            windowMinutes,
            registerLeadMinutes,
            centre,
            category,
            subCategory,
          }),
        }).catch(() => null)
      : await fetch("/api/slots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            fromCountry,
            toCountry,
            slotAt: slotAt || null,
            windowMinutes,
            registerLeadMinutes,
            centre,
            category,
            subCategory,
            superUsername,
            superPassword,
          }),
        }).catch(() => null);
    setSaving(false);
    if (!res) return setError("Tarmoq xatosi");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "Xatolik yuz berdi");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <CalendarIcon size={20} variant="Bold" className="text-brand-600" />
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
              {isEdit ? "Slotni sozlash" : "Yangi slot qo'shish"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
          >
            <CloseCircle size={22} />
          </button>
        </div>

        <div className="max-h-[80vh] space-y-4 overflow-y-auto px-6 py-5">
          <Field label="Slot nomi">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="masalan: Latviya tongi"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-500/20"
            />
          </Field>

          {/* Yo'nalish — chiroyli bayroqlar bilan */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Yo'nalish
            </p>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <Field label="Qayerdan">
                <Select
                  value={fromCountry}
                  onChange={setFromCountry}
                  options={ORIGIN_COUNTRIES}
                />
              </Field>
              <div className="pb-2.5">
                <ArrowRight2 size={18} className="text-brand-500" />
              </div>
              <Field label="Qayerga">
                <Select
                  value={toCountry}
                  onChange={setToCountry}
                  options={DEST_COUNTRIES}
                />
              </Field>
            </div>
          </div>

          <Field label="Slot vaqti (ixtiyoriy)">
            <DateTimePicker value={slotAt} onChange={setSlotAt} accent="brand" />
            {/* Tez tanlash presetlari */}
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
                  type="button"
                  onClick={() => {
                    const d = new Date(Date.now() + p.min * 60_000);
                    const local = new Date(
                      d.getTime() - d.getTimezoneOffset() * 60_000,
                    );
                    setSlotAt(local.toISOString().slice(0, 16));
                  }}
                  className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-brand-100 hover:text-brand-700 active:scale-95 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-brand-500/20"
                >
                  {p.label}
                </button>
              ))}
              {slotAt && (
                <button
                  type="button"
                  onClick={() => setSlotAt("")}
                  className="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-100 active:scale-95 dark:bg-rose-500/10 dark:text-rose-300"
                >
                  Tozalash
                </button>
              )}
            </div>
          </Field>

          {/* Slot oynasi — preset tugmalari bilan */}
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/30">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <Clock size={13} /> Slot qancha vaqt ochiq turadi
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[2, 5, 10, 15, 20, 30, 60, 120].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setWindowMinutes(m)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition active:scale-95 ${
                    windowMinutes === m
                      ? "bg-brand-600 text-white shadow-sm"
                      : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700"
                  }`}
                >
                  {m < 60 ? `${m} daq` : `${m / 60} soat`}
                </button>
              ))}
            </div>
          </div>

          {/* Register oldindan — preset tugmalari bilan */}
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/30">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <Clock size={13} /> Slotdan necha daqiqa oldin ro'yxat boshlansin
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[0, 2, 5, 10, 15, 30].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRegisterLeadMinutes(m)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition active:scale-95 ${
                    registerLeadMinutes === m
                      ? "bg-brand-600 text-white shadow-sm"
                      : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700"
                  }`}
                >
                  {m === 0 ? "0 (yo'q)" : `${m} daq`}
                </button>
              ))}
            </div>
          </div>

          {/* VFS appointment-detail tanlovlari (kalendar tekshiruvi uchun).
              Bo'sh qoldirsangiz .env default (BOOKING_CALENDAR_*) ishlatiladi. */}
          <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/40 p-3 dark:border-brand-500/20 dark:bg-brand-500/5">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">
              <CalendarIcon size={13} variant="Bold" /> VFS kalendar tanlovlari
            </p>
            <div className="space-y-3">
              <Field label="Application Centre">
                <input
                  value={centre}
                  onChange={(e) => setCentre(e.target.value)}
                  placeholder="masalan: VFS GLOBAL SERVICES UBKN"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-500/20"
                />
              </Field>
              <Field label="Appointment category">
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="masalan: Latvia Long Stay/Visa D"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-500/20"
                />
              </Field>
              <Field label="Sub-category">
                <input
                  value={subCategory}
                  onChange={(e) => setSubCategory(e.target.value)}
                  placeholder="masalan: Cargo drivers (Visa D) Uzbek, Turkmen"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-500/20"
                />
              </Field>
            </div>
          </div>

          {/* Aniq qiymatlar (xohlasangiz qo'lda kiriting) */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Oyna (daqiqa)">
              <input
                type="number"
                min={1}
                value={windowMinutes}
                onChange={(e) => setWindowMinutes(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-500/20"
              />
            </Field>
            <Field label="Register oldindan (daq)">
              <input
                type="number"
                min={0}
                value={registerLeadMinutes}
                onChange={(e) => setRegisterLeadMinutes(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-500/20"
              />
            </Field>
          </div>

          {/* Super login/parol — faqat yaratishda */}
          {!isEdit && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/20 dark:bg-amber-500/5">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                <Lock1 size={14} variant="Bold" />
                Super login/parol (slot yaratish uchun)
              </p>
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={superUsername}
                  onChange={(e) => setSuperUsername(e.target.value)}
                  placeholder="super login"
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <input
                  type="password"
                  value={superPassword}
                  onChange={(e) => setSuperPassword(e.target.value)}
                  placeholder="super parol"
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Bekor qilish
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
          >
            <Add size={18} variant="Bold" />
            {saving
              ? "Saqlanmoqda..."
              : isEdit
                ? "Saqlash"
                : "Slot qo'shish"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}
