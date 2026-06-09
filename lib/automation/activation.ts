// ====================================================================
//  AKTIVATSIYA — register'dan keyin gmail aktivatsiya linkini ochish
// ====================================================================
//  Gmail qutidan userning aktivatsiya xatini kutadi, ichidagi linkni topadi
//  va USERNING profilida (register bilan BIR XIL profil + sticky IP) ochadi.
//   - IMAP sozlanmagan: ok=true, "o'tkazib yuborildi" (register bloklanmaydi).
//   - Xat topilmasa: ok=false (register to'liq hisoblanmaydi).
//   - Link ochilsa: ok=true, register to'liq tugadi.
// ====================================================================

import { proxyMetaFor, shouldLogExitIp } from "../proxy";
import type { AutomationApplicant, ActivationResult } from "./types";
import { openBrowserContext, profileDirFor } from "./browser";
import { readExitIp, dumpDebug } from "./page-utils";

export async function runActivation(
  applicant: AutomationApplicant,
  opts?: {
    profileKey?: string | null;
    // Xatni qancha kutish (ms) — standalone mail-worker qisqa (bir poll)
    // qiymat beradi, inline (booking) esa env default (3 daqiqa) ishlatadi.
    mailWaitMs?: number;
    mailPollMs?: number;
    // CDP profil bazasi — register bilan BIR XIL papka (aynan yaratilgan gmail
    // nomli papka) ishlatish uchun. register-full shu bazani uzatadi.
    cdpProfileBase?: string;
    // Aktivatsiya register SESSIYASINI qayta ishlatishi kerak — shuning uchun
    // default: profilni TOZALAMAYMIZ (env BOOKING_CDP_FRESH_PROFILE=true bo'lsa ham).
    cdpFreshProfile?: boolean;
    // Pochta poll'i har safar chaqiriladi (jonli "kutilmoqda..." progressi uchun).
    onMailPoll?: (info: {
      attempt: number;
      elapsedMs: number;
      remainingMs: number;
      newScanned: number;
    }) => void;
  },
): Promise<ActivationResult> {
  const toEmail = applicant.generatedEmail || applicant.email || null;
  // Aktivatsiya register bilan BIR XIL session (profil + sticky IP) ishlatadi.
  const profileKey = opts?.profileKey || toEmail || null;
  const pmeta = proxyMetaFor({ profileKey });
  // Bo'sh (proxy yo'q) natija uchun umumiy meta.
  const baseMeta = {
    proxyServer: pmeta?.server ?? null,
    proxyCountry: pmeta?.country ?? null,
    proxySession: pmeta?.session ?? null,
    exitIp: null as string | null,
    statusCode: null as number | null,
    requestedAt: null as string | null,
    openedAt: null as string | null,
    navMs: null as number | null,
    pageError: null as string | null,
  };

  if (!toEmail) {
    return {
      ok: false,
      link: null,
      to: null,
      note: "Email manzili yo'q",
      ...baseMeta,
    };
  }

  const { isMailListenerEnabled, waitForActivationMail } =
    await import("../mail-listener");

  if (!isMailListenerEnabled()) {
    // IMAP sozlanmagan — aktivatsiyani o'tkazib yuboramiz (register bloklanmasin).
    return {
      ok: true,
      link: null,
      to: toEmail,
      note: "Aktivatsiya o'tkazib yuborildi (IMAP sozlanmagan)",
      ...baseMeta,
    };
  }

  const mail = await waitForActivationMail(toEmail, {
    ...(opts?.mailWaitMs != null
      ? { timeoutMs: opts.mailWaitMs, pollMs: opts.mailPollMs }
      : {}),
    onPoll: opts?.onMailPoll,
  });
  if (!mail) {
    return {
      ok: false,
      link: null,
      to: toEmail,
      note: "Aktivatsiya xati topilmadi (gmail'da link kelmadi)",
      ...baseMeta,
    };
  }

  // Linkni userning profilida ochamiz (register bilan BIR XIL profil + IP).
  let closeSession: (() => Promise<void>) | null = null;
  let statusCode: number | null = null;
  let exitIp: string | null = null;
  let requestedAt: string | null = null;
  let openedAt: string | null = null;
  let navMs: number | null = null;
  const pageErrors: string[] = [];
  try {
    const session = await openBrowserContext(
      profileDirFor("register", profileKey),
      { profileKey },
      {
        cdpProfileBase: opts?.cdpProfileBase,
        // Aktivatsiya register sessiyasini (cookie/login) qayta ishlatadi —
        // shuning uchun profilni TOZALAMAYMIZ (default: false).
        cdpFreshProfile: opts?.cdpFreshProfile ?? false,
      },
    );
    closeSession = session.close;

    const page: import("playwright").Page = await session.context.newPage();
    page.on("pageerror", (e) => {
      pageErrors.push(`JS: ${e.message}`.slice(0, 200));
    });
    page.on("requestfailed", (req) => {
      const f = req.failure();
      pageErrors.push(
        `REQFAIL: ${req.url().slice(0, 80)} (${f?.errorText || "?"})`.slice(
          0,
          200,
        ),
      );
    });
    page.on("response", (res) => {
      const s = res.status();
      if (s >= 400) {
        pageErrors.push(`HTTP ${s}: ${res.url().slice(0, 80)}`.slice(0, 200));
      }
    });

    const t0 = Date.now();
    requestedAt = new Date(t0).toISOString();
    const response = await page.goto(mail.link, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    const t1 = Date.now();
    openedAt = new Date(t1).toISOString();
    navMs = t1 - t0;
    statusCode = response ? response.status() : null;
    await page
      .waitForLoadState("networkidle", { timeout: 10000 })
      .catch(() => {});
    // Aktivatsiya endpoint'i akkauntni faollashtirib, ko'pincha boshqa sahifaga
    // (login/success) YO'NALTIRADI — bu in-flight Angular bundle so'rovlarini
    // net::ERR_ABORTED qiladi (ZARARSIZ). Redirect joylashishini biroz kutamiz.
    await page.waitForTimeout(1500);
    const finalUrl = page.url();

    if (shouldLogExitIp()) {
      exitIp = await readExitIp(page);
    }

    const body = (
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")) || ""
    ).toLowerCase();

    // Aktivatsiya sahifasini debug uchun saqlaymiz (ko'rish/tekshirish uchun).
    await dumpDebug(page, "activation-result").catch(() => {});

    await closeSession();
    closeSession = null;

    // Redirect tufayli abort bo'lgan asset so'rovlari (net::ERR_ABORTED/CANCELED)
    // ZARARSIZ — ularni xatolar ro'yxatidan olib tashlaymiz (muvaffaqiyatni
    // xato qilib ko'rsatmasin). Cloudflare telemetriya 401'ini ham chiqaramiz.
    const realErrors = pageErrors.filter(
      (e) =>
        !e.includes("ERR_ABORTED") &&
        !e.includes("ERR_CANCELED") &&
        !e.includes("challenges.cloudflare.com"),
    );
    const errStr = realErrors.length
      ? realErrors.slice(0, 10).join(" | ")
      : null;

    // Xatolik belgilari (link eskirgan/yaroqsiz bo'lsa).
    const failMarks = [
      "link has expired",
      "link is invalid",
      "invalid link",
      "not valid",
      "muddati o'tgan",
      "muddati tugagan",
    ];
    if (failMarks.some((m) => body.includes(m))) {
      return {
        ok: false,
        link: mail.link,
        to: toEmail,
        note: "Aktivatsiya linki yaroqsiz/eskirgan",
        ...baseMeta,
        exitIp,
        statusCode,
        requestedAt,
        openedAt,
        navMs,
        pageError: errStr,
      };
    }

    // "Allaqachon faollashtirilgan" — bu ham MUVAFFAQIYAT (akkaunt faol).
    if (
      body.includes("already") &&
      (body.includes("activat") || body.includes("verif"))
    ) {
      return {
        ok: true,
        link: mail.link,
        to: toEmail,
        note: "Akkaunt allaqachon faollashtirilgan",
        ...baseMeta,
        exitIp,
        statusCode,
        requestedAt,
        openedAt,
        navMs,
        pageError: errStr,
      };
    }

    // Ijobiy tasdiq belgilari (akkaunt haqiqatan faollashdi).
    const successMarks = [
      "successfully activated",
      "account activated",
      "has been activated",
      "account has been created",
      "email verified",
      "email has been verified",
      "verification successful",
      "successfully verified",
      "activation successful",
      "thank you for verifying",
      "muvaffaqiyatli",
      "faollashtirildi",
    ];
    const confirmed = successMarks.some((m) => body.includes(m));
    // VFS aktivatsiyadan keyin login/dashboard sahifasiga yo'naltiradi.
    const onAuthPage = /\/login|\/dashboard/i.test(finalUrl);

    return {
      ok: true,
      link: mail.link,
      to: toEmail,
      note: confirmed
        ? "Aktivatsiya TASDIQLANDI (akkaunt faollashtirildi)"
        : onAuthPage
          ? "Aktivatsiya bajarildi (login sahifasiga yo'naltirildi)"
          : `Aktivatsiya bajarildi (link ochildi, HTTP ${statusCode ?? "?"})`,
      ...baseMeta,
      exitIp,
      statusCode,
      requestedAt,
      openedAt,
      navMs,
      pageError: errStr,
    };
  } catch (err) {
    if (closeSession) await closeSession().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    pageErrors.push(`FATAL: ${msg}`.slice(0, 200));
    return {
      ok: false,
      link: mail.link,
      to: toEmail,
      note: `Aktivatsiya xatosi: ${msg.slice(0, 200)}`,
      ...baseMeta,
      exitIp,
      statusCode,
      requestedAt,
      openedAt,
      navMs,
      pageError: pageErrors.length ? pageErrors.slice(0, 10).join(" | ") : null,
    };
  }
}
