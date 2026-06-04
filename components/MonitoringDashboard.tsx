"use client";

import { useEffect, useState } from "react";
import {
  StatusDonut,
  GroupBars,
  LineChart,
  GroupedBars,
} from "@/components/DashboardCharts";
import { fmtDateTime } from "@/lib/date";

type Worker = {
  profile: string;
  status: "idle" | "busy";
  applicantId?: number;
  groupId?: number;
  stage?: string;
  updatedAt: string;
};

type LogRow = {
  id: number;
  name: string;
  email: string | null;
  stage: string;
  attempt: number;
  ok: boolean;
  durationMs: number;
  note: string;
  workerProfile: string;
  createdAt: string;
};

type MonitoringData = {
  workers: Worker[];
  queueDepth: number;
  statusData: { label: string; value: number; color: string }[];
  timing: {
    register: { avgMs: number; maxMs: number; avgAttempts: number; done: number };
    order: { avgMs: number; maxMs: number; avgAttempts: number; done: number };
  };
  stageStats: {
    registerOk: number;
    registerFail: number;
    orderOk: number;
    orderFail: number;
    activationOk: number;
    activationFail: number;
  };
  activation: {
    activated: number;
    pending: number;
    failed: number;
  };
  series: {
    labels: string[];
    registerOk: number[];
    orderOk: number[];
    failed: number[];
    avgDurationSec: number[];
  };
  failed: number;
  logs: LogRow[];
  updatedAt: string;
};
function ms(n: number) {
  if (!n) return "—";
  if (n < 1000) return `${n} ms`;
  return `${(n / 1000).toFixed(1)} s`;
}

function timeAgo(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return `${Math.floor(d / 1000)} s oldin`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} daq oldin`;
  return fmtDateTime(iso);
}

export default function MonitoringDashboard() {
  const [data, setData] = useState<MonitoringData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/monitoring", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Xatolik");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!data) {
    return (
      <div className="card text-sm text-slate-500">
        {err ? `Yuklab bo'lmadi: ${err}` : "Yuklanmoqda..."}
      </div>
    );
  }

  const busy = data.workers.filter((w) => w.status === "busy").length;
  const stageBars = [
    { label: "Register ✓", value: data.stageStats.registerOk },
    { label: "Register ✕", value: data.stageStats.registerFail },
    { label: "Aktivatsiya ✓", value: data.stageStats.activationOk },
    { label: "Aktivatsiya ✕", value: data.stageStats.activationFail },
    { label: "Order ✓", value: data.stageStats.orderOk },
    { label: "Order ✕", value: data.stageStats.orderFail },
  ];

  return (
    <div className="space-y-8">
      {/* Stat kartalar */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Navbatdagi joblar" value={data.queueDepth} tone="bg-amber-50 text-amber-600" />
        <MetricCard label="Band worker" value={`${busy}/${data.workers.length}`} tone="bg-indigo-50 text-indigo-600" />
        <MetricCard label="Aktivatsiya ✓" value={data.activation.activated} tone="bg-emerald-50 text-emerald-600" />
        <MetricCard label="Aktivatsiya kutilmoqda" value={data.activation.pending} tone="bg-sky-50 text-sky-600" />
        <MetricCard label="Bo'lmadi (FAILED)" value={data.failed} tone="bg-rose-50 text-rose-600" />
        <MetricCard label="Order bajarildi" value={data.timing.order.done} tone="bg-emerald-50 text-emerald-600" />
      </div>

      {/* Worker grid */}
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Workerlar (Playwright)</h2>
          <span className="text-xs text-slate-400">yangilangan: {timeAgo(data.updatedAt)}</span>
        </div>
        {data.workers.length === 0 ? (
          <p className="text-sm text-slate-400">Hozircha faol worker yo'q (docker compose up bilan ishga tushiring).</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {data.workers.map((w) => (
              <div
                key={w.profile}
                className={`rounded-xl border p-3 ${
                  w.status === "busy"
                    ? "border-indigo-200 bg-indigo-50"
                    : "border-slate-100 bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      w.status === "busy" ? "animate-pulse bg-indigo-500" : "bg-slate-300"
                    }`}
                  />
                  <span className="truncate text-sm font-semibold text-slate-700">{w.profile}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {w.status === "busy"
                    ? `${w.stage ?? ""} • user #${w.applicantId ?? "-"}`
                    : "bo'sh"}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">{timeAgo(w.updatedAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-5 text-sm font-semibold text-slate-700">Arizachilar status taqsimoti</h2>
          <StatusDonut data={data.statusData} />
        </div>
        <div className="card">
          <h2 className="mb-5 text-sm font-semibold text-slate-700">Bosqichlar natijasi</h2>
          <GroupBars data={stageBars} />
        </div>
      </div>

      {/* Line: 7 kunlik faollik */}
      <div className="card">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">
          So&apos;nggi 7 kun — register / order / xato (kunlik)
        </h2>
        <LineChart
          labels={data.series.labels}
          series={[
            { label: "Register ✓", color: "#6366f1", points: data.series.registerOk },
            { label: "Order ✓", color: "#10b981", points: data.series.orderOk },
            { label: "Xato", color: "#ef4444", points: data.series.failed },
          ]}
        />
      </div>

      {/* Line: o'rtacha davomiylik + grouped bar */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">
            O&apos;rtacha urinish vaqti (sekund, kunlik)
          </h2>
          <LineChart
            labels={data.series.labels}
            unit="s"
            series={[
              { label: "O'rt. vaqt", color: "#f59e0b", points: data.series.avgDurationSec },
            ]}
          />
        </div>
        <div className="card">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">
            Bosqich bo&apos;yicha ✓ / ✕
          </h2>
          <GroupedBars
            legend={[
              { label: "Muvaffaqiyatli", color: "#10b981" },
              { label: "Xato", color: "#ef4444" },
            ]}
            data={[
              {
                label: "Register",
                values: [
                  { color: "#10b981", value: data.stageStats.registerOk },
                  { color: "#ef4444", value: data.stageStats.registerFail },
                ],
              },
              {
                label: "Order",
                values: [
                  { color: "#10b981", value: data.stageStats.orderOk },
                  { color: "#ef4444", value: data.stageStats.orderFail },
                ],
              },
            ]}
          />
        </div>
      </div>

      {/* Timing */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TimingCard title="Register vaqti" t={data.timing.register} />
        <TimingCard title="Buyurtma (order) vaqti" t={data.timing.order} />
      </div>

      {/* Loglar */}
      <div className="card">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">So'nggi loglar (har bir user)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="py-2 pr-3">Vaqt</th>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Bosqich</th>
                <th className="py-2 pr-3">Urinish</th>
                <th className="py-2 pr-3">Natija</th>
                <th className="py-2 pr-3">Davomiyligi</th>
                <th className="py-2 pr-3">Worker</th>
                <th className="py-2 pr-3">Izoh</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.map((l) => (
                <tr key={l.id} className="border-b border-slate-50 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-xs text-slate-400">{timeAgo(l.createdAt)}</td>
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-700">{l.name}</div>
                    {l.email && <div className="text-[11px] text-slate-400">{l.email}</div>}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{l.stage}</span>
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{l.attempt}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${
                        l.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {l.ok ? "✓ ok" : "✕ bo'lmadi"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-slate-600">{ms(l.durationMs)}</td>
                  <td className="py-2 pr-3 text-xs text-slate-500">{l.workerProfile || "—"}</td>
                  <td className="py-2 pr-3 max-w-xs truncate text-xs text-slate-500" title={l.note}>{l.note}</td>
                </tr>
              ))}
              {data.logs.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-sm text-slate-400">
                    Hali log yo'q
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className="card flex flex-col gap-1">
      <span className={`w-fit rounded-lg px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
      <span className="text-2xl font-bold text-slate-900">{value}</span>
    </div>
  );
}

function TimingCard({
  title,
  t,
}: {
  title: string;
  t: { avgMs: number; maxMs: number; avgAttempts: number; done: number };
}) {
  return (
    <div className="card">
      <h2 className="mb-4 text-sm font-semibold text-slate-700">{title}</h2>
      <div className="grid grid-cols-2 gap-4">
        <Cell label="O'rtacha" value={ms(t.avgMs)} />
        <Cell label="Eng uzun" value={ms(t.maxMs)} />
        <Cell label="O'rt. urinish" value={t.avgAttempts.toString()} />
        <Cell label="Bajarildi" value={t.done.toString()} />
      </div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-slate-800">{value}</div>
    </div>
  );
}
