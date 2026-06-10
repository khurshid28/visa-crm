"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Global,
  Refresh,
  Danger,
  TickCircle,
  CloseCircle,
  EmptyWallet,
  DollarCircle,
  Chart2,
  Box,
  AddCircle,
  InfoCircle,
} from "iconsax-react";
import { useToast } from "@/components/Toast";

type Health = {
  ok: boolean;
  enabled: boolean;
  status?: number;
  exitIp?: string;
  outOfBalance: boolean;
  reason: string;
  checkedAt: number;
} | null;

type DayRow = {
  day: string;
  bytes: number;
  gb: number;
  requests: number;
  jobs: number;
};

type LabelRow = {
  label: string;
  bytes: number;
  gb: number;
  requests: number;
  jobs: number;
};

type Topup = {
  id: number;
  gb: number;
  amountUsd: number | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
};

type Report = {
  health: Health;
  windowDays: number;
  today: { bytes: number; gb: number };
  totals: { bytes: number; gb: number; requests: number; jobs: number };
  daily: DayRow[];
  workers: LabelRow[];
  balance: {
    purchasedGb: number;
    usedGb: number;
    remainingGb: number;
    hasBudget: boolean;
  };
  topups: Topup[];
};

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-500/20";

// Baytni o'qiladigan ko'rinishga (GB/MB/KB) keltiradi.
function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}

// label -> o'qiladigan nom.
function labelName(label: string): string {
  if (label === "slot") return "Slot tekshiruv";
  if (label === "tizim") return "Tizim (boshqa)";
  if (label === "web") return "Veb (qo'lda)";
  return label;
}

// "YYYY-MM-DD" -> "DD.MM" (qisqa).
function shortDay(day: string): string {
  const parts = day.split("-");
  return parts.length === 3 ? `${parts[2]}.${parts[1]}` : day;
}

function StatusBadge({ health }: { health: Health }) {
  if (!health || !health.enabled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:bg-slate-700/50 dark:text-slate-300">
        <Global size={13} variant="Bold" /> Proksi o'chiq
      </span>
    );
  }
  if (health.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        <TickCircle size={13} variant="Bold" /> Tirik
        {health.exitIp ? ` · ${health.exitIp}` : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
      <CloseCircle size={13} variant="Bold" />
      {health.outOfBalance ? "Balans tugagan (402)" : "Ishlamayapti"}
    </span>
  );
}

export default function ProxyUsagePanel() {
  const { toast } = useToast();
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [rechecking, setRechecking] = useState(false);

  // Top-up (to'landi) formasi.
  const [showTopup, setShowTopup] = useState(false);
  const [gb, setGb] = useState("");
  const [amountUsd, setAmountUsd] = useState("");
  const [note, setNote] = useState("");
  const [superUsername, setSuperUsername] = useState("");
  const [superPassword, setSuperPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as Report | null;
      if (res.ok && json) setData(json);
    } catch {
      // jim
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 12000);
    return () => window.clearInterval(id);
  }, [load]);

  async function recheck() {
    setRechecking(true);
    try {
      const res = await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recheck" }),
      });
      const json = (await res.json().catch(() => null)) as {
        health?: Health;
      } | null;
      if (res.ok && json?.health) {
        setData((d) => (d ? { ...d, health: json.health ?? null } : d));
        toast(
          json.health.ok
            ? "Proksi tirik"
            : `Proksi: ${json.health.reason}`,
          json.health.ok ? "success" : "error",
        );
      }
    } catch {
      toast("Tekshirishda xatolik", "error");
    } finally {
      setRechecking(false);
      load();
    }
  }

  async function submitTopup() {
    const gbNum = Number(gb);
    if (!Number.isFinite(gbNum) || gbNum <= 0) {
      toast("GB qiymatini kiriting (0 dan katta)", "error");
      return;
    }
    if (!superUsername.trim() || !superPassword.trim()) {
      toast("Super login va parolni kiriting", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "topup",
          gb: gbNum,
          amountUsd: amountUsd ? Number(amountUsd) : undefined,
          note: note.trim() || undefined,
          superUsername,
          superPassword,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | (Report & { ok?: boolean; error?: string })
        | null;
      if (!res.ok) {
        toast(json?.error || "To'ldirishda xatolik", "error");
        return;
      }
      toast("Proksi to'ldirildi va blok ochildi", "success");
      setShowTopup(false);
      setGb("");
      setAmountUsd("");
      setNote("");
      setSuperPassword("");
      if (json) setData(json as Report);
      load();
    } catch {
      toast("To'ldirishda xatolik", "error");
    } finally {
      setSaving(false);
    }
  }

  const health = data?.health ?? null;
  const balance = data?.balance;
  const lowBalance =
    balance?.hasBudget && balance.remainingGb <= Math.max(1, balance.purchasedGb * 0.1);

  return (
    <div className="card">
      {/* Sarlavha */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
            <Global size={20} variant="Bold" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Proksi trafik hisobi
            </h2>
            <p className="text-xs text-slate-400">
              IPRoyal trafik sarfi · oxirgi {data?.windowDays ?? 14} kun
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge health={health} />
          <button
            onClick={recheck}
            disabled={rechecking}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Refresh size={14} className={rechecking ? "animate-spin" : ""} />
            {rechecking ? "Tekshirilmoqda…" : "Qayta tekshirish"}
          </button>
          <button
            onClick={() => setShowTopup((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
          >
            <DollarCircle size={14} variant="Bold" /> Proksi to'landi
          </button>
        </div>
      </div>

      {/* Proksi o'lik ogohlantirishi */}
      {health && health.enabled && !health.ok && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <Danger size={16} variant="Bold" className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">
              {health.outOfBalance
                ? "Proksi balansi/trafigi tugagan — ish bajarilmaydi"
                : "Proksi ishlamayapti — ish bajarilmaydi"}
            </div>
            <p className="mt-0.5 leading-relaxed">
              {health.reason}. Hisobni to'ldirgach "Proksi to'landi" tugmasi
              bilan blokni oching.
            </p>
          </div>
        </div>
      )}

      {/* To'ldirish (top-up) formasi */}
      {showTopup && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4 dark:border-brand-500/30 dark:bg-brand-500/5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <AddCircle size={16} variant="Bold" className="text-brand-600" />
            Proksi to'ldirish (daftar yozuvi)
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Trafik (GB) *
              </label>
              <input
                type="number"
                min={0}
                step="0.1"
                value={gb}
                onChange={(e) => setGb(e.target.value)}
                placeholder="masalan: 50"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Summa (USD, ixtiyoriy)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={amountUsd}
                onChange={(e) => setAmountUsd(e.target.value)}
                placeholder="masalan: 35"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Izoh (ixtiyoriy)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="masalan: IPRoyal 50GB to'landi"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Super login *
              </label>
              <input
                type="text"
                value={superUsername}
                onChange={(e) => setSuperUsername(e.target.value)}
                autoComplete="off"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Super parol *
              </label>
              <input
                type="password"
                value={superPassword}
                onChange={(e) => setSuperPassword(e.target.value)}
                autoComplete="off"
                className={inputCls}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={() => setShowTopup(false)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Bekor
            </button>
            <button
              onClick={submitTopup}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <TickCircle size={14} variant="Bold" />
              {saving ? "Saqlanmoqda…" : "To'ldirish va blokni ochish"}
            </button>
          </div>
        </div>
      )}

      {/* Balans + bugungi sarf kartalari */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-700/60 dark:bg-slate-800/40">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <DollarCircle size={13} variant="Bold" /> Sotib olingan
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">
            {balance ? `${balance.purchasedGb.toFixed(1)} GB` : "—"}
          </div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-700/60 dark:bg-slate-800/40">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Chart2 size={13} variant="Bold" /> Ishlatilgan (jami)
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">
            {balance ? `${balance.usedGb.toFixed(2)} GB` : "—"}
          </div>
        </div>
        <div
          className={`rounded-xl border p-3 ${
            lowBalance
              ? "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
              : "border-slate-100 bg-slate-50/60 dark:border-slate-700/60 dark:bg-slate-800/40"
          }`}
        >
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <EmptyWallet size={13} variant="Bold" /> Qolgan
          </div>
          <div
            className={`mt-1 text-lg font-bold tabular-nums ${
              lowBalance
                ? "text-amber-700 dark:text-amber-300"
                : "text-slate-800 dark:text-slate-100"
            }`}
          >
            {balance?.hasBudget ? `${balance.remainingGb.toFixed(2)} GB` : "—"}
          </div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-700/60 dark:bg-slate-800/40">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Box size={13} variant="Bold" /> Bugun
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">
            {data ? fmtBytes(data.today.bytes) : "—"}
          </div>
        </div>
      </div>

      {loading && !data ? (
        <p className="py-6 text-center text-sm text-slate-400">Yuklanmoqda…</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Kunlik (sana bo'yicha) */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Chart2 size={13} variant="Bold" /> Sana bo'yicha
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-700/60">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-400 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Sana</th>
                    <th className="px-3 py-2 text-right font-medium">Trafik</th>
                    <th className="px-3 py-2 text-right font-medium">Ish</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.daily ?? []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-4 text-center text-xs text-slate-400"
                      >
                        Hali ma'lumot yo'q
                      </td>
                    </tr>
                  ) : (
                    (data?.daily ?? []).map((d) => (
                      <tr
                        key={d.day}
                        className="border-t border-slate-100 dark:border-slate-700/40"
                      >
                        <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">
                          {shortDay(d.day)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">
                          {fmtBytes(d.bytes)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">
                          {d.jobs}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Worker bo'yicha */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Box size={13} variant="Bold" /> Worker bo'yicha (oxirgi{" "}
              {data?.windowDays ?? 14} kun)
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-700/60">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-400 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Worker</th>
                    <th className="px-3 py-2 text-right font-medium">Trafik</th>
                    <th className="px-3 py-2 text-right font-medium">Ish</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.workers ?? []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-3 py-4 text-center text-xs text-slate-400"
                      >
                        Hali ma'lumot yo'q
                      </td>
                    </tr>
                  ) : (
                    (data?.workers ?? []).map((w) => (
                      <tr
                        key={w.label}
                        className="border-t border-slate-100 dark:border-slate-700/40"
                      >
                        <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">
                          {labelName(w.label)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">
                          {fmtBytes(w.bytes)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">
                          {w.jobs}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Oxirgi to'ldirishlar */}
      {data && data.topups.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <DollarCircle size={13} variant="Bold" /> Oxirgi to'ldirishlar
          </div>
          <div className="space-y-1.5">
            {data.topups.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-xs dark:border-slate-700/60"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {t.gb.toFixed(1)} GB
                  </span>
                  {t.amountUsd ? (
                    <span className="text-slate-400">· ${t.amountUsd}</span>
                  ) : null}
                  {t.note ? (
                    <span className="text-slate-500 dark:text-slate-400">
                      · {t.note}
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 text-slate-400">
                  {new Date(t.createdAt).toLocaleDateString("uz")}
                  {t.createdBy ? ` · ${t.createdBy}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
        <InfoCircle size={13} className="mt-0.5 shrink-0" />
        Trafik Chrome (CDP) orqali o'lchanadi — haqiqiy yuklab olingan baytga
        yaqin. Balans qo'lda yuritiladi: "Proksi to'landi" tugmasi bilan sotib
        olingan GB qo'shiladi.
      </p>
    </div>
  );
}
