// ====================================================================
//  REGISTER / ORDER — generic forma to'ldirgich (runBooking)
// ====================================================================
//  Ikki bosqich: "register" (ro'yxatdan o'tkazish) va "order" (buyurtma).
//  URL'lar .env dan keladi (BOOKING_REGISTER_URL / BOOKING_ORDER_URL).
//  Engine sahifadagi formani avtomatik topadi: har bir input/select ni
//  uning name/id/placeholder/label matni bo'yicha arizachi maydoniga moslaydi.
//  HECH QACHON exception tashlamaydi — har doim natija obyektini qaytaradi.
// ====================================================================

import { proxyMetaFor, shouldLogExitIp, type ProxyTarget } from "../proxy";
import type { AutomationApplicant, AutomationResult, Stage } from "./types";
import { humanPause } from "./human";
import { openBrowserContext, profileDirFor } from "./browser";
import {
  fillSmartField,
  waitForTurnstile,
  clickSubmit,
  readExitIp,
  extractRef,
} from "./page-utils";

// Har bir maydon uchun forma elementlarini topish kalit so'zlari (kichik harf).
const FIELD_KEYWORDS: Record<keyof AutomationApplicant, string[]> = {
  surname: ["surname", "lastname", "last_name", "familiya", "fname"],
  name: ["firstname", "first_name", "givenname", "given", "ism", "name"],
  passportNumber: ["passport", "pasport", "document", "docno", "passportno"],
  nationality: ["nationality", "country", "millat", "davlat", "citizenship"],
  gender: ["gender", "sex", "jins"],
  birthdate: ["birth", "dob", "tugilgan", "tug", "dateofbirth", "born"],
  passportValidity: ["validity", "expiry", "expire", "amal", "muddat", "valid"],
  phone: ["phone", "mobile", "tel", "telefon", "contact"],
  email: ["email", "e-mail", "mail", "pochta"],
  generatedEmail: ["systememail", "loginemail"],
};

function urlForStage(stage: Stage): string | null {
  let u: string | undefined;
  if (stage === "order") u = process.env.BOOKING_ORDER_URL;
  else if (stage === "login") u = process.env.BOOKING_LOGIN_URL;
  else u = process.env.BOOKING_REGISTER_URL;
  return u && u.trim() ? u.trim() : null;
}

function stageLabel(stage: Stage): string {
  if (stage === "order") return "Buyurtma";
  if (stage === "login") return "Login";
  return "Ro'yxat";
}

function stageEnvName(stage: Stage): string {
  if (stage === "order") return "ORDER";
  if (stage === "login") return "LOGIN";
  return "REGISTER";
}

/**
 * Bitta arizachi uchun bitta bosqichni bajaradi.
 * Playwright dinamik import qilinadi (build/serverless'ni buzmaslik uchun).
 */
export async function runBooking(
  stage: Stage,
  applicant: AutomationApplicant,
  opts?: { profileKey?: string | null },
): Promise<AutomationResult> {
  const url = urlForStage(stage);
  if (!url) {
    return {
      ok: false,
      ref: null,
      note: `URL sozlanmagan (.env: BOOKING_${stageEnvName(stage)}_URL)`,
      filled: [],
      url: "",
      finalUrl: "",
      visitedUrls: [],
      proxyServer: null,
      proxyCountry: null,
      proxySession: null,
      exitIp: null,
      statusCode: null,
      requestedAt: null,
      openedAt: null,
      navMs: null,
      pageError: null,
    };
  }

  let closeSession: (() => Promise<void>) | null = null;
  const filled: string[] = [];
  const visitedUrls: string[] = [];

  // Proxy meta (parolsiz) — log uchun. Sticky: profileKey bo'yicha.
  const proxyTarget: ProxyTarget = { profileKey: opts?.profileKey ?? null };
  const pmeta = proxyMetaFor(
    proxyTarget.profileKey
      ? proxyTarget
      : {
          profileKey: applicant.generatedEmail || applicant.email || null,
        },
  );
  let statusCode: number | null = null;
  let exitIp: string | null = null;
  // Vaqtlar: "kelgan" (navigatsiya boshlandi) va "ochilgan" (javob keldi).
  let requestedAt: string | null = null;
  let openedAt: string | null = null;
  let navMs: number | null = null;
  // Chrome web ochganda chiqqan xatolar (JS exception / failed request / 4xx-5xx).
  const pageErrors: string[] = [];

  // Brauzer qaysi sahifaga o'tsa — tartib bilan yozib boramiz (takrorsiz).
  const trackUrl = (u: string) => {
    if (!u || u === "about:blank") return;
    if (visitedUrls[visitedUrls.length - 1] === u) return;
    visitedUrls.push(u);
  };

  try {
    const profileKey =
      opts?.profileKey || applicant.generatedEmail || applicant.email || null;
    const session = await openBrowserContext(profileDirFor(stage, profileKey), {
      profileKey,
    });
    closeSession = session.close;

    const page: import("playwright").Page = await session.context.newPage();

    // Har bir navigatsiyani (redirect/yangi sahifa) kuzatamiz.
    page.on("framenavigated", (frame) => {
      try {
        if (frame === page.mainFrame()) trackUrl(frame.url());
      } catch {
        /* ignore */
      }
    });

    // Chrome xatolarini yig'amiz: JS exception, yuklanmagan so'rov, 4xx/5xx.
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

    // "kelgan": navigatsiya boshlandi.
    const t0 = Date.now();
    requestedAt = new Date(t0).toISOString();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    // "ochilgan": sahifa javob berdi / DOM tayyor.
    const t1 = Date.now();
    openedAt = new Date(t1).toISOString();
    navMs = t1 - t0;
    statusCode = response ? response.status() : null;
    trackUrl(page.url());

    // Proxy yoqilgan bo'lsa — tashqi (exit) IP'ni aniqlaymiz (log uchun).
    if (shouldLogExitIp()) {
      exitIp = await readExitIp(page);
    }

    // Har bir maydonni topib to'ldiramiz.
    const values: Partial<Record<keyof AutomationApplicant, string>> = {
      surname: applicant.surname,
      name: applicant.name,
      passportNumber: applicant.passportNumber,
      nationality: applicant.nationality ?? undefined,
      gender: applicant.gender ?? undefined,
      birthdate: applicant.birthdate ?? undefined,
      passportValidity: applicant.passportValidity ?? undefined,
      phone: applicant.phone ?? undefined,
      email: applicant.generatedEmail || applicant.email || undefined,
    };

    for (const [field, value] of Object.entries(values)) {
      if (!value) continue;
      const ok = await fillSmartField(
        page,
        FIELD_KEYWORDS[field as keyof AutomationApplicant],
        value,
      );
      if (ok) filled.push(field);
      // Inson kabi: har bir maydondan keyin qisqa tasodifiy pauza.
      await humanPause();
    }

    // Cloudflare Turnstile bo'lsa — token to'lguncha (captcha o'tguncha) kutamiz.
    const captcha = await waitForTurnstile(page);
    if (captcha.present && !captcha.solved) {
      pageErrors.push("turnstile: token kutib olinmadi (captcha o'tmadi)");
    }

    // Inson kabi: yuborishdan oldin biroz "o'ylab turish".
    await humanPause(400, 900);

    // Submit tugmasini bosamiz (agar topilsa).
    const submitted = await clickSubmit(page);

    // Natijani kutamiz va sahifa matnini o'qiymiz.
    await page
      .waitForLoadState("networkidle", { timeout: 8000 })
      .catch(() => {});
    const bodyText =
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")) || "";
    const ref = extractRef(bodyText);

    // Brauzer yopishdan oldin oxirgi URL'ni olamiz.
    const finalUrl = page.url();
    trackUrl(finalUrl);

    await closeSession();
    closeSession = null;

    const note =
      `${stageLabel(stage)}: ` +
      `${filled.length} maydon to'ldirildi` +
      (submitted ? ", forma yuborildi" : ", submit tugmasi topilmadi") +
      (captcha.present
        ? captcha.solved
          ? ", captcha o'tdi"
          : ", captcha o'tmadi"
        : "") +
      (ref ? `, ref: ${ref}` : "");

    return {
      ok: filled.length > 0 || submitted,
      ref,
      note,
      filled,
      url,
      finalUrl,
      visitedUrls,
      proxyServer: pmeta?.server ?? null,
      proxyCountry: pmeta?.country ?? null,
      proxySession: pmeta?.session ?? null,
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
      ref: null,
      note: `Avtomatlashtirish xatosi: ${msg.slice(0, 200)}`,
      filled,
      url,
      finalUrl: visitedUrls[visitedUrls.length - 1] || url,
      visitedUrls,
      proxyServer: pmeta?.server ?? null,
      proxyCountry: pmeta?.country ?? null,
      proxySession: pmeta?.session ?? null,
      exitIp,
      statusCode,
      requestedAt,
      openedAt,
      navMs,
      pageError: pageErrors.length ? pageErrors.slice(0, 10).join(" | ") : null,
    };
  }
}
