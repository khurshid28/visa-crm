"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Add,
  ArrowRight2,
  CloseCircle,
  Lock1,
  Play,
  Pause,
  Stop,
  Calendar as CalendarIcon,
  Profile2User,
  People,
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

export default function SlotsManager({ slots }: { slots: SlotView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            Slotlar
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Yo'nalishlar bo'yicha slotlar. Har bir slotga guruhlar bog'lanadi.
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
              onAction={async (action) => {
                setBusy(s.id);
                await fetch(`/api/slots/${s.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action }),
                }).catch(() => {});
                setBusy(null);
                router.refresh();
              }}
            />
          ))}
        </div>
      )}

      {open && (
        <CreateSlotModal
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function StatusPill({ slot }: { slot: SlotView }) {
  const { active, paused } = slot;
  const cfg = !active
    ? { label: "To'xtagan", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" }
    : paused
      ? { label: "Pauzada", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" }
      : { label: "Faol", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active && !paused ? "bg-emerald-500 animate-pulse" : paused ? "bg-amber-500" : "bg-slate-400"}`} />
      {cfg.label}
    </span>
  );
}

function SlotCard({
  slot,
  busy,
  onAction,
}: {
  slot: SlotView;
  busy: boolean;
  onAction: (action: "go" | "pause" | "stop") => void;
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
        <StatusPill slot={slot} />
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

function CreateSlotModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [fromCountry, setFromCountry] = useState("UZB");
  const [toCountry, setToCountry] = useState("LVA");
  const [slotAt, setSlotAt] = useState("");
  const [windowMinutes, setWindowMinutes] = useState(10);
  const [registerLeadMinutes, setRegisterLeadMinutes] = useState(5);
  const [superUsername, setSuperUsername] = useState("");
  const [superPassword, setSuperPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError("");
    if (!name.trim()) return setError("Slot nomini kiriting");
    if (!superUsername.trim() || !superPassword.trim())
      return setError("Super login va parolni kiriting");
    setSaving(true);
    const res = await fetch("/api/slots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        fromCountry,
        toCountry,
        slotAt: slotAt || null,
        windowMinutes,
        registerLeadMinutes,
        superUsername,
        superPassword,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res) return setError("Tarmoq xatosi");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.error || "Xatolik yuz berdi");
    onCreated();
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
              Yangi slot qo'shish
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
          >
            <CloseCircle size={22} />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
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
          </Field>

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

          {/* Super login/parol — slot yaratish uchun alohida */}
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
            {saving ? "Saqlanmoqda..." : "Slot qo'shish"}
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
