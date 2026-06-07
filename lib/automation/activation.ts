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
import { readExitIp } from "./page-utils";

export async function runActivation(
  applicant: AutomationApplicant,
  opts?: { profileKey?: string | null },
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

  const mail = await waitForActivationMail(toEmail);
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

    if (shouldLogExitIp()) {
      exitIp = await readExitIp(page);
    }

    const body = (
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")) || ""
    ).toLowerCase();

    await closeSession();
    closeSession = null;

    // Xatolik belgilari (link eskirgan/yaroqsiz bo'lsa).
    const failMarks = [
      "expired",
      "invalid",
      "not valid",
      "link has expired",
      "muddati",
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
        pageError: pageErrors.length
          ? pageErrors.slice(0, 10).join(" | ")
          : null,
      };
    }

    return {
      ok: true,
      link: mail.link,
      to: toEmail,
      note: "Aktivatsiya bajarildi (link ochildi)",
      ...baseMeta,
      exitIp,
      statusCode,
      requestedAt,
      openedAt,
      navMs,
      pageError: pageErrors.length ? pageErrors.slice(0, 10).join(" | ") : null,
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
