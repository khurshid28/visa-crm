import { NextRequest, NextResponse } from "next/server";
import { getQueueDepth } from "@/lib/order-queue";
import {
  ensureSeed,
  listWorkers,
  listWorkerLogs,
  activeWorkers,
  setActive,
  setActiveCount,
  addWorkers,
  deleteWorker,
  cpuAdvice,
  isStale,
} from "@/lib/workers";

/**
 * ====================================================================
 *  WORKERS — bosh dashboarddagi worker boshqaruv paneli
 * ====================================================================
 *  Bazadagi workerlarni ko'rsatadi va boshqaradi:
 *   - on <N>      : tartib bo'yicha birinchi N tasini active qiladi
 *   - off <N>     : active sonidan N tasini o'chiradi
 *   - add <N>     : yana N ta worker qo'shadi
 *   - enable/disable <id> : bitta workerni yoqadi/o'chiradi
 *  CPU sig'imi (cores × WORKER_PER_CPU) ham qaytadi — UI ogohlantiradi.
 * ====================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function snapshot() {
  const [workers, cpu, queueDepth] = await Promise.all([
    listWorkers(),
    cpuAdvice(),
    getQueueDepth(),
  ]);
  return {
    workers: workers.map((w) => ({
      id: w.id,
      name: w.name,
      active: w.active,
      status: w.status,
      live: w.status !== "offline" && !isStale(w),
      jobsDone: w.jobsDone,
      currentJob: w.currentJob,
      host: w.host,
      pid: w.pid,
      lastError: w.lastError,
      lastSeenAt: w.lastSeenAt,
    })),
    cpu,
    queueDepth,
  };
}

export async function GET(req: NextRequest) {
  // ?logs=<worker nomi> => o'sha worker bajargan step'lar (AutomationLog).
  const name = req.nextUrl.searchParams.get("logs");
  if (name) {
    return NextResponse.json({ logs: await listWorkerLogs(name) });
  }
  await ensureSeed();
  return NextResponse.json(await snapshot());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const action = String(body?.action || "").toLowerCase();
  const value = Number(body?.value);

  await ensureSeed();

  switch (action) {
    case "on": {
      if (!Number.isFinite(value) || value < 0) {
        return NextResponse.json({ error: "Noto'g'ri son" }, { status: 400 });
      }
      await setActiveCount(value);
      break;
    }
    case "off": {
      if (!Number.isFinite(value) || value < 0) {
        return NextResponse.json({ error: "Noto'g'ri son" }, { status: 400 });
      }
      const active = (await activeWorkers()).length;
      await setActiveCount(Math.max(0, active - value));
      break;
    }
    case "add": {
      if (!Number.isFinite(value) || value <= 0) {
        return NextResponse.json({ error: "Noto'g'ri son" }, { status: 400 });
      }
      await addWorkers(value);
      break;
    }
    case "enable": {
      if (!Number.isFinite(value)) {
        return NextResponse.json({ error: "Noto'g'ri id" }, { status: 400 });
      }
      await setActive(value, true).catch(() => {});
      break;
    }
    case "disable": {
      if (!Number.isFinite(value)) {
        return NextResponse.json({ error: "Noto'g'ri id" }, { status: 400 });
      }
      await setActive(value, false).catch(() => {});
      break;
    }
    case "delete": {
      if (!Number.isFinite(value)) {
        return NextResponse.json({ error: "Noto'g'ri id" }, { status: 400 });
      }
      await deleteWorker(value).catch(() => {});
      break;
    }
    default:
      return NextResponse.json({ error: "Noma'lum amal" }, { status: 400 });
  }

  return NextResponse.json(await snapshot());
}
