import Link from "next/link";
import {
  Profile2User,
  People,
  TickCircle,
  Flash,
  ArrowRight2,
  ArrowUp,
  ArrowDown,
  Calendar,
} from "iconsax-react";
import { prisma } from "@/lib/prisma";
import { APPLICANT_STATUS } from "@/lib/status";
import {
  StatusDonut,
  GroupBars,
  LineChart,
  FunnelChart,
} from "@/components/DashboardCharts";
import StatusBadge from "@/components/StatusBadge";
import PeriodFilter from "@/components/PeriodFilter";
import { fmtDate } from "@/lib/date";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  NEW: "#94a3b8",
  EDITED: "#38bdf8",
  BOOKING: "#f59e0b",
  REGISTERED: "#6366f1",
  ORDERED: "#8b5cf6",
  BOOKED: "#10b981",
  FAILED: "#ef4444",
  ARCHIVED: "#cbd5e1",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  // Tanlangan davr (filter): 7 / 30 / 90 / 365 kun.
  const allowed = [7, 30, 90, 365];
  const days = allowed.includes(Number(searchParams.days))
    ? Number(searchParams.days)
    : 7;

  const [groupCount, applicantCount, booked, complete, byStatus] =
    await Promise.all([
      prisma.group.count(),
      prisma.applicant.count(),
      prisma.applicant.count({ where: { status: { in: ["ORDERED", "BOOKED"] } } }),
      prisma.applicant.count({ where: { complete: true } }),
      prisma.applicant.groupBy({ by: ["status"], _count: true }),
    ]);

  // Tanlangan davr vs oldingi shu davr (trend foizi uchun).
  const now = new Date();
  const periodMs = days * 86400000;
  const periodAgo = new Date(now.getTime() - periodMs);
  const twoPeriodsAgo = new Date(now.getTime() - 2 * periodMs);
  const [thisPeriod, lastPeriod] = await Promise.all([
    prisma.applicant.count({ where: { createdAt: { gte: periodAgo } } }),
    prisma.applicant.count({
      where: { createdAt: { gte: twoPeriodsAgo, lt: periodAgo } },
    }),
  ]);
  const periodTrend =
    lastPeriod === 0
      ? thisPeriod > 0
        ? 100
        : 0
      : Math.round(((thisPeriod - lastPeriod) / lastPeriod) * 100);

  const completeRate =
    applicantCount > 0 ? Math.round((complete / applicantCount) * 100) : 0;
  const bookedRate =
    applicantCount > 0 ? Math.round((booked / applicantCount) * 100) : 0;

  const recent = await prisma.group.findMany({
    orderBy: { createdAt: "desc" },
    take: 6,
    include: { _count: { select: { applicants: true } } },
  });

  // Tanlangan davr bo'yicha kunlik yangi arizachilar (line chart).
  // 7/30 kun — kunlik, 90/365 — haftalik/oylik guruhlash bilan ~12 nuqta.
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));
  const recentApplicants = await prisma.applicant.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true },
  });

  // Nuqtalar sonini chiroyli ushlab turish uchun bucket o'lchami.
  const bucketDays = days <= 30 ? 1 : days <= 90 ? 7 : 30;
  const bucketCount = Math.ceil(days / bucketDays);
  const buckets: { key: number; label: string; count: number }[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const start = new Date(since);
    start.setDate(since.getDate() + i * bucketDays);
    buckets.push({
      key: start.getTime(),
      label:
        bucketDays === 1
          ? `${String(start.getDate()).padStart(2, "0")}.${String(start.getMonth() + 1).padStart(2, "0")}`
          : `${String(start.getDate()).padStart(2, "0")}.${String(start.getMonth() + 1).padStart(2, "0")}`,
      count: 0,
    });
  }
  for (const a of recentApplicants) {
    const diffDays = Math.floor(
      (a.createdAt.getTime() - since.getTime()) / 86400000,
    );
    const idx = Math.floor(diffDays / bucketDays);
    if (idx >= 0 && idx < buckets.length) buckets[idx].count++;
  }
  const trendPoints = buckets.map((b) => b.count);
  const trendLabels = buckets.map((b) => b.label);

  const donutData = byStatus.map((s) => ({
    label: APPLICANT_STATUS[s.status]?.label ?? s.status,
    value: s._count,
    color: STATUS_COLORS[s.status] ?? "#94a3b8",
  }));

  const barData = recent
    .slice(0, 6)
    .map((g) => ({ label: g.name, value: g._count.applicants }));

  // Konversiya voronkasi: Jami -> To'liq -> Ro'yxatdan o'tgan -> Buyurtma -> Band.
  const cnt = (st: string) =>
    byStatus.find((s) => s.status === st)?._count ?? 0;
  const registeredPlus = cnt("REGISTERED") + cnt("ORDERED") + cnt("BOOKED");
  const orderedPlus = cnt("ORDERED") + cnt("BOOKED");
  const funnelData = [
    { label: "Jami arizachi", value: applicantCount, color: "#6366f1" },
    { label: "To'liq ma'lumot", value: complete, color: "#0ea5e9" },
    { label: "Ro'yxatdan o'tgan", value: registeredPlus, color: "#8b5cf6" },
    { label: "Buyurtma berilgan", value: orderedPlus, color: "#a855f7" },
    { label: "Band qilindi", value: cnt("BOOKED"), color: "#10b981" },
  ];

  const periodLabel =
    days === 7
      ? "7 kun"
      : days === 30
        ? "30 kun"
        : days === 90
          ? "90 kun"
          : "1 yil";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Boshqaruv paneli
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Umumiy ko'rsatkichlar va so'nggi guruhlar
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PeriodFilter value={String(days)} />
          <span className="inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-slate-600 shadow-soft ring-1 ring-slate-100 dark:bg-slate-900/60 dark:text-slate-300 dark:ring-slate-800">
            <Calendar size={16} variant="Bold" className="text-brand-500" />
            {fmtDate(now)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Guruhlar"
          value={groupCount}
          icon={<Profile2User size={22} variant="Bold" />}
          tone="bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300"
          hint="Jami yuklangan guruhlar"
        />
        <Stat
          label="Arizachilar"
          value={applicantCount}
          icon={<People size={22} variant="Bold" />}
          tone="bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300"
          trend={periodTrend}
          trendLabel={`oldingi ${periodLabel}ga`}
          periodLabel={periodLabel}
        />
        <Stat
          label="To'liq ma'lumot"
          value={complete}
          icon={<TickCircle size={22} variant="Bold" />}
          tone="bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300"
          progress={completeRate}
        />
        <Stat
          label="Band qilingan"
          value={booked}
          icon={<Flash size={22} variant="Bold" />}
          tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"
          progress={bookedRate}
          accent
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Status taqsimoti
          </h2>
          <StatusDonut data={donutData} />
        </div>
        <div className="card">
          <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Konversiya voronkasi
          </h2>
          <p className="mb-4 text-xs text-slate-400">
            Jami → to'liq → ro'yxat → buyurtma → band
          </p>
          <FunnelChart data={funnelData} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
            So'nggi {periodLabel} — yangi arizachilar
          </h2>
          <LineChart
            labels={trendLabels}
            series={[
              { label: "Yangi arizachilar", color: "#6366f1", points: trendPoints },
            ]}
          />
        </div>
        <div className="card">
          <h2 className="mb-5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Guruhlar bo'yicha arizachilar
          </h2>
          <GroupBars data={barData} />
        </div>
      </div>

      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            So'nggi guruhlar
          </h2>
          <Link
            href="/groups"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-100 transition-all hover:-translate-y-0.5 hover:bg-brand-100 hover:shadow"
          >
            Barchasi
            <ArrowRight2 size={14} variant="Bold" />
          </Link>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {recent.map((g) => {
            return (
              <Link
                key={g.id}
                href={`/groups/${g.id}`}
                className="group -mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-100 to-brand-50 text-sm font-bold text-brand-700 ring-1 ring-brand-100 dark:from-brand-500/15 dark:to-brand-500/5 dark:text-brand-300 dark:ring-brand-500/20">
                    {g.name?.[0]?.toUpperCase() ?? "G"}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {g.name}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-slate-400">
                      <People size={12} variant="Bold" className="text-slate-300" />
                      {g._count.applicants} arizachi
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={g.status} kind="group" />
                  <ArrowRight2
                    size={16}
                    className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500"
                  />
                </div>
              </Link>
            );
          })}
          {recent.length === 0 && (
            <p className="py-3 text-sm text-slate-400">
              Hali guruh yuklanmagan
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  tone,
  accent,
  trend,
  trendLabel,
  progress,
  hint,
  periodLabel,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
  accent?: boolean;
  trend?: number;
  trendLabel?: string;
  progress?: number;
  hint?: string;
  periodLabel?: string;
}) {
  const up = (trend ?? 0) >= 0;
  return (
    <div className="card group relative overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-xl transition-transform group-hover:scale-105 ${tone}`}
        >
          {icon}
        </div>
        {trend !== undefined && (
          <span
            className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
              up
                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                : "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"
            }`}
          >
            {up ? <ArrowUp size={12} variant="Bold" /> : <ArrowDown size={12} variant="Bold" />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>

      <div className="mt-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        <p
          className={`mt-0.5 text-3xl font-bold tracking-tight ${
            accent ? "text-emerald-600" : "text-slate-900 dark:text-slate-100"
          }`}
        >
          {value}
        </p>
      </div>

      {progress !== undefined && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>Ulush</span>
            <span className="font-semibold text-slate-500 dark:text-slate-300">
              {progress}%
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className={`h-full rounded-full ${
                accent
                  ? "bg-gradient-to-r from-emerald-400 to-emerald-600"
                  : "bg-gradient-to-r from-amber-400 to-amber-500"
              }`}
              style={{ width: `${progress}%`, transition: "width .7s ease" }}
            />
          </div>
        </div>
      )}

      {trend !== undefined && trendLabel && (
        <p className="mt-3 text-[11px] text-slate-400">
          So'nggi {periodLabel ?? "7 kun"} · {trendLabel}
        </p>
      )}

      {hint && <p className="mt-3 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}
