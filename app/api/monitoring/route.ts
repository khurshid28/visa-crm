import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkersStatus, getQueueDepth } from "@/lib/order-queue";
import { APPLICANT_STATUS } from "@/lib/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function GET() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    workers,
    queueDepth,
    byStatus,
    regAgg,
    ordAgg,
    logStage,
    recentLogs,
    failed,
    activationByStatus,
    totalApplicants,
    byGroupStatus,
    groupRows,
    proxyByCountry,
    proxyOk,
    statusCodeRows,
    distinctExitIps,
    slowestLogs,
    errorLogs,
    hourlyLogs,
    navAgg,
  ] = await Promise.all([
    getWorkersStatus(),
    getQueueDepth(),
    prisma.applicant.groupBy({ by: ["status"], _count: true }),
    prisma.applicant.aggregate({
      _avg: { registerDurationMs: true, registerAttempts: true },
      _max: { registerDurationMs: true },
      _count: { registerFinishedAt: true },
      where: { registerFinishedAt: { not: null } },
    }),
    prisma.applicant.aggregate({
      _avg: { orderDurationMs: true, orderAttempts: true },
      _max: { orderDurationMs: true },
      _count: { orderFinishedAt: true },
      where: { orderFinishedAt: { not: null } },
    }),
    prisma.automationLog.groupBy({
      by: ["stage", "ok"],
      _count: true,
    }),
    prisma.automationLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        applicant: {
          select: { surname: true, name: true, generatedEmail: true },
        },
      },
    }),
    prisma.applicant.count({ where: { status: "FAILED" } }),
    prisma.applicant.groupBy({ by: ["activationStatus"], _count: true }),
    prisma.applicant.count(),
    prisma.applicant.groupBy({ by: ["groupId", "status"], _count: true }),
    prisma.group.findMany({
      select: {
        id: true,
        name: true,
        slot: { select: { fromCountry: true, toCountry: true } },
      },
    }),
    prisma.automationLog.groupBy({
      by: ["proxyCountry"],
      _count: true,
      _avg: { navMs: true, durationMs: true },
      where: { proxyCountry: { not: null } },
    }),
    prisma.automationLog.groupBy({
      by: ["proxyCountry", "ok"],
      _count: true,
      where: { proxyCountry: { not: null } },
    }),
    prisma.automationLog.groupBy({
      by: ["statusCode"],
      _count: true,
      where: { statusCode: { not: null } },
    }),
    prisma.automationLog.findMany({
      where: { exitIp: { not: null } },
      select: { exitIp: true },
      distinct: ["exitIp"],
    }),
    prisma.automationLog.findMany({
      where: { durationMs: { gt: 0 } },
      orderBy: { durationMs: "desc" },
      take: 10,
      include: { applicant: { select: { surname: true, name: true } } },
    }),
    prisma.automationLog.findMany({
      where: { ok: false },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { applicant: { select: { surname: true, name: true } } },
    }),
    prisma.automationLog.findMany({
      where: { createdAt: { gte: dayAgo } },
      select: { stage: true, ok: true, createdAt: true },
    }),
    prisma.automationLog.aggregate({
      _avg: { navMs: true },
      _max: { navMs: true },
      where: { navMs: { not: null, gt: 0 } },
    }),
  ]);

  // So'nggi 7 kun bo'yicha kunlik vaqt qatori (line chart uchun).
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setHours(0, 0, 0, 0);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const seriesLogs = await prisma.automationLog.findMany({
    where: { createdAt: { gte: sevenDaysAgo } },
    select: { stage: true, ok: true, durationMs: true, createdAt: true },
  });

  const days: { key: string; label: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sevenDaysAgo);
    d.setDate(sevenDaysAgo.getDate() + i);
    days.push({
      key: d.toISOString().slice(0, 10),
      label: `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`,
    });
  }

  const bucket: Record<
    string,
    { regOk: number; ordOk: number; fail: number; durSum: number; durN: number }
  > = {};
  for (const d of days)
    bucket[d.key] = { regOk: 0, ordOk: 0, fail: 0, durSum: 0, durN: 0 };

  for (const l of seriesLogs) {
    const k = l.createdAt.toISOString().slice(0, 10);
    const b = bucket[k];
    if (!b) continue;
    if (l.ok && l.stage === "register") b.regOk++;
    if (l.ok && l.stage === "order") b.ordOk++;
    if (!l.ok) b.fail++;
    if (l.durationMs > 0) {
      b.durSum += l.durationMs;
      b.durN++;
    }
  }

  const series = {
    labels: days.map((d) => d.label),
    registerOk: days.map((d) => bucket[d.key].regOk),
    orderOk: days.map((d) => bucket[d.key].ordOk),
    failed: days.map((d) => bucket[d.key].fail),
    avgDurationSec: days.map((d) =>
      bucket[d.key].durN
        ? Number((bucket[d.key].durSum / bucket[d.key].durN / 1000).toFixed(1))
        : 0,
    ),
  };

  const statusData = byStatus.map((s) => ({
    label: APPLICANT_STATUS[s.status]?.label ?? s.status,
    value: s._count,
    color: STATUS_COLORS[s.status] ?? "#94a3b8",
  }));

  const stage = (st: string, ok: boolean) =>
    logStage.find((l) => l.stage === st && l.ok === ok)?._count ?? 0;

  // ---- Konversiya voronkasi (funnel): NEW -> REGISTERED -> ORDERED -> BOOKED
  const cnt = (st: string) =>
    byStatus.find((s) => s.status === st)?._count ?? 0;
  const registeredPlus = cnt("REGISTERED") + cnt("ORDERED") + cnt("BOOKED");
  const orderedPlus = cnt("ORDERED") + cnt("BOOKED");
  const funnel = [
    { label: "Jami arizachi", value: totalApplicants, color: "#6366f1" },
    { label: "Ro'yxatdan o'tgan", value: registeredPlus, color: "#0ea5e9" },
    { label: "Buyurtma berilgan", value: orderedPlus, color: "#8b5cf6" },
    { label: "Band qilindi", value: cnt("BOOKED"), color: "#10b981" },
  ];

  // ---- So'nggi 24 soat — soatlik faollik
  const hourLabels: string[] = [];
  const hourKeys: string[] = [];
  const hb: Record<string, { ok: number; fail: number }> = {};
  for (let i = 23; i >= 0; i--) {
    const d = new Date(Date.now() - i * 60 * 60 * 1000);
    const key = `${d.toISOString().slice(0, 13)}`;
    hourKeys.push(key);
    hb[key] = { ok: 0, fail: 0 };
    hourLabels.push(`${String(d.getHours()).padStart(2, "0")}:00`);
  }
  for (const l of hourlyLogs) {
    const key = l.createdAt.toISOString().slice(0, 13);
    const b = hb[key];
    if (!b) continue;
    if (l.ok) b.ok++;
    else b.fail++;
  }
  const hourly = {
    labels: hourLabels,
    ok: hourKeys.map((k) => hb[k].ok),
    fail: hourKeys.map((k) => hb[k].fail),
  };

  // ---- Proxy (davlat) bo'yicha samaradorlik
  const proxyOkMap = new Map<string, { ok: number; fail: number }>();
  for (const r of proxyOk) {
    const c = r.proxyCountry ?? "?";
    const m = proxyOkMap.get(c) ?? { ok: 0, fail: 0 };
    if (r.ok) m.ok += r._count;
    else m.fail += r._count;
    proxyOkMap.set(c, m);
  }
  const proxyStats = proxyByCountry
    .map((p) => {
      const c = (p.proxyCountry ?? "?").toUpperCase();
      const okm = proxyOkMap.get(p.proxyCountry ?? "?") ?? { ok: 0, fail: 0 };
      const total = okm.ok + okm.fail;
      return {
        country: c,
        total,
        ok: okm.ok,
        fail: okm.fail,
        successRate: total ? Math.round((okm.ok / total) * 100) : 0,
        avgNavMs: Math.round(p._avg.navMs ?? 0),
        avgDurationMs: Math.round(p._avg.durationMs ?? 0),
      };
    })
    .sort((a, b) => b.total - a.total);

  // ---- HTTP status kodlari taqsimoti
  const statusCodes = statusCodeRows
    .map((r) => ({ code: r.statusCode ?? 0, count: r._count }))
    .sort((a, b) => b.count - a.count);

  // ---- Guruhlar bo'yicha kesim (status breakdown + success rate)
  const gMap = new Map<
    number,
    { total: number; booked: number; failed: number; registered: number }
  >();
  for (const r of byGroupStatus) {
    const m = gMap.get(r.groupId) ?? {
      total: 0,
      booked: 0,
      failed: 0,
      registered: 0,
    };
    m.total += r._count;
    if (r.status === "BOOKED") m.booked += r._count;
    if (r.status === "FAILED") m.failed += r._count;
    if (
      r.status === "REGISTERED" ||
      r.status === "ORDERED" ||
      r.status === "BOOKED"
    )
      m.registered += r._count;
    gMap.set(r.groupId, m);
  }
  const groups = groupRows
    .map((g) => {
      const m = gMap.get(g.id) ?? {
        total: 0,
        booked: 0,
        failed: 0,
        registered: 0,
      };
      return {
        id: g.id,
        name: g.name,
        fromCountry: g.slot?.fromCountry ?? null,
        toCountry: g.slot?.toCountry ?? null,
        total: m.total,
        registered: m.registered,
        booked: m.booked,
        failed: m.failed,
        successRate: m.total ? Math.round((m.booked / m.total) * 100) : 0,
      };
    })
    .filter((g) => g.total > 0)
    .sort((a, b) => b.total - a.total);

  const slowest = slowestLogs.map((l) => ({
    id: l.id,
    name: l.applicant
      ? `${l.applicant.surname} ${l.applicant.name}`
      : `#${l.applicantId ?? "-"}`,
    stage: l.stage,
    durationMs: l.durationMs,
    ok: l.ok,
    createdAt: l.createdAt.toISOString(),
  }));

  const errors = errorLogs.map((l) => ({
    id: l.id,
    name: l.applicant
      ? `${l.applicant.surname} ${l.applicant.name}`
      : `#${l.applicantId ?? "-"}`,
    stage: l.stage,
    attempt: l.attempt,
    note: l.note ?? "",
    statusCode: l.statusCode ?? null,
    createdAt: l.createdAt.toISOString(),
  }));

  return NextResponse.json({
    workers,
    queueDepth,
    statusData,
    timing: {
      register: {
        avgMs: Math.round(regAgg._avg.registerDurationMs ?? 0),
        maxMs: regAgg._max.registerDurationMs ?? 0,
        avgAttempts: Number((regAgg._avg.registerAttempts ?? 0).toFixed(2)),
        done: regAgg._count.registerFinishedAt,
      },
      order: {
        avgMs: Math.round(ordAgg._avg.orderDurationMs ?? 0),
        maxMs: ordAgg._max.orderDurationMs ?? 0,
        avgAttempts: Number((ordAgg._avg.orderAttempts ?? 0).toFixed(2)),
        done: ordAgg._count.orderFinishedAt,
      },
    },
    stageStats: {
      registerOk: stage("register", true),
      registerFail: stage("register", false),
      orderOk: stage("order", true),
      orderFail: stage("order", false),
      activationOk: stage("activation", true),
      activationFail: stage("activation", false),
    },
    activation: {
      activated:
        activationByStatus.find((a) => a.activationStatus === "activated")
          ?._count ?? 0,
      pending:
        activationByStatus.find((a) => a.activationStatus === "pending")
          ?._count ?? 0,
      failed:
        activationByStatus.find((a) => a.activationStatus === "failed")
          ?._count ?? 0,
    },
    series,
    failed,
    logs: recentLogs.map((l) => ({
      id: l.id,
      applicantId: l.applicantId,
      name: l.applicant
        ? `${l.applicant.surname} ${l.applicant.name}`
        : `#${l.applicantId ?? "-"}`,
      email: l.applicant?.generatedEmail ?? null,
      stage: l.stage,
      attempt: l.attempt,
      ok: l.ok,
      durationMs: l.durationMs,
      note: l.note ?? "",
      url: l.url ?? "",
      finalUrl: l.finalUrl ?? "",
      visitedUrls: l.visitedUrls
        ? l.visitedUrls.split("\n").filter(Boolean)
        : [],
      workerProfile: l.workerProfile ?? "",
      createdAt: l.createdAt.toISOString(),
    })),
    funnel,
    hourly,
    proxyStats,
    statusCodes,
    groups,
    slowest,
    errors,
    exitIpCount: distinctExitIps.length,
    nav: {
      avgMs: Math.round(navAgg._avg.navMs ?? 0),
      maxMs: navAgg._max.navMs ?? 0,
    },
    updatedAt: new Date().toISOString(),
  });
}
