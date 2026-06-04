import Link from "next/link";
import {
  Profile2User,
  People,
  TickCircle,
  Flash,
  ArrowRight2,
} from "iconsax-react";
import { prisma } from "@/lib/prisma";
import { APPLICANT_STATUS } from "@/lib/status";
import { StatusDonut, GroupBars, LineChart } from "@/components/DashboardCharts";
import StatusBadge from "@/components/StatusBadge";

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

export default async function DashboardPage() {
  const [groupCount, applicantCount, booked, complete, byStatus] =
    await Promise.all([
      prisma.group.count(),
      prisma.applicant.count(),
      prisma.applicant.count({ where: { status: { in: ["ORDERED", "BOOKED"] } } }),
      prisma.applicant.count({ where: { complete: true } }),
      prisma.applicant.groupBy({ by: ["status"], _count: true }),
    ]);

  const recent = await prisma.group.findMany({
    orderBy: { createdAt: "desc" },
    take: 6,
    include: { _count: { select: { applicants: true } } },
  });

  // So'nggi 7 kun: kunlik yangi arizachilar (line chart).
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - 6);
  const recentApplicants = await prisma.applicant.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true },
  });
  const days: { key: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    days.push({
      key: d.toISOString().slice(0, 10),
      label: `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`,
    });
  }
  const dayCount: Record<string, number> = {};
  for (const d of days) dayCount[d.key] = 0;
  for (const a of recentApplicants) {
    const k = a.createdAt.toISOString().slice(0, 10);
    if (k in dayCount) dayCount[k]++;
  }
  const trendPoints = days.map((d) => dayCount[d.key]);
  const trendLabels = days.map((d) => d.label);

  const donutData = byStatus.map((s) => ({
    label: APPLICANT_STATUS[s.status]?.label ?? s.status,
    value: s._count,
    color: STATUS_COLORS[s.status] ?? "#94a3b8",
  }));

  const barData = recent
    .slice(0, 6)
    .map((g) => ({ label: g.name, value: g._count.applicants }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Boshqaruv paneli
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Umumiy ko'rsatkichlar va so'nggi guruhlar
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Guruhlar"
          value={groupCount}
          icon={<Profile2User size={22} variant="Bold" />}
          tone="bg-brand-50 text-brand-600"
        />
        <Stat
          label="Arizachilar"
          value={applicantCount}
          icon={<People size={22} variant="Bold" />}
          tone="bg-sky-50 text-sky-600"
        />
        <Stat
          label="To'liq ma'lumot"
          value={complete}
          icon={<TickCircle size={22} variant="Bold" />}
          tone="bg-amber-50 text-amber-600"
        />
        <Stat
          label="Band qilingan"
          value={booked}
          icon={<Flash size={22} variant="Bold" />}
          tone="bg-emerald-50 text-emerald-600"
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
          <h2 className="mb-5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Guruhlar bo'yicha arizachilar
          </h2>
          <GroupBars data={barData} />
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 text-sm font-semibold text-slate-700 dark:text-slate-200">
          So'nggi 7 kun — yangi arizachilar
        </h2>
        <LineChart
          labels={trendLabels}
          series={[
            { label: "Yangi arizachilar", color: "#6366f1", points: trendPoints },
          ]}
        />
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
        <div className="divide-y divide-slate-100">
          {recent.map((g) => {
            return (
              <Link
                key={g.id}
                href={`/groups/${g.id}`}
                className="flex items-center justify-between py-3 transition hover:opacity-80"
              >
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{g.name}</p>
                  <p className="text-xs text-slate-400">
                    {g._count.applicants} arizachi
                  </p>
                </div>
                <StatusBadge status={g.status} kind="group" />
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
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
  accent?: boolean;
}) {
  return (
    <div className="card flex items-center gap-4">
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl ${tone}`}
      >
        {icon}
      </div>
      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        <p
          className={`text-2xl font-semibold ${
            accent ? "text-emerald-600" : "text-slate-900 dark:text-slate-100"
          }`}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
