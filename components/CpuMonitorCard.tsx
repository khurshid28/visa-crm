"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Cpu,
  Refresh,
  Danger,
  Health,
  Activity,
  Driver,
  Monitor,
  Box,
  Clock,
} from "iconsax-react";

type ServerInfo = {
  hostname: string;
  osName: string;
  osRelease: string;
  arch: string;
  cpuModel: string;
  cores: number;
  memTotal: number;
  uptimeSec: number;
};

type CpuStat = {
  percent: number;
  cores: number;
  loadavg: number[];
  memTotal: number;
  memUsed: number;
  memPercent: number;
  level: "ok" | "warn" | "high";
  threshold: number;
  over: boolean;
  message: string;
  at: string;
  server?: ServerInfo;
};

function fmtGB(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

// Soniyani "Nd Nh Nm" ko'rinishiga keltiradi (server ishlash vaqti).
function fmtUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d} kun`);
  if (h) parts.push(`${h} soat`);
  if (m || parts.length === 0) parts.push(`${m} daqiqa`);
  return parts.join(" ");
}

// Daraja bo'yicha rang palitrasi.
function palette(level: CpuStat["level"]) {
  if (level === "high") {
    return {
      ring: "text-rose-500",
      track: "text-rose-100 dark:text-rose-500/15",
      badge:
        "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
      bar: "bg-rose-500",
      label: "Yuqori",
    };
  }
  if (level === "warn") {
    return {
      ring: "text-amber-500",
      track: "text-amber-100 dark:text-amber-500/15",
      badge:
        "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
      bar: "bg-amber-500",
      label: "O'rtacha",
    };
  }
  return {
    ring: "text-emerald-500",
    track: "text-emerald-100 dark:text-emerald-500/15",
    badge:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    bar: "bg-emerald-500",
    label: "Yaxshi",
  };
}

// Doiraviy gauge (SVG).
function Gauge({ percent, level }: { percent: number; level: CpuStat["level"] }) {
  const p = palette(level);
  const r = 52;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, percent)) / 100) * c;
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="12"
          className={p.track}
          stroke="currentColor"
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          className={`${p.ring} transition-all duration-700 ease-out`}
          stroke="currentColor"
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold tabular-nums text-slate-800 dark:text-slate-100">
          {percent}
          <span className="text-lg font-semibold text-slate-400">%</span>
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
          CPU
        </span>
      </div>
    </div>
  );
}

export default function CpuMonitorCard() {
  const [stat, setStat] = useState<CpuStat | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cpu", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as CpuStat | null;
      if (res.ok && json) setStat(json);
    } catch {
      // jim
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 3000);
    return () => window.clearInterval(id);
  }, [load]);

  const p = palette(stat?.level ?? "ok");

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300">
            <Cpu size={20} variant="Bold" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Server holati (jonli)
            </h2>
            <p className="text-xs text-slate-400">
              CPU · xotira · tizim ma'lumotlari · har 3 soniyada · chegara{" "}
              {stat?.threshold ?? 80}%
            </p>
          </div>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Refresh size={14} /> Yangilash
        </button>
      </div>

      {/* Yuqori yuklama ogohlantirishi */}
      {stat?.over && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <Danger size={16} variant="Bold" className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">
              Diqqat: CPU {stat.percent}% — chegaradan ({stat.threshold}%)
              oshdi
            </div>
            <p className="mt-0.5 leading-relaxed">{stat.message}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
        <Gauge percent={stat?.percent ?? 0} level={stat?.level ?? "ok"} />

        <div className="w-full flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${p.badge}`}
            >
              {stat?.level === "high" ? (
                <Danger size={13} variant="Bold" />
              ) : stat?.level === "warn" ? (
                <Activity size={13} variant="Bold" />
              ) : (
                <Health size={13} variant="Bold" />
              )}
              Holat: {p.label}
            </span>
            <span className="text-xs text-slate-400">
              {loading ? "yuklanmoqda…" : `${stat?.cores ?? 0} yadro`}
            </span>
          </div>

          {/* Xotira */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Operativ xotira (RAM)</span>
              <span className="tabular-nums">
                {stat ? `${fmtGB(stat.memUsed)} / ${fmtGB(stat.memTotal)} GB` : "—"}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-700"
                style={{ width: `${stat?.memPercent ?? 0}%` }}
              />
            </div>
          </div>

          {/* CPU bar (gauge bilan bir xil qiymat, gorizontal ko'rinish) */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>CPU yuklamasi</span>
              <span className="tabular-nums">{stat?.percent ?? 0}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-700 ${p.bar}`}
                style={{ width: `${stat?.percent ?? 0}%` }}
              />
            </div>
          </div>

          {stat && stat.loadavg.some((n) => n > 0) && (
            <p className="text-[11px] text-slate-400">
              Yuklama o'rtachasi (1/5/15 daq):{" "}
              {stat.loadavg.map((n) => n.toFixed(2)).join(" · ")}
            </p>
          )}
        </div>
      </div>

      {/* Server ma'lumotlari (tizim nomi, OS, protsessor, umumiy xotira) */}
      {stat?.server && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="mb-3 flex items-center gap-2">
            <Driver
              size={16}
              variant="Bold"
              className="text-slate-400 dark:text-slate-500"
            />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Server ma'lumotlari
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <ServerTile
              icon={Monitor}
              label="Tizim nomi"
              value={stat.server.hostname}
            />
            <ServerTile
              icon={Driver}
              label="Operatsion tizim"
              value={`${stat.server.osName} ${stat.server.osRelease}`}
              sub={stat.server.arch}
            />
            <ServerTile
              icon={Cpu}
              label="Protsessor"
              value={stat.server.cpuModel}
              sub={`${stat.server.cores} yadro`}
            />
            <ServerTile
              icon={Box}
              label="Umumiy xotira (RAM)"
              value={`${fmtGB(stat.server.memTotal)} GB`}
            />
            <ServerTile
              icon={Clock}
              label="Ishlash vaqti"
              value={fmtUptime(stat.server.uptimeSec)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Server ma'lumoti uchun kichik plitka (label + qiymat).
function ServerTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
        <Icon size={13} variant="Bold" />
        {label}
      </div>
      <p
        className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200"
        title={value}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}
