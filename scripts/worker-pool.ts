import "dotenv/config";
import os from "os";
import {
  consumeOrderQueue,
  acquireProfileLock,
  releaseProfileLock,
  type OrderJob,
} from "../lib/order-queue";
import { bookApplicant } from "../lib/booking";
import { prisma } from "../lib/prisma";
import {
  ensureSeed,
  activeWorkers,
  markAllOffline,
  claimWorker,
  heartbeat,
  incJobsDone,
  recommendedMax,
  cpuCores,
  workersPerCpu,
  cpuAdvice,
} from "../lib/workers";

// ===========================================================================
//  Worker pool (supervisor) — bitta jarayon, N ta parallel yo'lak (lane).
//
//  Bazadagi ACTIVE workerlarni o'qiydi (tartib bo'yicha = id) va har biriga
//  navbatdan (order.jobs) ish oladigan bitta lane ochadi. Har bir lane o'z
//  worker identifikatorini (id + name) bazadan oladi va holatini (busy/idle,
//  jobsDone, currentJob) bazaga yozib turadi.
//
//  Har bir lane ish bajarganda haqiqiy Chrome ochadi => CPU+RAM og'ir.
//  Shu sabab active workerlar soni CPU yadrolariga bog'liq.
// ===========================================================================

const host = os.hostname();
const pid = process.pid;

type Worker = Awaited<ReturnType<typeof activeWorkers>>[number];

const claimedIds: number[] = [];

// Bitta lane uchun xabar ishlovchisi (worker identifikatori bilan bog'langan).
function makeLaneHandler(worker: Worker) {
  return async function laneHandler(job: OrderJob) {
    const applicant = await prisma.applicant.findUnique({
      where: { id: job.applicantId },
      select: { id: true, generatedEmail: true, email: true },
    });
    if (!applicant) return;

    const profileKey =
      applicant.generatedEmail ||
      applicant.email ||
      `applicant-${applicant.id}`;

    // Shu userning gmail profilini bitta lane egallaydi (parallel ziddiyat yo'q).
    const locked = await acquireProfileLock(profileKey, worker.name);
    if (!locked) {
      // boshqa lane band qilgan — qayta navbatga tushishi uchun throw
      throw new Error(`profile band: ${profileKey}`);
    }

    try {
      await heartbeat(worker.id, {
        status: "busy",
        currentJob: `${job.stage} #${job.applicantId}`,
      });
      // eslint-disable-next-line no-console
      console.log(
        `[${worker.name}] ${job.stage} applicant=${job.applicantId} (${profileKey})`,
      );
      const out = await bookApplicant(job.applicantId, job.stage, worker.name);
      await incJobsDone(worker.id);
      // eslint-disable-next-line no-console
      console.log(
        `[${worker.name}] done applicant=${job.applicantId} ok=${out?.result.ok}`,
      );
    } catch (e) {
      await heartbeat(worker.id, {
        status: "idle",
        currentJob: null,
        lastError: e instanceof Error ? e.message : String(e),
      });
      throw e; // qayta navbatga tushadi
    } finally {
      await releaseProfileLock(profileKey, job.applicantId);
    }
  };
}

async function start() {
  // 1) Bazada kamida default (10) ta worker borligini ta'minlaymiz.
  const total = await ensureSeed();
  // 2) Eski (osilib qolgan) holatlarni tozalaymiz.
  await markAllOffline();

  // 3) CPU sig'imi haqida ogohlantirish.
  const advice = await cpuAdvice();
  const active = await activeWorkers();
  const max = recommendedMax();

  // eslint-disable-next-line no-console
  console.log(
    `[pool] host=${host} pid=${pid} cpu=${cpuCores()} yadro × ${workersPerCpu()} = tavsiya ${max} ta`,
  );
  // eslint-disable-next-line no-console
  console.log(`[pool] bazada ${total} ta worker, ${active.length} tasi active`);

  if (active.length > max) {
    // eslint-disable-next-line no-console
    console.warn(`[pool] ⚠ ${advice.message}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[pool] ${advice.message}`);
  }

  if (!active.length) {
    // eslint-disable-next-line no-console
    console.log(
      "[pool] active worker yo'q. `npm run workers on 8` bilan yoqing.",
    );
  }

  // 4) Har bir active worker uchun bitta lane ochamiz (tartib bo'yicha).
  for (const w of active) {
    await claimWorker(w.id, host, pid);
    claimedIds.push(w.id);
    await consumeOrderQueue(makeLaneHandler(w));
    // eslint-disable-next-line no-console
    console.log(`[pool] lane tayyor: ${w.name} (id=${w.id})`);
  }

  // 5) Har 20 soniyada lastSeenAt yangilab turamiz (tirik ekanini bildiradi).
  setInterval(() => {
    if (!claimedIds.length) return;
    prisma.worker
      .updateMany({
        where: { id: { in: claimedIds } },
        data: { lastSeenAt: new Date() },
      })
      .catch(() => {});
  }, 20000);

  // eslint-disable-next-line no-console
  console.log(
    `[pool] ${claimedIds.length} ta lane ishga tushdi. (Ctrl+C to'xtatadi)`,
  );
}

async function shutdown() {
  // eslint-disable-next-line no-console
  console.log("\n[pool] to'xtatilmoqda...");
  await prisma.worker
    .updateMany({
      where: { id: { in: claimedIds } },
      data: { status: "offline", pid: null, currentJob: null },
    })
    .catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[pool] fatal:", e);
  process.exit(1);
});
