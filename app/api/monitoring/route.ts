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
    updatedAt: new Date().toISOString(),
  });
}
