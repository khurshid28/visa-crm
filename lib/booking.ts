// Booking (zakas) bilan bog'liq umumiy logika.
// API route'lar ham, Telegram bot ham shu funksiyalarni chaqiradi.
// Shu sabab Next.js'ga bog'liq narsalar (NextResponse) bu yerda yo'q.

import { promises as fs } from "fs";
import path from "path";
import { prisma } from "./prisma";
import { ApplicantStatus, GroupStatus } from "@prisma/client";
import {
  runBooking,
  runActivation,
  checkSlotOpen,
  type AutomationApplicant,
} from "./automation";
import { buildApplicantPdf } from "./pdf";
import {
  parseApplicantsFromBuffer,
  isComplete,
  missingFieldLabels,
  type ParsedApplicant,
} from "./excel";
import { buildEmail, buildPassword } from "./email";
import {
  dispatchGroupDocuments,
  isTelegramConfigured,
  type TelegramDocument,
} from "./telegram";
import { logBookStep } from "./log";
import { ensureProxyHealthy } from "./proxy";
import { loadSettingsIntoEnv } from "./settings";

// Yuklangan Excel/CSV fayllar saqlanadigan papka (loyiha ildizida).
const IMPORTS_DIR = path.join(process.cwd(), "uploads", "imports");

// Yuklangan faylni diskka saqlaydi va nisbiy yo'lini qaytaradi.
// Nom: <groupId>-<vaqt>-<asl-nom>. Yozish muvaffaqiyatsiz bo'lsa relPath = null.
async function saveImportFile(
  groupId: number,
  buf: Buffer,
  fileName?: string,
): Promise<{ relPath: string | null }> {
  try {
    await fs.mkdir(IMPORTS_DIR, { recursive: true });
    const safe = (fileName || "fayl.xlsx")
      .replace(/[^\w.\-]+/g, "_")
      .slice(-80);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const diskName = `${groupId}-${stamp}-${safe}`;
    await fs.writeFile(path.join(IMPORTS_DIR, diskName), buf);
    return { relPath: `uploads/imports/${diskName}` };
  } catch {
    // Fayl saqlanmasa ham import davom etadi (DB yozuvi muhimroq).
    return { relPath: null };
  }
}

// Manba (kim/qayerdan) — tarix yozuvlari uchun umumiy meta.
export type ActionMeta = {
  source?: "web" | "bot" | "system";
  userId?: string | null;
  username?: string | null;
  note?: string | null;
};

// Guruh statusini o'zgartiradi va o'zgarishni GroupStatusLog'ga yozadi.
// Hech qaysi status o'zgarishi yo'qolmaydi.
async function changeGroupStatus(
  groupId: number,
  toStatus: GroupStatus,
  extra: Record<string, unknown>,
  meta: ActionMeta = {},
) {
  const current = await prisma.group.findUnique({
    where: { id: groupId },
    select: { status: true },
  });
  const updated = await prisma.group.update({
    where: { id: groupId },
    data: { status: toStatus, ...extra },
  });
  await prisma.groupStatusLog.create({
    data: {
      groupId,
      fromStatus: current?.status ?? null,
      toStatus,
      source: meta.source ?? "web",
      note: meta.note ?? null,
      userId: meta.userId ?? null,
      username: meta.username ?? null,
    },
  });
  return updated;
}

export type Stage = "register" | "order";

export function toAutomationInput(a: {
  surname: string;
  name: string;
  passportNumber: string;
  nationality: string | null;
  gender: string | null;
  birthdate: string | null;
  passportValidity: string | null;
  phone: string | null;
  email: string | null;
  generatedEmail: string | null;
}): AutomationApplicant {
  return {
    surname: a.surname,
    name: a.name,
    passportNumber: a.passportNumber,
    nationality: a.nationality,
    gender: a.gender,
    birthdate: a.birthdate,
    passportValidity: a.passportValidity,
    phone: a.phone,
    email: a.email,
    generatedEmail: a.generatedEmail,
  };
}

function nextStatusFor(stage: Stage): ApplicantStatus {
  return stage === "order"
    ? ApplicantStatus.ORDERED
    : ApplicantStatus.REGISTERED;
}

// Bir bosqich uchun maksimal urinishlar soni (.env: ORDER_MAX_ATTEMPTS).
function maxAttempts(): number {
  const n = Number(process.env.ORDER_MAX_ATTEMPTS || 3);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

// Register necha soatdan keyin "eskirgan" hisoblanadi (.env: REGISTER_TTL_HOURS).
function registerTtlMs(): number {
  const h = Number(process.env.REGISTER_TTL_HOURS || 24);
  return (Number.isFinite(h) && h > 0 ? h : 24) * 3600 * 1000;
}

type ApplicantRow = Awaited<ReturnType<typeof prisma.applicant.findUnique>>;

// Bitta arizachi, bitta bosqich — 3 martagacha urinadi, har urinishni
// AutomationLog'ga yozadi, vaqt (ms) va status'ni saqlaydi.
// stage: queue bosqichlari (register/order) + ichki "login" bosqichi.
async function runStageWithRetry(
  applicant: NonNullable<ApplicantRow>,
  stage: "register" | "login" | "order",
  workerProfile?: string | null,
): Promise<{
  ok: boolean;
  ref: string | null;
  note: string;
  attempts: number;
  durationMs: number;
}> {
  // SOZLAMALAR: proksi/headless/timeout qiymatlari bazadan keladi. Har bosqich
  // oldidan eng yangi sozlamani process.env'ga yuklaymiz (keshlangan, ~5s).
  await loadSettingsIntoEnv();

  const limit = maxAttempts();
  const profileKey = applicant.generatedEmail || applicant.email || null;
  const input = toAutomationInput(applicant);

  // PROKSI PREFLIGHT: proksi yoqilgan-u o'lik (HTTP 402 balans / ulanmaydi)
  // bo'lsa — BEHUDA Chrome ochmaymiz (3 marta urinish = 3 ta bo'sh brauzer +
  // CPU). Bitta aniq AutomationLog yozib, darrov to'xtaymiz. Natija keshlangan
  // (lib/proxy.ts), shuning uchun har job proksiga urmaydi.
  const ph = await ensureProxyHealthy();
  if (!ph.ok) {
    const startedAt = new Date();
    await prisma.automationLog
      .create({
        data: {
          applicantId: applicant.id,
          groupId: applicant.groupId,
          stage,
          attempt: 1,
          ok: false,
          durationMs: 0,
          note: ph.reason,
          workerProfile: workerProfile ?? null,
          statusCode: ph.status ?? null,
          proxyServer:
            (process.env.PROXY_HOST || "").trim() &&
            (process.env.PROXY_PORT || "").trim()
              ? `${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`
              : null,
          startedAt,
          finishedAt: new Date(),
        },
      })
      .catch(() => {});
    return {
      ok: false,
      ref: null,
      note: ph.reason,
      attempts: 0,
      durationMs: 0,
    };
  }

  let lastNote = "";
  let lastRef: string | null = null;
  let ok = false;
  let attemptUsed = 0;
  let durationMs = 0;

  for (let attempt = 1; attempt <= limit; attempt++) {
    attemptUsed = attempt;
    const startedAt = new Date();
    const t0 = Date.now();
    const result = await runBooking(stage, input, { profileKey });
    durationMs = Date.now() - t0;
    const finishedAt = new Date();

    lastNote = result.note;
    lastRef = result.ref ?? lastRef;
    ok = result.ok;

    // Chiroyli, rangli terminal log (worker oqimini kuzatish uchun).
    logBookStep({
      stage,
      user: profileKey,
      ok,
      attempt,
      maxAttempts: limit,
      statusCode: result.statusCode,
      exitIp: result.exitIp,
      proxyServer: result.proxyServer,
      proxyCountry: result.proxyCountry,
      proxySession: result.proxySession,
      requestedAt: result.requestedAt,
      openedAt: result.openedAt,
      navMs: result.navMs,
      durationMs,
      pageError: result.pageError,
      note: result.note,
    });

    await prisma.automationLog
      .create({
        data: {
          applicantId: applicant.id,
          groupId: applicant.groupId,
          stage,
          attempt,
          ok,
          durationMs,
          note: `${result.note}${ok ? "" : ` (urinish ${attempt}/${limit})`}`,
          url: result.url || null,
          finalUrl: result.finalUrl || null,
          visitedUrls: result.visitedUrls.length
            ? result.visitedUrls.join("\n")
            : null,
          workerProfile: workerProfile ?? null,
          proxyServer: result.proxyServer,
          proxyCountry: result.proxyCountry,
          proxySession: result.proxySession,
          exitIp: result.exitIp,
          statusCode: result.statusCode,
          navMs: result.navMs,
          pageError: result.pageError,
          requestedAt: result.requestedAt ? new Date(result.requestedAt) : null,
          openedAt: result.openedAt ? new Date(result.openedAt) : null,
          startedAt,
          finishedAt,
        },
      })
      .catch(() => {});

    if (ok) break;
  }

  return {
    ok,
    ref: lastRef,
    note: lastNote,
    attempts: attemptUsed,
    durationMs,
  };
}

// Register eskirgan (yoki yo'q) bo'lsa true qaytaradi — qayta register kerak.
function registerStale(applicant: NonNullable<ApplicantRow>): boolean {
  if (!applicant.registerFinishedAt) return true;
  return Date.now() - applicant.registerFinishedAt.getTime() > registerTtlMs();
}

// Bitta arizachini bitta bosqichdan o'tkazadi (retry + vaqt + log bilan).
// order bosqichida: register eskirgan/yo'q bo'lsa avval qayta register qiladi.
async function processApplicant(
  applicantId: number,
  stage: Stage,
  workerProfile?: string | null,
): Promise<{
  ok: boolean;
  ref: string | null;
  note: string;
  reRegistered: boolean;
}> {
  let applicant = await prisma.applicant.findUnique({
    where: { id: applicantId },
  });
  if (!applicant) {
    return {
      ok: false,
      ref: null,
      note: "Arizachi topilmadi",
      reRegistered: false,
    };
  }

  let reRegistered = false;

  // order: register eskirgan bo'lsa — avval qayta register qilamiz.
  if (stage === "order" && registerStale(applicant)) {
    const regStart = new Date();
    const reg = await runStageWithRetry(applicant, "register", workerProfile);
    await prisma.applicant.update({
      where: { id: applicant.id },
      data: {
        registerStartedAt: regStart,
        registerFinishedAt: new Date(),
        registerDurationMs: reg.durationMs,
        registerAttempts: { increment: reg.attempts },
        status: reg.ok ? ApplicantStatus.REGISTERED : ApplicantStatus.FAILED,
        appointmentRef: reg.ref ?? applicant.appointmentRef,
        resultNote: reg.ok
          ? `Qayta register: ${reg.note}`
          : `Qayta register bo'lmadi: ${reg.note}`,
      },
    });
    reRegistered = true;
    if (!reg.ok) {
      return {
        ok: false,
        ref: reg.ref,
        note: `Qayta register bo'lmadi: ${reg.note}`,
        reRegistered,
      };
    }
    applicant = await prisma.applicant.findUnique({
      where: { id: applicant.id },
    });
    if (!applicant) {
      return { ok: false, ref: null, note: "Arizachi topilmadi", reRegistered };
    }
  }

  // order: LOGIN (token olish) — register'dan keyin, order'dan oldin.
  // Bir xil profil + bir xil sticky IP => sessiya/token saqlanadi.
  // Faqat BOOKING_LOGIN_URL sozlangan bo'lsa ishlaydi (aks holda o'tkaziladi).
  if (stage === "order" && (process.env.BOOKING_LOGIN_URL || "").trim()) {
    const loginStart = new Date();
    const login = await runStageWithRetry(applicant, "login", workerProfile);
    await prisma.automationLog
      .create({
        data: {
          applicantId: applicant.id,
          groupId: applicant.groupId,
          stage: "login",
          attempt: login.attempts,
          ok: login.ok,
          durationMs: login.durationMs,
          note: login.note,
          workerProfile: workerProfile ?? null,
          startedAt: loginStart,
          finishedAt: new Date(),
        },
      })
      .catch(() => {});
    if (!login.ok) {
      await prisma.applicant.update({
        where: { id: applicant.id },
        data: {
          status: ApplicantStatus.FAILED,
          resultNote: `Login bo'lmadi: ${login.note}`,
        },
      });
      return {
        ok: false,
        ref: login.ref,
        note: `Login bo'lmadi: ${login.note}`,
        reRegistered,
      };
    }
  }

  const startedAt = new Date();
  const out = await runStageWithRetry(applicant, stage, workerProfile);
  const finishedAt = new Date();

  const failedNote = `Bo'lmadi (${out.attempts} urinish): ${out.note}`;

  // --- REGISTER: muvaffaqiyatli bo'lsa, gmail aktivatsiyasini bajaramiz.
  //     Aktivatsiya tugamaguncha register TO'LIQ hisoblanmaydi.
  if (stage === "register") {
    if (!out.ok) {
      await prisma.applicant.update({
        where: { id: applicant.id },
        data: {
          registerStartedAt: startedAt,
          registerFinishedAt: finishedAt,
          registerDurationMs: out.durationMs,
          registerAttempts: { increment: out.attempts },
          profileKey:
            applicant.generatedEmail || applicant.email || applicant.profileKey,
          status: ApplicantStatus.FAILED,
          appointmentRef: out.ref ?? applicant.appointmentRef,
          resultNote: failedNote,
          activationStatus: "none",
        },
      });
      return { ok: false, ref: out.ref, note: failedNote, reRegistered };
    }

    // Forma yuborildi — endi gmail'dagi aktivatsiya linkini kutamiz/ochamiz.
    const profileKey =
      applicant.generatedEmail || applicant.email || applicant.profileKey;
    await prisma.applicant.update({
      where: { id: applicant.id },
      data: { activationStatus: "pending" },
    });

    const actStart = new Date();
    const act = await runActivation(toAutomationInput(applicant), {
      profileKey,
    });
    const actEnd = new Date();

    // Aktivatsiya register bilan BIR XIL session (profil + IP) da ishladi.
    // Log'da exitIp/proxySession register'niki bilan bir xil bo'lishi kerak.
    logBookStep({
      stage: "activation",
      user: profileKey,
      ok: act.ok,
      statusCode: act.statusCode,
      exitIp: act.exitIp,
      proxyServer: act.proxyServer,
      proxyCountry: act.proxyCountry,
      proxySession: act.proxySession,
      requestedAt: act.requestedAt,
      openedAt: act.openedAt,
      navMs: act.navMs,
      durationMs: actEnd.getTime() - actStart.getTime(),
      pageError: act.pageError,
      note: act.note,
    });

    await prisma.automationLog
      .create({
        data: {
          applicantId: applicant.id,
          groupId: applicant.groupId,
          stage: "activation",
          attempt: 1,
          ok: act.ok,
          durationMs: actEnd.getTime() - actStart.getTime(),
          note: act.note,
          url: act.link ?? null,
          finalUrl: act.link ?? null,
          visitedUrls: act.link ?? null,
          workerProfile: workerProfile ?? null,
          proxyServer: act.proxyServer,
          proxyCountry: act.proxyCountry,
          proxySession: act.proxySession,
          exitIp: act.exitIp,
          statusCode: act.statusCode,
          navMs: act.navMs,
          pageError: act.pageError,
          requestedAt: act.requestedAt ? new Date(act.requestedAt) : null,
          openedAt: act.openedAt ? new Date(act.openedAt) : null,
          startedAt: actStart,
          finishedAt: actEnd,
        },
      })
      .catch(() => {});

    await prisma.applicant.update({
      where: { id: applicant.id },
      data: {
        registerStartedAt: startedAt,
        registerFinishedAt: finishedAt,
        registerDurationMs: out.durationMs,
        registerAttempts: { increment: out.attempts },
        profileKey,
        appointmentRef: out.ref ?? applicant.appointmentRef,
        // Faqat aktivatsiya muvaffaqiyatli bo'lsa REGISTERED (to'liq tugadi).
        status: act.ok ? ApplicantStatus.REGISTERED : ApplicantStatus.FAILED,
        activationStatus: act.ok ? "activated" : "failed",
        activationEmailTo: act.to,
        activationLink: act.link,
        activationSentAt: act.link ? actStart : null,
        activatedAt: act.ok ? actEnd : null,
        resultNote: act.ok
          ? `Ro'yxat + aktivatsiya tugadi: ${act.note}`
          : `Register bo'ldi, lekin aktivatsiya bo'lmadi: ${act.note}`,
      },
    });

    return {
      ok: act.ok,
      ref: out.ref,
      note: act.ok
        ? `Ro'yxat + aktivatsiya tugadi`
        : `Aktivatsiya bo'lmadi: ${act.note}`,
      reRegistered,
    };
  }

  // --- ORDER: oddiy yo'l.
  const timingData = {
    orderStartedAt: startedAt,
    orderFinishedAt: finishedAt,
    orderDurationMs: out.durationMs,
    orderAttempts: { increment: out.attempts },
  };

  await prisma.applicant.update({
    where: { id: applicant.id },
    data: {
      ...timingData,
      profileKey:
        applicant.generatedEmail || applicant.email || applicant.profileKey,
      status: out.ok ? nextStatusFor(stage) : ApplicantStatus.FAILED,
      appointmentRef: out.ref ?? applicant.appointmentRef,
      resultNote: out.ok ? out.note : failedNote,
    },
  });

  return {
    ok: out.ok,
    ref: out.ref,
    note: out.ok ? out.note : failedNote,
    reRegistered,
  };
}

// ── QO'LDA TEKSHIRISH (bosh dashboard paneli) ───────────────────────
//  Bitta userni alohida login/activation qilib tekshirish. register/order
//  oqimiga TEGMAYDI — faqat o'sha userning gmail profilida (sticky IP)
//  amal bajaradi va natijani AutomationLog'ga yozadi. Worker bajaradi.
export type BookStage = "register" | "order" | "login" | "activation";

// Standalone LOGIN tekshiruvi — userning gmail/parol bilan saytga kiradi.
// runStageWithRetry o'zi AutomationLog (stage="login") yozadi.
async function runStandaloneLogin(
  applicant: NonNullable<ApplicantRow>,
  workerProfile?: string | null,
): Promise<{ ok: boolean; ref: string | null; note: string }> {
  if (!(process.env.BOOKING_LOGIN_URL || "").trim()) {
    const note = "Login URL sozlanmagan (.env: BOOKING_LOGIN_URL)";
    await prisma.applicant
      .update({ where: { id: applicant.id }, data: { resultNote: note } })
      .catch(() => {});
    return { ok: false, ref: null, note };
  }
  const login = await runStageWithRetry(applicant, "login", workerProfile);
  await prisma.applicant
    .update({
      where: { id: applicant.id },
      data: {
        resultNote: login.ok
          ? `Login tekshiruvi: muvaffaqiyatli (${login.note})`
          : `Login tekshiruvi: bo'lmadi (${login.note})`,
      },
    })
    .catch(() => {});
  return { ok: login.ok, ref: login.ref, note: login.note };
}

// Standalone AKTIVATSIYA — userning gmailiga kelgan linkni qayta ochadi
// (yoki kutadi). register oqimidagi aktivatsiya bilan bir xil mantiq, alohida.
async function runStandaloneActivation(
  applicant: NonNullable<ApplicantRow>,
  workerProfile?: string | null,
): Promise<{ ok: boolean; ref: string | null; note: string }> {
  const profileKey =
    applicant.generatedEmail || applicant.email || applicant.profileKey;
  await prisma.applicant
    .update({
      where: { id: applicant.id },
      data: { activationStatus: "pending" },
    })
    .catch(() => {});

  const actStart = new Date();
  const act = await runActivation(toAutomationInput(applicant), { profileKey });
  const actEnd = new Date();

  logBookStep({
    stage: "activation",
    user: profileKey,
    ok: act.ok,
    statusCode: act.statusCode,
    exitIp: act.exitIp,
    proxyServer: act.proxyServer,
    proxyCountry: act.proxyCountry,
    proxySession: act.proxySession,
    requestedAt: act.requestedAt,
    openedAt: act.openedAt,
    navMs: act.navMs,
    durationMs: actEnd.getTime() - actStart.getTime(),
    pageError: act.pageError,
    note: act.note,
  });

  await prisma.automationLog
    .create({
      data: {
        applicantId: applicant.id,
        groupId: applicant.groupId,
        stage: "activation",
        attempt: 1,
        ok: act.ok,
        durationMs: actEnd.getTime() - actStart.getTime(),
        note: act.note,
        url: act.link ?? null,
        finalUrl: act.link ?? null,
        visitedUrls: act.link ?? null,
        workerProfile: workerProfile ?? null,
        proxyServer: act.proxyServer,
        proxyCountry: act.proxyCountry,
        proxySession: act.proxySession,
        exitIp: act.exitIp,
        statusCode: act.statusCode,
        navMs: act.navMs,
        pageError: act.pageError,
        requestedAt: act.requestedAt ? new Date(act.requestedAt) : null,
        openedAt: act.openedAt ? new Date(act.openedAt) : null,
        startedAt: actStart,
        finishedAt: actEnd,
      },
    })
    .catch(() => {});

  await prisma.applicant
    .update({
      where: { id: applicant.id },
      data: {
        activationStatus: act.ok ? "activated" : "failed",
        activationEmailTo: act.to ?? applicant.activationEmailTo,
        activationLink: act.link ?? applicant.activationLink,
        activationSentAt: act.link ? actStart : applicant.activationSentAt,
        activatedAt: act.ok ? actEnd : applicant.activatedAt,
        resultNote: act.ok
          ? `Aktivatsiya tekshiruvi: tasdiqlandi (${act.note})`
          : `Aktivatsiya tekshiruvi: bo'lmadi (${act.note})`,
      },
    })
    .catch(() => {});

  return { ok: act.ok, ref: null, note: act.note };
}

// Bitta arizachini bitta bosqichdan o'tkazadi (tashqi API / worker uchun).
//  register/order — to'liq oqim (processApplicant).
//  login/activation — alohida tekshiruv (qo'lda dashboard paneli).
export async function bookApplicant(
  applicantId: number,
  stage: BookStage,
  workerProfile?: string | null,
) {
  const applicant = await prisma.applicant.findUnique({
    where: { id: applicantId },
  });
  if (!applicant) return null;

  let out: { ok: boolean; ref: string | null; note: string };
  if (stage === "login") {
    out = await runStandaloneLogin(applicant, workerProfile);
  } else if (stage === "activation") {
    out = await runStandaloneActivation(applicant, workerProfile);
  } else {
    out = await processApplicant(applicantId, stage, workerProfile);
  }

  const updated = await prisma.applicant.findUnique({
    where: { id: applicantId },
  });
  return {
    result: { ok: out.ok, ref: out.ref, note: out.note },
    applicant: updated ?? applicant,
  };
}

export type GroupBookingResult = {
  stage: Stage;
  attempt: number;
  processed: number;
  succeeded: number;
  failedCount: number;
  slotBlocked?: string; // "order" bo'lib, saytda slot ochiq bo'lmasa — sabab
  failed: { id: number; name: string; passportNumber: string; note: string }[];
  results: {
    id: number;
    name: string;
    passportNumber: string;
    ok: boolean;
    note: string;
  }[];
};

// Butun guruhni bitta bosqichdan o'tkazadi va RunAttempt yozuvini yaratadi.
// `source` — "web" yoki "bot".
export async function bookGroup(
  groupId: number,
  stage: Stage,
  source: "web" | "bot" | "system" = "web",
  opts: { skipSlotCheck?: boolean } = {},
): Promise<GroupBookingResult | null> {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return null;

  // "order" (buyurtma / run-2) — avval saytda slot ochiqligini Playwright
  // bilan tekshiramiz. Ochiq bo'lmasa, hech qanday buyurtma yuborilmaydi.
  if (stage === "order" && !opts.skipSlotCheck) {
    const slot = await checkSlotOpen();
    if (!slot.open) {
      await prisma.runAttempt.create({
        data: {
          groupId,
          attempt:
            (await prisma.runAttempt.count({ where: { groupId, stage } })) + 1,
          stage,
          total: 0,
          succeeded: 0,
          failed: 0,
          source,
          note: `Slot ochiq emas: ${slot.note}`,
        },
      });
      return {
        stage,
        attempt: await prisma.runAttempt.count({ where: { groupId, stage } }),
        processed: 0,
        succeeded: 0,
        failedCount: 0,
        slotBlocked: slot.note,
        failed: [],
        results: [],
      };
    }
  }

  const applicants = await prisma.applicant.findMany({
    where: {
      groupId,
      status:
        stage === "order"
          ? ApplicantStatus.REGISTERED
          : {
              in: [
                ApplicantStatus.NEW,
                ApplicantStatus.EDITED,
                ApplicantStatus.BOOKING,
              ],
            },
    },
  });

  const results: GroupBookingResult["results"] = [];
  for (const a of applicants) {
    const out = await processApplicant(
      a.id,
      stage,
      source === "system" ? null : source,
    );
    results.push({
      id: a.id,
      name: `${a.surname} ${a.name}`,
      passportNumber: a.passportNumber,
      ok: out.ok,
      note: out.note,
    });
  }

  const failed = results.filter((r) => !r.ok);
  const succeeded = results.length - failed.length;

  // Shu guruh + bosqich bo'yicha urinish tartib raqami (run-1, run-2...).
  const prior = await prisma.runAttempt.count({
    where: { groupId, stage },
  });
  const attempt = prior + 1;

  await prisma.runAttempt.create({
    data: {
      groupId,
      attempt,
      stage,
      total: results.length,
      succeeded,
      failed: failed.length,
      source,
      note: failed.length
        ? `Xato: ${failed
            .map((f) => f.name)
            .slice(0, 10)
            .join(", ")}`
        : "Barchasi muvaffaqiyatli",
    },
  });

  if (stage === "register") {
    await changeGroupStatus(
      groupId,
      GroupStatus.SLOT_CLOSED,
      {},
      {
        source,
        note:
          `Ro'yxat (${attempt}-urinish): ${succeeded}/${results.length} muvaffaqiyatli. ` +
          "Slot ochilishini kutilmoqda",
      },
    );
  } else {
    await changeGroupStatus(
      groupId,
      failed.length === 0 && results.length > 0
        ? GroupStatus.DONE
        : GroupStatus.BOOKING,
      {},
      {
        source,
        note: `Buyurtma (${attempt}-urinish): ${succeeded}/${results.length} muvaffaqiyatli`,
      },
    );
  }

  return {
    stage,
    attempt,
    processed: results.length,
    succeeded,
    failedCount: failed.length,
    failed: failed.map((f) => ({
      id: f.id,
      name: f.name,
      passportNumber: f.passportNumber,
      note: f.note,
    })),
    results,
  };
}

export type GlobalOrderResult = {
  groups: number;
  registeredTotal: number;
  processed: number;
  succeeded: number;
  failed: number;
  details: Array<{
    groupId: number;
    processed: number;
    succeeded: number;
    failed: number;
  }>;
};

// Barcha guruhlardagi REGISTERED arizachilar uchun 2-bosqichni ishga tushiradi.
// Slot tekshiruvi tashqaridan bir marta qilingan bo'lishi uchun bookGroup'da skipSlotCheck=true.
export async function orderRegisteredAcrossGroups(
  source: "web" | "bot" | "system" = "system",
): Promise<GlobalOrderResult> {
  const grouped = await prisma.applicant.groupBy({
    by: ["groupId"],
    where: { status: ApplicantStatus.REGISTERED },
    _count: { _all: true },
  });

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const details: GlobalOrderResult["details"] = [];

  for (const g of grouped) {
    const out = await bookGroup(
      g.groupId,
      "order",
      source === "system" ? "bot" : source,
      {
        skipSlotCheck: true,
      },
    );
    if (!out) continue;
    processed += out.processed;
    succeeded += out.succeeded;
    failed += out.failedCount;
    details.push({
      groupId: g.groupId,
      processed: out.processed,
      succeeded: out.succeeded,
      failed: out.failedCount,
    });
  }

  return {
    groups: grouped.length,
    registeredTotal: grouped.reduce((a, b) => a + b._count._all, 0),
    processed,
    succeeded,
    failed,
    details,
  };
}

// ---- Slot (vaqt oynasi) boshqaruvi ----

export async function openSlot(
  groupId: number,
  closeAt?: Date | null,
  meta: ActionMeta = {},
) {
  return changeGroupStatus(
    groupId,
    GroupStatus.SLOT_OPEN,
    { slotOpenAt: new Date(), slotCloseAt: closeAt ?? null },
    {
      ...meta,
      note:
        meta.note ??
        (closeAt
          ? `Slot ochildi, yopilish: ${closeAt.toISOString()}`
          : "Slot ochildi"),
    },
  );
}

export async function closeSlot(groupId: number, meta: ActionMeta = {}) {
  return changeGroupStatus(
    groupId,
    GroupStatus.SLOT_CLOSED,
    { slotCloseAt: new Date() },
    { ...meta, note: meta.note ?? "Slot yopildi" },
  );
}

// ---- Excel/CSV import (web + bot uchun umumiy) ----

export type ImportResult = {
  imported: number;
  complete: number;
  reused: number; // bazada (boshqa guruhda) mavjud shaxslar
  skipped: number; // shu guruhda passport allaqachon bor — tashlandi
};

// Excel/CSV buffer'dan arizachilarni guruhga qo'shadi.
// Passport bo'yicha Person mavjud bo'lsa ulanadi, bo'lmasa yaratiladi.
// Shu guruhda allaqachon bor passportlar takror qo'shilmaydi.
// `meta` — import tarixini (ImportLog) yozish uchun manba ma'lumotlari.
export async function importApplicantsToGroup(
  groupId: number,
  buf: Buffer,
  meta: {
    fileName?: string;
    source?: "web" | "bot";
    userId?: string | null;
    username?: string | null;
  } = {},
): Promise<ImportResult | null> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { applicants: { select: { passportNumber: true } } },
  });
  if (!group) return null;

  // Yuklangan faylni diskda saqlaymiz (hech narsa yo'qolmasin).
  const saved = await saveImportFile(groupId, buf, meta.fileName);

  const parsed: ParsedApplicant[] = parseApplicantsFromBuffer(buf);
  if (parsed.length === 0) {
    await prisma.importLog.create({
      data: {
        groupId,
        fileName: meta.fileName ?? null,
        filePath: saved.relPath,
        fileSize: buf.byteLength,
        total: 0,
        imported: 0,
        complete: 0,
        reused: 0,
        skipped: 0,
        source: meta.source ?? "web",
        userId: meta.userId ?? null,
        username: meta.username ?? null,
      },
    });
    return { imported: 0, complete: 0, reused: 0, skipped: 0 };
  }

  const existingInGroup = new Set(
    group.applicants.map((a) => a.passportNumber),
  );
  const toCreate = parsed.filter(
    (a) => a.passportNumber && !existingInGroup.has(a.passportNumber),
  );
  const skipped = parsed.length - toCreate.length;

  const passports = toCreate.map((a) => a.passportNumber);
  const existingPersons = await prisma.person.findMany({
    where: { passportNumber: { in: passports } },
    select: { passportNumber: true },
  });
  const existingByPassport = new Set(
    existingPersons.map((p) => p.passportNumber),
  );

  for (const a of toCreate) {
    const created = await prisma.applicant.create({
      data: {
        group: { connect: { id: groupId } },
        surname: a.surname,
        name: a.name,
        passportNumber: a.passportNumber,
        nationality: a.nationality,
        gender: a.gender,
        birthdate: a.birthdate,
        passportValidity: a.passportValidity,
        phone: a.phone,
        email: a.email,
        source: a.source,
        subcategory: a.subcategory,
        city: a.city,
        category: a.category,
        price: a.price,
        bookDateFrom: a.bookDateFrom,
        bookDateTo: a.bookDateTo,
        regDaysBefore: a.regDaysBefore,
        groupLabel: a.groupLabel,
        complete: isComplete(a),
        person: {
          connectOrCreate: {
            where: { passportNumber: a.passportNumber },
            create: {
              passportNumber: a.passportNumber,
              surname: a.surname,
              name: a.name,
              nationality: a.nationality,
              gender: a.gender,
              birthdate: a.birthdate,
              passportValidity: a.passportValidity,
              phone: a.phone,
            },
          },
        },
      },
    });
    await prisma.applicant.update({
      where: { id: created.id },
      data: {
        generatedEmail: buildEmail(a.name, a.surname, created.id),
        generatedPassword: buildPassword(a.name, a.surname, a.passportNumber),
      },
    });
  }

  const result: ImportResult = {
    imported: toCreate.length,
    complete: toCreate.filter((a) => isComplete(a)).length,
    reused: toCreate.filter((a) => existingByPassport.has(a.passportNumber))
      .length,
    skipped,
  };

  await prisma.importLog.create({
    data: {
      groupId,
      fileName: meta.fileName ?? null,
      filePath: saved.relPath,
      fileSize: buf.byteLength,
      total: parsed.length,
      imported: result.imported,
      complete: result.complete,
      reused: result.reused,
      skipped: result.skipped,
      source: meta.source ?? "web",
      userId: meta.userId ?? null,
      username: meta.username ?? null,
    },
  });

  return result;
}

export type ImportPreview = {
  groupId: number;
  groupName: string;
  total: number; // fayldagi yaroqli qatorlar
  complete: number; // to'liq ma'lumotli
  willAdd: number; // qo'shiladigan (guruhda yo'q)
  skipped: number; // guruhda allaqachon bor
  names: string[]; // dastlabki bir nechta ism (ko'rsatish uchun)
  incomplete: { name: string; passportNumber: string; missing: string[] }[]; // chala qatorlar
};

// Faylni import qilMASDAN, faqat oldindan ko'rish (preview) ma'lumotini qaytaradi.
// Tasdiqlash bosqichida foydalanuvchiga nima qo'shilishini ko'rsatish uchun.
export async function previewApplicantsFile(
  groupId: number,
  buf: Buffer,
): Promise<ImportPreview | null> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { applicants: { select: { passportNumber: true } } },
  });
  if (!group) return null;

  const parsed: ParsedApplicant[] = parseApplicantsFromBuffer(buf);
  const existingInGroup = new Set(
    group.applicants.map((a) => a.passportNumber),
  );
  const toAdd = parsed.filter(
    (a) => a.passportNumber && !existingInGroup.has(a.passportNumber),
  );

  // Chala (majburiy maydonlari yetishmaydigan) qatorlarni aniqlaymiz.
  const incomplete = toAdd
    .filter((a) => !isComplete(a))
    .map((a) => ({
      name: `${a.surname} ${a.name}`.trim(),
      passportNumber: a.passportNumber,
      missing: missingFieldLabels(a),
    }));

  return {
    groupId,
    groupName: group.name,
    total: parsed.length,
    complete: parsed.filter((a) => isComplete(a)).length,
    willAdd: toAdd.length,
    skipped: parsed.length - toAdd.length,
    names: toAdd
      .slice(0, 8)
      .map((a) => `${a.surname} ${a.name}`.trim())
      .filter(Boolean),
    incomplete,
  };
}

// Oxirgi guruhlarni (inline tugmalar uchun) qaytaradi.
export async function getRecentGroups(
  take = 8,
): Promise<{ id: number; name: string; count: number }[]> {
  const groups = await prisma.group.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { applicants: true } } },
    take,
  });
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    count: g._count.applicants,
  }));
}

// ---- Arizachi (user/mijoz) qidirish va passport ----

export type ApplicantInfo = {
  id: number;
  groupId: number;
  groupName: string;
  surname: string;
  name: string;
  passportNumber: string;
  nationality: string | null;
  gender: string | null;
  birthdate: string | null;
  passportValidity: string | null;
  phone: string | null;
  generatedEmail: string | null;
  status: string;
  complete: boolean;
  hasPhoto: boolean;
};

// Arizachini id bo'yicha topadi (bot/web qidiruvi uchun).
export async function getApplicantById(
  id: number,
): Promise<ApplicantInfo | null> {
  const a = await prisma.applicant.findUnique({
    where: { id },
    include: {
      group: { select: { name: true } },
      person: { select: { photo: true } },
    },
  });
  if (!a) return null;
  return {
    id: a.id,
    groupId: a.groupId,
    groupName: a.group.name,
    surname: a.surname,
    name: a.name,
    passportNumber: a.passportNumber,
    nationality: a.nationality,
    gender: a.gender,
    birthdate: a.birthdate,
    passportValidity: a.passportValidity,
    phone: a.phone,
    generatedEmail: a.generatedEmail,
    status: a.status,
    complete: a.complete,
    hasPhoto: Boolean(a.person?.photo),
  };
}

// Arizachining passport raqami bo'yicha qidiradi (bir nechta natija bo'lishi mumkin).
export async function findApplicantsByPassport(
  passport: string,
): Promise<ApplicantInfo[]> {
  const list = await prisma.applicant.findMany({
    where: { passportNumber: { contains: passport } },
    include: {
      group: { select: { name: true } },
      person: { select: { photo: true } },
    },
    take: 10,
  });
  return list.map((a) => ({
    id: a.id,
    groupId: a.groupId,
    groupName: a.group.name,
    surname: a.surname,
    name: a.name,
    passportNumber: a.passportNumber,
    nationality: a.nationality,
    gender: a.gender,
    birthdate: a.birthdate,
    passportValidity: a.passportValidity,
    phone: a.phone,
    generatedEmail: a.generatedEmail,
    status: a.status,
    complete: a.complete,
    hasPhoto: Boolean(a.person?.photo),
  }));
}

// Arizachiga bog'langan shaxsga passport rasmini saqlaydi.
// Shaxs bo'lmasa, passport raqami bo'yicha ulaydi/yaratadi.
export async function savePassportPhotoForApplicant(
  applicantId: number,
  buf: Buffer,
  mime = "image/jpeg",
): Promise<{ personId: number } | null> {
  const applicant = await prisma.applicant.findUnique({
    where: { id: applicantId },
    select: { id: true, personId: true, passportNumber: true },
  });
  if (!applicant) return null;

  let personId = applicant.personId;
  if (!personId) {
    const person = await prisma.person.upsert({
      where: { passportNumber: applicant.passportNumber },
      update: {},
      create: {
        passportNumber: applicant.passportNumber,
        surname: "",
        name: "",
      },
    });
    personId = person.id;
    await prisma.applicant.update({
      where: { id: applicantId },
      data: { personId },
    });
  }

  await prisma.person.update({
    where: { id: personId },
    data: { photo: buf, photoMime: mime },
  });
  return { personId };
}

// ---- Statistika ----

export type GroupStats = {
  id: number;
  name: string;
  status: string;
  total: number;
  complete: number;
  registered: number;
  ordered: number; // ORDERED + BOOKED (PDF gacha yetgan)
  failed: number;
  attempts: number; // jami run soni
  registerRuns: number;
  orderRuns: number;
  slotOpenAt: Date | null;
  slotCloseAt: Date | null;
  fromCountry: string | null;
  toCountry: string | null;
};

export async function getGroupStats(
  groupId: number,
): Promise<GroupStats | null> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      applicants: true,
      runs: true,
      slot: { select: { fromCountry: true, toCountry: true } },
    },
  });
  if (!group) return null;

  const total = group.applicants.length;
  const complete = group.applicants.filter((a) => a.complete).length;
  const registered = group.applicants.filter(
    (a) => a.status === "REGISTERED",
  ).length;
  const ordered = group.applicants.filter(
    (a) => a.status === "ORDERED" || a.status === "BOOKED",
  ).length;
  const failed = group.applicants.filter((a) => a.status === "FAILED").length;

  return {
    id: group.id,
    name: group.name,
    status: group.status,
    total,
    complete,
    registered,
    ordered,
    failed,
    attempts: group.runs.length,
    registerRuns: group.runs.filter((r) => r.stage === "register").length,
    orderRuns: group.runs.filter((r) => r.stage === "order").length,
    slotOpenAt: group.slotOpenAt,
    slotCloseAt: group.slotCloseAt,
    fromCountry: group.slot?.fromCountry ?? null,
    toCountry: group.slot?.toCountry ?? null,
  };
}

// ---- Guruh PDF'larini Telegram'ga yuborish ----
// PDF gacha yetgan (ORDERED/BOOKED) arizachilar uchun PDF yaratib,
// info xabar bilan birga adminlarga ketma-ket (bittada qator) yuboradi.
export async function sendGroupPdfsToTelegram(groupId: number) {
  if (!isTelegramConfigured()) {
    throw new Error(
      "Telegram sozlanmagan (.env: TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_IDS)",
    );
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      applicants: {
        where: {
          status: { in: [ApplicantStatus.ORDERED, ApplicantStatus.BOOKED] },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!group) return null;

  const documents: TelegramDocument[] = [];
  for (const a of group.applicants) {
    const bytes = await buildApplicantPdf({
      ...a,
      group: { name: group.name },
    });
    documents.push({
      buffer: bytes,
      filename: `appointment-${a.id}.pdf`,
      caption: `${a.surname} ${a.name} · ${a.passportNumber}`,
    });
  }

  const infoMessage =
    `<b>${group.name}</b>\n` +
    `PDF tayyor: ${documents.length} ta arizachi\n` +
    `Status: ${group.status}`;

  const dispatch = await dispatchGroupDocuments({ infoMessage, documents });
  return { count: documents.length, dispatch };
}
