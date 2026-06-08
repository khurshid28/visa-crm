import "dotenv/config";
import { prisma } from "../lib/prisma";
import { runSlotTick } from "../lib/slots";
import { setWorkerHeartbeat } from "../lib/order-queue";
import { isProxyEnabled } from "../lib/proxy";

// ====================================================================
//  SLOT-WORKER — kalendar monitoring job (alohida modul)
// ====================================================================
//  Doim ishlab turadi. Har SLOT_WORKER_INTERVAL_MS (default 10 minut) da:
//   1. Faol (active && !paused) slotlarni oladi.
//   2. Har biri uchun runSlotTick(id) chaqiradi — u kalendar sahifasini
//      ochib, bo'sh kun bor-yo'qligini aniqlaydi (proxy true bo'lsa rotating IP).
//   3. Slot oynasi/ochilishi mantiqi runSlotTick ichida (har slot o'z slotAt
//      oynasi bo'yicha mustaqil).
//
//  Bu — client SlotsManager (har 5s polling) o'rnini bosadi: admin sahifani
//  ochmasa ham server fonida ishlaydi.
//
//  .env:
//   SLOT_WORKER_INTERVAL_MS    — sikl oralig'i (default 600000 = 10 min)
//   SLOT_WORKER_CONCURRENCY    — bir vaqtda nechta slot tekshirilsin (default 2)
//   SLOT_WORKER_PROFILE_NAME   — heartbeat nomi (default "slot-worker")
// ====================================================================

const PROFILE = process.env.SLOT_WORKER_PROFILE_NAME || "slot-worker";
const INTERVAL_MS = Math.max(
  30_000,
  Number(process.env.SLOT_WORKER_INTERVAL_MS || 10 * 60 * 1000),
);
const CONCURRENCY = Math.max(
  1,
  Number(process.env.SLOT_WORKER_CONCURRENCY || 2),
);

let stopping = false;

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[slot-worker] ${msg}`);
}

async function heartbeat(status: "idle" | "busy", stage?: string) {
  await setWorkerHeartbeat({
    profile: PROFILE,
    status,
    stage,
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
}

// Faol slotlarni cheklangan parallellik bilan tekshiradi.
async function runCycle(): Promise<void> {
  const slots = await prisma.slot.findMany({
    where: { active: true, paused: false },
    select: { id: true, name: true },
    orderBy: { slotAt: "asc" },
  });

  if (slots.length === 0) {
    log("faol slot yo'q — kutilmoqda");
    return;
  }

  log(
    `${slots.length} ta faol slot tekshirilmoqda (proxy: ${
      isProxyEnabled() ? "yoqilgan" : "o'chiq"
    }, parallel: ${CONCURRENCY})`,
  );

  // Oddiy bo'lakli (chunked) parallellik — proxy/brauzerni cheklash uchun.
  for (let i = 0; i < slots.length; i += CONCURRENCY) {
    if (stopping) break;
    const batch = slots.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (s) => {
        try {
          const res = await runSlotTick(s.id, { notify: true });
          log(
            `slot #${s.id} (${s.name}): ${res.message}` +
              (res.slotOpen ? " ✅ OCHILDI" : ""),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log(`slot #${s.id} (${s.name}) xato: ${msg.slice(0, 200)}`);
        }
      }),
    );
  }
}

async function loop(): Promise<void> {
  log(`started — interval ${Math.round(INTERVAL_MS / 1000)}s`);
  // Idle heartbeat (bo'sh turganda ham monitoringda ko'rinsin).
  const hb = setInterval(() => heartbeat("idle"), 20_000);

  while (!stopping) {
    const startedAt = Date.now();
    await heartbeat("busy", "calendar-check");
    try {
      await runCycle();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`sikl xatosi: ${msg.slice(0, 200)}`);
    }
    await heartbeat("idle");

    if (stopping) break;
    // Siklning o'zi ketgan vaqtni hisobga olib qolgan vaqtni kutamiz.
    const elapsed = Date.now() - startedAt;
    const wait = Math.max(0, INTERVAL_MS - elapsed);
    await sleep(wait);
  }

  clearInterval(hb);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Stop kelganda darrov uyg'onamiz.
    const check = setInterval(() => {
      if (stopping) {
        clearTimeout(t);
        clearInterval(check);
        resolve();
      }
    }, 500);
  });
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  log("to'xtatilmoqda...");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

loop()
  .then(() => prisma.$disconnect())
  .then(() => {
    log("to'xtadi");
    process.exit(0);
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[slot-worker] fatal:", e);
    process.exit(1);
  });
