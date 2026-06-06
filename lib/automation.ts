/**
 * ====================================================================
 *  BOOKING AVTOMATLASHTIRISH — Playwright bilan generic forma to'ldirgich
 * ====================================================================
 *  Ikki bosqich: "register" (ro'yxatdan o'tkazish) va "order" (buyurtma).
 *  URL'lar .env dan keladi (BOOKING_REGISTER_URL / BOOKING_ORDER_URL).
 *
 *  Engine sahifadagi formani avtomatik topadi: har bir input/select ni
 *  uning name/id/placeholder/label matni bo'yicha arizachi maydoniga
 *  moslaydi va to'ldiradi, so'ng "submit" tugmasini bosadi.
 *
 *  HECH QACHON exception tashlamaydi — har doim natija obyektini qaytaradi.
 *  Shu sababli CRM oqimi (status yangilash) buzilmaydi.
 * ====================================================================
 */

import {
  proxyFor,
  proxyMetaFor,
  proxyIpEchoUrl,
  shouldLogExitIp,
  type ProxyTarget,
} from "./proxy";
export type AutomationApplicant = {
  surname: string;
  name: string;
  passportNumber: string;
  nationality?: string | null;
  gender?: string | null;
  birthdate?: string | null;
  passportValidity?: string | null;
  phone?: string | null;
  email?: string | null;
  generatedEmail?: string | null;
};

export type AutomationResult = {
  ok: boolean;
  ref: string | null; // sahifadan topilgan tasdiqlash/appointment raqami
  note: string; // qisqa natija izohi (resultNote uchun)
  filled: string[]; // to'ldirilgan maydonlar ro'yxati
  url: string; // boshlang'ich (target) URL
  finalUrl: string; // urinish oxirida brauzer turgan URL
  visitedUrls: string[]; // urinish davomida ochilgan barcha URL'lar (tartib bilan)
  proxyServer: string | null; // ulangan proxy gateway (host:port) yoki null
  proxyCountry: string | null; // proxy davlati (uz/kz)
  proxySession: string | null; // sticky session id (qaysi user IP'si)
  exitIp: string | null; // proxy orqali chiqqan tashqi IP
  statusCode: number | null; // asosiy sahifa HTTP status kodi
  requestedAt: string | null; // "kelgan": navigatsiya boshlangan vaqt (ISO)
  openedAt: string | null; // "ochilgan": sahifa ochilgan/javob kelgan vaqt (ISO)
  navMs: number | null; // sahifa ochilish davomiyligi (ochilgan - kelgan)
  pageError: string | null; // chrome web ochganda chiqqan xatolar (JS/timeout/4xx-5xx)
};

export type ActivationResult = {
  ok: boolean;
  link: string | null; // gmail'dan topilgan aktivatsiya linki
  note: string;
  to: string | null; // qaysi email manziliga xat keldi
  proxyServer: string | null; // register bilan BIR XIL proxy (tasdiq uchun)
  proxyCountry: string | null;
  proxySession: string | null; // register bilan bir xil session id bo'lishi kerak
  exitIp: string | null; // proxy orqali chiqqan IP (register bilan bir xil)
  statusCode: number | null; // aktivatsiya sahifasi HTTP status kodi
  requestedAt: string | null; // "kelgan": link ochish boshlangan vaqt
  openedAt: string | null; // "ochilgan": sahifa ochilgan vaqt
  navMs: number | null; // ochilish davomiyligi
  pageError: string | null; // chrome xatolari
};

type Stage = "register" | "login" | "order";

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

function envHeadless(): boolean {
  const v = (process.env.BOOKING_HEADLESS || "true").toLowerCase();
  return v !== "false" && v !== "0";
}

// Real brauzerga o'xshatish uchun fingerprint sozlamalari (.env dan override).
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function fingerprintOptions() {
  const userAgent = (
    process.env.BOOKING_USER_AGENT || DEFAULT_USER_AGENT
  ).trim();
  const locale = (process.env.BOOKING_LOCALE || "en-US").trim();
  const timezoneId = (process.env.BOOKING_TIMEZONE || "Asia/Tashkent").trim();
  const vp = (process.env.BOOKING_VIEWPORT || "1366x768").trim();
  const m = vp.match(/^(\d{3,5})\s*[x×]\s*(\d{3,5})$/i);
  const viewport = m
    ? { width: Number(m[1]), height: Number(m[2]) }
    : { width: 1366, height: 768 };
  return {
    userAgent,
    locale,
    timezoneId,
    viewport,
    deviceScaleFactor: 1,
    extraHTTPHeaders: {
      "Accept-Language": `${locale},en;q=0.9`,
    } as Record<string, string>,
  };
}

// Stealth plugin faqat bir marta ulanadi (chromium global obyektga).
let stealthApplied = false;
async function getStealthChromium() {
  // playwright-extra chromium'ni puppeteer-extra-plugin-stealth bilan o'raydi —
  // navigator.webdriver, plugins, languages, WebGL kabi bot-belgilarini yashiradi.
  const mod: any = await import("playwright-extra");
  const chromium = mod.chromium ?? mod.default?.chromium ?? mod.default;
  if (!stealthApplied) {
    try {
      const stealthMod: any = await import("puppeteer-extra-plugin-stealth");
      const StealthPlugin = stealthMod.default ?? stealthMod;
      chromium.use(StealthPlugin());
      stealthApplied = true;
    } catch {
      // Stealth ulanmasa ham oddiy chromium bilan davom etamiz.
    }
  }
  return chromium;
}

/** Gmail/profil kalitini papka nomi uchun xavfsiz holatga keltiradi. */
export function sanitizeProfileKey(key: string): string {
  return (key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

/**
 * Profil papkasini aniqlaydi.
 *  - profileKey berilsa (har bir userning gmail'i): register va order BIR XIL
 *    papkani ulashadi — shu sababli cookies/localStorage/sessiya saqlanadi va
 *    register bilan booking adashmaydi.
 *  - aks holda: eski xulq (bosqich bo'yicha alohida papka).
 */
function profileDirFor(stage: Stage, profileKey?: string | null): string {
  const base = (process.env.BOOKING_PROFILE_DIR || "").trim();
  if (!base) return "";
  const safe = profileKey ? sanitizeProfileKey(profileKey) : "";
  if (safe) return `${base}/u-${safe}`;
  return `${base}-${stage}`;
}

async function openBrowserContext(
  profileDir: string,
  proxyTarget?: ProxyTarget,
) {
  const chromium = await getStealthChromium();
  const proxy = proxyTarget ? proxyFor(proxyTarget) : undefined;
  const fp = fingerprintOptions();

  if (profileDir) {
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: envHeadless(),
      ...(proxy ? { proxy } : {}),
      userAgent: fp.userAgent,
      locale: fp.locale,
      timezoneId: fp.timezoneId,
      viewport: fp.viewport,
      deviceScaleFactor: fp.deviceScaleFactor,
      extraHTTPHeaders: fp.extraHTTPHeaders,
    });
    return {
      context,
      close: async () => context.close(),
    };
  }

  const browser = await chromium.launch({
    headless: envHeadless(),
    ...(proxy ? { proxy } : {}),
  });
  const context = await browser.newContext({
    userAgent: fp.userAgent,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    viewport: fp.viewport,
    deviceScaleFactor: fp.deviceScaleFactor,
    extraHTTPHeaders: fp.extraHTTPHeaders,
  });
  return {
    context,
    close: async () => browser.close(),
  };
}

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

export type SlotCheckResult = {
  open: boolean;
  note: string;
  url: string;
};

/**
 * Saytda slot (vaqt oynasi) ochiq-yopiqligini Playwright bilan tekshiradi.
 * URL .env dan: BOOKING_SLOT_URL. Ochiqlik belgilari .env dan moslashtiriladi:
 *   BOOKING_SLOT_OPEN_TEXT   — sahifada shu matn bo'lsa = ochiq
 *   BOOKING_SLOT_CLOSED_TEXT — sahifada shu matn bo'lsa = yopiq
 * Default belgilar: "available/slot/book" = ochiq, "no appointment/closed" = yopiq.
 * Hech qachon exception tashlamaydi.
 */
export async function checkSlotOpen(): Promise<SlotCheckResult> {
  const url = process.env.BOOKING_SLOT_URL?.trim() || "";
  if (!url) {
    return {
      open: false,
      note: "URL sozlanmagan (.env: BOOKING_SLOT_URL)",
      url: "",
    };
  }

  const openText = (process.env.BOOKING_SLOT_OPEN_TEXT || "")
    .split("|")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const closedText = (process.env.BOOKING_SLOT_CLOSED_TEXT || "")
    .split("|")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const defaultOpen = ["available", "book now", "select slot", "free slot"];
  const defaultClosed = [
    "no appointment",
    "no slots",
    "not available",
    "closed",
    "fully booked",
    "band emas",
  ];
  const openMarks = openText.length ? openText : defaultOpen;
  const closedMarks = closedText.length ? closedText : defaultClosed;

  let closeSession: (() => Promise<void>) | null = null;
  try {
    // Slot tekshiruvi har 5 soniyada ishlaydi — har safar YANGI (rotating) IP
    // ishlatamiz, profil saqlamaymiz. Shunda bitta IP monitoring bilan
    // charchab bloklanmaydi va booking IP'lari toza qoladi.
    const session = await openBrowserContext("", { rotating: true });
    closeSession = session.close;

    const page = await session.context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page
      .waitForLoadState("networkidle", { timeout: 8000 })
      .catch(() => {});

    const body = (
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")) || ""
    ).toLowerCase();

    await closeSession();
    closeSession = null;

    const hasClosed = closedMarks.some((m) => body.includes(m));
    const hasOpen = openMarks.some((m) => body.includes(m));
    // Yopiq belgisi ustun: avval yopiqlikni tekshiramiz.
    if (hasClosed) {
      return { open: false, note: "Saytda slot yopiq", url };
    }
    if (hasOpen) {
      return { open: true, note: "Saytda slot ochiq", url };
    }
    // Belgi topilmadi (sayt o'zgargan/yangi sahifa). Monitoring jadval asosida
    // ishlaydi — admin slot vaqtini o'zi belgilaydi. Shuning uchun default'da
    // bunday holatni "ochiq" deb hisoblaymiz va navbatni ishga tushiramiz.
    // Qat'iy rejim kerak bo'lsa: .env BOOKING_SLOT_REQUIRE_MARK=true.
    const requireMark =
      (process.env.BOOKING_SLOT_REQUIRE_MARK || "").trim().toLowerCase() ===
      "true";
    if (requireMark) {
      return {
        open: false,
        note: "Slot holati aniqlanmadi (belgi topilmadi)",
        url,
      };
    }
    return {
      open: true,
      note: "Belgi topilmadi — jadval bo'yicha ochiq deb hisoblandi",
      url,
    };
  } catch (err) {
    if (closeSession) await closeSession().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return {
      open: false,
      note: `Slot tekshirish xatosi: ${msg.slice(0, 200)}`,
      url,
    };
  }
}

/** Sahifa matnidan tasdiqlash / appointment raqamini ajratib oladi. */
function extractRef(text: string): string | null {
  const patterns = [
    /(?:appointment|booking|reference|confirmation|ref|tasdiq|buyurtma)\D{0,12}([A-Z0-9]{5,})/i,
    /\b([A-Z]{2,4}-?\d{5,})\b/,
    /\b(\d{8,})\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

/**
 * Proxy orqali chiqqan tashqi (exit) IP'ni aniqlaydi (log uchun).
 * Sahifa context'idagi request ishlatiladi — demak o'sha proxy orqali ketadi.
 * Xato bo'lsa null qaytaradi (asosiy oqim buzilmaydi).
 */
async function readExitIp(
  page: import("playwright").Page,
): Promise<string | null> {
  try {
    const res = await page.request.get(proxyIpEchoUrl(), { timeout: 8000 });
    const txt = (await res.text()).trim();
    try {
      const j = JSON.parse(txt);
      const ip = j.ip || j.query || j.YourFuckingIPAddress || null;
      if (ip) return String(ip).slice(0, 60);
    } catch {
      /* JSON emas — xom matn */
    }
    const m = txt.match(/(\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]{6,}/);
    return m ? m[0].slice(0, 60) : null;
  } catch {
    return null;
  }
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
    }

    // Cloudflare Turnstile bo'lsa — token to'lguncha (captcha o'tguncha) kutamiz.
    const captcha = await waitForTurnstile(page);
    if (captcha.present && !captcha.solved) {
      pageErrors.push("turnstile: token kutib olinmadi (captcha o'tmadi)");
    }

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

/**
 * Register'dan keyin aktivatsiya: gmail qutidan userning aktivatsiya xatini
 * kutadi, ichidagi linkni topadi va USERNING profilida ochadi.
 *  - IMAP sozlanmagan bo'lsa: ok=true, "o'tkazib yuborildi" (register bloklanmaydi).
 *  - Xat topilmasa: ok=false (register to'liq hisoblanmaydi).
 *  - Link topilib ochilsa: ok=true, register to'liq tugadi.
 */
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
    await import("./mail-listener");

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

/**
 * Sahifadagi input/select/textarea ni kalit so'zlar bo'yicha topib to'ldiradi.
 * Element atributlari (name/id/placeholder/aria-label) + bog'langan <label>
 * matni tekshiriladi. Birinchi mos kelgan bo'sh element to'ldiriladi.
 */
async function fillSmartField(
  page: import("playwright").Page,
  keywords: string[],
  value: string,
): Promise<boolean> {
  try {
    const handles = await page.$$(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea",
    );
    for (const el of handles) {
      const meta = await el.evaluate((node: Element) => {
        const get = (a: string) => node.getAttribute(a) || "";
        let labelText = "";
        const id = node.getAttribute("id");
        if (id) {
          const lbl = document.querySelector(`label[for="${id}"]`);
          if (lbl) labelText = lbl.textContent || "";
        }
        const parentLabel = node.closest("label");
        if (parentLabel) labelText += " " + (parentLabel.textContent || "");
        return {
          tag: node.tagName.toLowerCase(),
          type: (node.getAttribute("type") || "").toLowerCase(),
          haystack: [
            get("name"),
            get("id"),
            get("placeholder"),
            get("aria-label"),
            labelText,
          ]
            .join(" ")
            .toLowerCase(),
          disabled: (node as HTMLInputElement).disabled,
        };
      });

      if (meta.disabled) continue;
      if (!keywords.some((k) => meta.haystack.includes(k))) continue;

      // SELECT — qiymatga mos optionni tanlaymiz.
      if (meta.tag === "select") {
        const picked = await el
          .evaluate((node: Element, v: string) => {
            const sel = node as HTMLSelectElement;
            const want = v.toLowerCase();
            for (const opt of Array.from(sel.options)) {
              const t = (opt.text + " " + opt.value).toLowerCase();
              if (t.includes(want) || want.includes(opt.value.toLowerCase())) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
              }
            }
            return false;
          }, value)
          .catch(() => false);
        if (picked) return true;
        continue;
      }

      // Oddiy matn inputi / textarea.
      try {
        await el.fill(value, { timeout: 4000 });
        return true;
      } catch {
        // ba'zi inputlar fill'ni qabul qilmaydi — type bilan urinib ko'ramiz.
        await el.click({ timeout: 2000 }).catch(() => {});
        await el.type(value, { timeout: 4000 }).catch(() => {});
        return true;
      }
    }
  } catch {
    // jim — natijaga ta'sir qilmaydi.
  }
  return false;
}

/**
 * Cloudflare Turnstile captcha'ni aniqlaydi va token to'lguncha kutadi.
 *  - present: sahifada Turnstile widget bor-yo'qligi.
 *  - solved: token (cf-turnstile-response) to'ldirildimi (captcha o'tdimi).
 *
 *  Turnstile odatda "managed/non-interactive" rejimda — toza brauzer + yaxshi
 *  IP bo'lsa o'zi avtomatik o'tadi. Biz faqat token to'lguncha kutamiz, shunda
 *  forma yuborilganda token amal qiladi. Hech qachon exception tashlamaydi.
 */
async function waitForTurnstile(
  page: import("playwright").Page,
): Promise<{ present: boolean; solved: boolean }> {
  const timeoutMs = Number(process.env.BOOKING_CAPTCHA_TIMEOUT_MS || "30000");
  try {
    // Widget bormi? (iframe yoki hidden input yoki .cf-turnstile konteyner)
    const present = await page
      .evaluate(() => {
        const hasInput = !!document.querySelector(
          'input[name="cf-turnstile-response"], [id^="cf-chl-widget"]',
        );
        const hasWidget = !!document.querySelector(
          '.cf-turnstile, iframe[src*="challenges.cloudflare.com"]',
        );
        return hasInput || hasWidget;
      })
      .catch(() => false);

    if (!present) return { present: false, solved: false };

    // Token to'lguncha kutamiz (cf-turnstile-response value uzunligi > 30).
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector(
            'input[name="cf-turnstile-response"]',
          ) as HTMLInputElement | null;
          return !!el && !!el.value && el.value.length > 30;
        },
        { timeout: timeoutMs },
      )
      .catch(() => {});

    const solved = await page
      .evaluate(() => {
        const el = document.querySelector(
          'input[name="cf-turnstile-response"]',
        ) as HTMLInputElement | null;
        return !!el && !!el.value && el.value.length > 30;
      })
      .catch(() => false);

    return { present: true, solved };
  } catch {
    return { present: false, solved: false };
  }
}

/** Forma yuborish tugmasini topib bosadi. */
async function clickSubmit(page: import("playwright").Page): Promise<boolean> {
  const candidates = [
    'button[type="submit"]',
    'input[type="submit"]',
    "button:has-text('Submit')",
    "button:has-text('Send')",
    "button:has-text('Book')",
    "button:has-text('Register')",
    "button:has-text('Continue')",
    "button:has-text('Yuborish')",
    "button:has-text('Davom')",
    "button:has-text('Saqlash')",
    "button:has-text('Tasdiqlash')",
  ];
  for (const sel of candidates) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0 && (await btn.isVisible())) {
        await btn.click({ timeout: 5000 });
        return true;
      }
    } catch {
      // keyingisini sinaymiz.
    }
  }
  return false;
}
