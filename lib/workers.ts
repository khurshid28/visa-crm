import os from "os";
import { prisma } from "./prisma";

// ===========================================================================
//  Worker registry + CPU sig'imi (capacity) mantiqi
//
//  Har bir "worker" = navbatdan (order.jobs) ish oladigan bitta yo'lak (lane).
//  Worker ish bajarganda haqiqiy Chrome ochiladi => CPU va RAM sarflaydi.
//  Shu sabab active workerlar soni CPU yadrolariga bog'liq (pastdagi izohga
//  qarang). Bazada default 10 ta worker turadi, admin yoqib/o'chirib turadi.
// ===========================================================================

// Bazada default nechta worker bo'lsin (foydalanuvchi talabi: 10 ta).
export const DEFAULT_WORKER_COUNT = Math.max(
  1,
  Number(process.env.WORKER_DEFAULT_COUNT || 10),
);

// Bitta CPU yadrosiga nechta worker to'g'ri keladi (default 2).
// Chrome og'ir bo'lgani uchun 1 yadro ~ 2 worker deb hisoblaymiz.
export function workersPerCpu(): number {
  const v = Number(process.env.WORKER_PER_CPU || 2);
  return Number.isFinite(v) && v > 0 ? v : 2;
}

// Serverdagi mantiqiy CPU yadrolari soni.
export function cpuCores(): number {
  return os.cpus().length || 1;
}

// CPU bo'yicha tavsiya etilgan maksimal active worker soni.
export function recommendedMax(): number {
  return Math.max(1, Math.floor(cpuCores() * workersPerCpu()));
}

// Tartib raqamdan worker nomi: 1 -> "worker-01".
export function workerName(seq: number): string {
  return `worker-${String(seq).padStart(2, "0")}`;
}

// Worker nomidan tartib raqamini chiqarish: "worker-07" -> 7.
function workerSeq(name: string): number {
  const m = name.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

// ----------------------------- Registry (CRUD) -----------------------------

// Bazada kamida DEFAULT_WORKER_COUNT ta worker borligini ta'minlaydi.
// Bo'sh bo'lsa worker-01..worker-10 ni yaratadi (hammasi active).
export async function ensureSeed(): Promise<number> {
  const existing = await prisma.worker.findMany({ select: { name: true } });
  const have = new Set(existing.map((w) => w.name));
  const toCreate: { name: string; active: boolean }[] = [];
  for (let i = 1; i <= DEFAULT_WORKER_COUNT; i++) {
    const name = workerName(i);
    if (!have.has(name)) toCreate.push({ name, active: true });
  }
  if (toCreate.length) {
    await prisma.worker.createMany({ data: toCreate, skipDuplicates: true });
  }
  return prisma.worker.count();
}

export async function listWorkers() {
  return prisma.worker.findMany({ orderBy: { id: "asc" } });
}

// Active workerlar — har doim tartib (id) bo'yicha. "iwla deganda tartib bn".
export async function activeWorkers() {
  return prisma.worker.findMany({
    where: { active: true },
    orderBy: { id: "asc" },
  });
}

export async function setActive(id: number, active: boolean) {
  return prisma.worker.update({ where: { id }, data: { active } });
}

// Tartib bo'yicha birinchi N tasini active qiladi, qolganini o'chiradi.
// Masalan setActiveCount(8) => worker-01..08 active, qolgani off.
export async function setActiveCount(n: number) {
  const all = await listWorkers();
  const target = Math.max(0, Math.min(Math.floor(n), all.length));
  const activeIds = all.slice(0, target).map((w) => w.id);
  const offIds = all.slice(target).map((w) => w.id);
  await prisma.$transaction([
    activeIds.length
      ? prisma.worker.updateMany({
          where: { id: { in: activeIds } },
          data: { active: true },
        })
      : prisma.worker.updateMany({ where: { id: -1 }, data: { active: true } }),
    offIds.length
      ? prisma.worker.updateMany({
          where: { id: { in: offIds } },
          data: { active: false },
        })
      : prisma.worker.updateMany({
          where: { id: -1 },
          data: { active: false },
        }),
  ]);
  return { requested: Math.floor(n), active: target, total: all.length };
}

// Yana N ta worker qo'shadi (raqamlash davom etadi). Hammasi active bo'ladi.
export async function addWorkers(n: number) {
  const count = Math.max(0, Math.floor(n));
  if (!count) {
    return { added: 0, total: await prisma.worker.count(), warning: null };
  }
  const all = await listWorkers();
  let maxSeq = 0;
  for (const w of all) maxSeq = Math.max(maxSeq, workerSeq(w.name));
  const data: { name: string; active: boolean }[] = [];
  for (let i = 1; i <= count; i++) {
    data.push({ name: workerName(maxSeq + i), active: true });
  }
  await prisma.worker.createMany({ data, skipDuplicates: true });
  const total = await prisma.worker.count();
  const advice = await cpuAdvice();
  return {
    added: count,
    total,
    warning: advice.overLimit ? advice.message : null,
  };
}

// --------------------------- CPU advice (izoh) -----------------------------

export type CpuAdvice = {
  cores: number;
  perCpu: number;
  recommendedMax: number;
  activeNow: number;
  overLimit: boolean;
  message: string;
};

// CPU sig'imi haqida tushuntirish. UI va CLI shuni ko'rsatadi.
export async function cpuAdvice(): Promise<CpuAdvice> {
  const cores = cpuCores();
  const perCpu = workersPerCpu();
  const max = recommendedMax();
  const activeNow = await prisma.worker.count({ where: { active: true } });
  const overLimit = activeNow > max;

  const message = overLimit
    ? `Diqqat: hozir ${activeNow} ta worker active, lekin bu serverda tavsiya ` +
      `etilgan maksimal ${max} ta (${cores} CPU yadro × ${perCpu} worker). ` +
      `Har bir worker = 1 ta haqiqiy Chrome, ya'ni CPU va operativ xotira ` +
      `sarflaydi. Limitdan oshsa, workerlar bir-birini kutadi va hammasi ` +
      `sekinlashadi. Ko'proq parallel ishlatmoqchi bo'lsangiz — serverga ` +
      `yana CPU yadro qo'shing.`
    : `${cores} ta CPU yadro mavjud. Tavsiya: maksimal ${max} ta active worker ` +
      `(${cores} × ${perCpu}). Hozir ${activeNow} ta active. Yana qo'shsangiz ` +
      `bo'ladi, lekin ${max} tadan oshirmang — har bir worker bitta Chrome ` +
      `ochadi va CPU sarflaydi. Ko'proq kerak bo'lsa, yana CPU qo'shing.`;

  return { cores, perCpu, recommendedMax: max, activeNow, overLimit, message };
}

// --------------------------- Runtime (pool/lane) ---------------------------

// Worker o'lik deb hisoblanadigan vaqt (lastSeenAt shu vaqtdan eski bo'lsa).
const STALE_MS = Number(process.env.WORKER_STALE_MS || 60_000);

export function isStale(w: { lastSeenAt: Date | null }): boolean {
  if (!w.lastSeenAt) return true;
  return Date.now() - new Date(w.lastSeenAt).getTime() > STALE_MS;
}

// Pool ishni boshlaganda eski holatlarni tozalaydi (hammasini offline qiladi).
export async function markAllOffline() {
  await prisma.worker.updateMany({
    data: { status: "offline", pid: null, currentJob: null },
  });
}

// Lane shu worker identifikatorini egallaydi (id + name DB dan keladi).
export async function claimWorker(id: number, host: string, pid: number) {
  return prisma.worker.update({
    where: { id },
    data: {
      status: "idle",
      host,
      pid,
      currentJob: null,
      lastError: null,
      claimedAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
}

export async function heartbeat(
  id: number,
  patch: Partial<{
    status: string;
    currentJob: string | null;
    lastError: string | null;
  }> = {},
) {
  try {
    await prisma.worker.update({
      where: { id },
      data: { ...patch, lastSeenAt: new Date() },
    });
  } catch {
    /* heartbeat muhim emas — xato bo'lsa o'tkazib yuboramiz */
  }
}

export async function incJobsDone(id: number) {
  try {
    await prisma.worker.update({
      where: { id },
      data: {
        jobsDone: { increment: 1 },
        currentJob: null,
        status: "idle",
        lastSeenAt: new Date(),
      },
    });
  } catch {
    /* ignore */
  }
}

export async function release(id: number) {
  try {
    await prisma.worker.update({
      where: { id },
      data: { status: "offline", pid: null, currentJob: null },
    });
  } catch {
    /* ignore */
  }
}
