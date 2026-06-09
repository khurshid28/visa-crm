import "dotenv/config";
import { prisma } from "../lib/prisma";
import { ApplicantStatus } from "@prisma/client";
import { runActivation } from "../lib/automation";
import { toAutomationInput } from "../lib/booking";
import { setWorkerHeartbeat } from "../lib/order-queue";
import { isMailListenerEnabled, getImapConfig } from "../lib/mail-listener";

// ====================================================================
//  MAIL-WORKER — gmail aktivatsiya listener (alohida microservice)
// ====================================================================
//  Slot-worker'ga o'xshab doim ishlab turadi. Har MAIL_WORKER_INTERVAL_MS
//  (default 60s) da:
//   1. Aktivatsiya kutayotgan arizachilarni oladi:
//        activatedAt = null
//        activationStatus IN ('pending','failed')
//        generatedEmail bor
//        registerFinishedAt: (now - LOOKBACK soat) .. (now - STALE daqiqa)
//      STALE oraliq — inline (booking) aktivatsiyasi bilan to'qnashmaslik
//      uchun: faqat register tugaganiga > STALE daqiqa bo'lganlar olinadi
//      (inline activation 3 daqiqada tugaydi).
//   2. Har biri uchun runActivation'ni QISQA mail-kutish bilan chaqiradi
//      (bir poll). Xat hali kelmagan bo'lsa — brauzer ochilmaydi, keyingi
//      siklda qayta uriniladi. Xat kelsa — link userning register profilida
//      (sticky IP) ochiladi va DB 'activated' qilib belgilanadi.
//
//  IMAP sozlanmagan bo'lsa — worker bo'sh aylanaveradi (xato bermaydi).
//
//  .env:
//   MAIL_WORKER_INTERVAL_MS     — sikl oralig'i (default 60000 = 1 min)
//   MAIL_WORKER_CONCURRENCY     — bir vaqtda nechta arizachi (default 2)
//   MAIL_WORKER_STALE_MIN       — register tugaganidan keyin necha daqiqa
//                                 kutib olinadi (default 5)
//   MAIL_WORKER_LOOKBACK_HOURS  — necha soatgacha orqaga qaraladi (default 48)
//   MAIL_WORKER_MAIL_WAIT_MS    — har arizachi uchun xat kutish (default 8000)
//   MAIL_WORKER_BATCH           — bir siklda max arizachi (default 20)
//   MAIL_WORKER_PROFILE_NAME    — heartbeat nomi (default "mail-worker")
// ====================================================================

const PROFILE = process.env.MAIL_WORKER_PROFILE_NAME || "mail-worker";
const INTERVAL_MS = Math.max(
  15_000,
  Number(process.env.MAIL_WORKER_INTERVAL_MS || 60_000),
);
const CONCURRENCY = Math.max(
  1,
  Number(process.env.MAIL_WORKER_CONCURRENCY || 2),
);
const STALE_MIN = Math.max(0, Number(process.env.MAIL_WORKER_STALE_MIN || 5));
const LOOKBACK_HOURS = Math.max(
  1,
  Number(process.env.MAIL_WORKER_LOOKBACK_HOURS || 48),
);
const MAIL_WAIT_MS = Math.max(
  3_000,
  Number(process.env.MAIL_WORKER_MAIL_WAIT_MS || 8_000),
);
const BATCH = Math.max(1, Number(process.env.MAIL_WORKER_BATCH || 20));

let stopping = false;

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[mail-worker] ${msg}`);
}

async function heartbeat(status: "idle" | "busy", stage?: string) {
  await setWorkerHeartbeat({
    profile: PROFILE,
    status,
    stage,
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
}

// Aktivatsiya kutayotgan, "eskirgan" (inline bilan to'qnashmaydigan) arizachilar.
async function pendingApplicants() {
  const now = Date.now();
  const staleBefore = new Date(now - STALE_MIN * 60_000);
  const lookbackAfter = new Date(now - LOOKBACK_HOURS * 60 * 60_000);

  return prisma.applicant.findMany({
    where: {
      activatedAt: null,
      activationStatus: { in: ["pending", "failed"] },
      generatedEmail: { not: null },
      registerFinishedAt: { lte: staleBefore, gte: lookbackAfter },
    },
    select: {
      id: true,
      groupId: true,
      surname: true,
      name: true,
      passportNumber: true,
      nationality: true,
      gender: true,
      birthdate: true,
      passportValidity: true,
      phone: true,
      email: true,
      generatedEmail: true,
      profileKey: true,
    },
    orderBy: { registerFinishedAt: "asc" },
    take: BATCH,
  });
}

type PendingApplicant = Awaited<ReturnType<typeof pendingApplicants>>[number];

// Bitta arizachi uchun: xatni qisqa kutadi, kelsa linkni ochadi.
async function processOne(a: PendingApplicant): Promise<void> {
  const profileKey = a.generatedEmail || a.email || a.profileKey || null;
  const startedAt = new Date();

  const act = await runActivation(toAutomationInput(a), {
    profileKey,
    mailWaitMs: MAIL_WAIT_MS,
    mailPollMs: MAIL_WAIT_MS,
  });
  const finishedAt = new Date();

  if (act.ok && act.link) {
    // Aktivatsiya bajarildi — to'liq REGISTERED.
    await prisma.applicant
      .update({
        where: { id: a.id },
        data: {
          status: ApplicantStatus.REGISTERED,
          activationStatus: "activated",
          activationEmailTo: act.to,
          activationLink: act.link,
          activationSentAt: startedAt,
          activatedAt: finishedAt,
          resultNote: `Aktivatsiya tugadi (mail-worker): ${act.note}`,
        },
      })
      .catch(() => {});

    await prisma.automationLog
      .create({
        data: {
          applicantId: a.id,
          groupId: a.groupId,
          stage: "activation",
          attempt: 1,
          ok: true,
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          note: `mail-worker: ${act.note}`,
          url: act.link,
          finalUrl: act.link,
          visitedUrls: act.link,
          workerProfile: PROFILE,
          proxyServer: act.proxyServer,
          proxyCountry: act.proxyCountry,
          proxySession: act.proxySession,
          exitIp: act.exitIp,
          statusCode: act.statusCode,
          navMs: act.navMs,
          pageError: act.pageError,
          requestedAt: act.requestedAt ? new Date(act.requestedAt) : null,
          openedAt: act.openedAt ? new Date(act.openedAt) : null,
          startedAt,
          finishedAt,
        },
      })
      .catch(() => {});

    log(`arizachi #${a.id} (${profileKey}): [OK] aktivlashtirildi`);
    return;
  }

  // Xat hali yo'q yoki link yaroqsiz — holatni 'failed' qoldiramiz, keyingi
  // siklda qayta uriniladi. Brauzer ochilmagan bo'lsa (xat yo'q) — jim o'tamiz.
  const isLinkProblem = Boolean(act.link);
  await prisma.applicant
    .update({
      where: { id: a.id },
      data: {
        activationStatus: "failed",
        activationEmailTo: act.to ?? undefined,
        resultNote: `Aktivatsiya kutilmoqda (mail-worker): ${act.note}`,
      },
    })
    .catch(() => {});

  log(
    `arizachi #${a.id} (${profileKey}): ${
      isLinkProblem ? "[!] link muammosi" : "[..] xat hali yo'q"
    } - ${act.note}`,
  );
}

async function runCycle(): Promise<void> {
  const list = await pendingApplicants();
  if (list.length === 0) {
    log("aktivatsiya kutayotgan arizachi yo'q — kutilmoqda");
    return;
  }

  log(`${list.length} ta arizachi tekshirilmoqda (parallel: ${CONCURRENCY})`);

  for (let i = 0; i < list.length; i += CONCURRENCY) {
    if (stopping) break;
    const batch = list.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (a) => {
        try {
          await processOne(a);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log(`arizachi #${a.id} xato: ${msg.slice(0, 200)}`);
        }
      }),
    );
  }
}

async function loop(): Promise<void> {
  const cfg = getImapConfig();
  log(
    `started — interval ${Math.round(INTERVAL_MS / 1000)}s, stale ${STALE_MIN}m, ` +
      `lookback ${LOOKBACK_HOURS}h` +
      (cfg ? `, IMAP ${cfg.user}@${cfg.host}` : ""),
  );

  if (!isMailListenerEnabled()) {
    log(
      "IMAP sozlanmagan (.env IMAP_HOST/IMAP_USER/IMAP_PASSWORD) — bo'sh aylanadi.",
    );
  }

  // Idle heartbeat (bo'sh turganda ham monitoringda ko'rinsin).
  const hb = setInterval(() => heartbeat("idle"), 20_000);

  while (!stopping) {
    const startedAt = Date.now();
    if (isMailListenerEnabled()) {
      await heartbeat("busy", "mail-check");
      try {
        await runCycle();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`sikl xatosi: ${msg.slice(0, 200)}`);
      }
      await heartbeat("idle");
    }

    if (stopping) break;
    const elapsed = Date.now() - startedAt;
    const wait = Math.max(0, INTERVAL_MS - elapsed);
    await sleep(wait);
  }

  clearInterval(hb);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
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
    console.error("[mail-worker] fatal:", e);
    process.exit(1);
  });
