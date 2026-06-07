// ====================================================================
//  KALENDAR — VFS appointment-detail sahifasida bo'sh slot bor-yo'qligini aniqlash
// ====================================================================
//  HAQIQIY VFS oqimi (foydalanuvchi screenshot bergan):
//   1. Login (BOOKING_LOGIN_URL) — sessiya profilda saqlanadi (cookie barqaror).
//   2. dashboard: .../uzb/en/lva/dashboard
//   3. application-detail: .../uzb/en/lva/application-detail  (BOOKING_CALENDAR_URL)
//   4. 3 ta dropdown tanlanadi (Angular Material mat-select):
//        - Choose your Application Centre   (centre)
//        - Choose your appointment category (category)
//        - Choose your sub-category         (subCategory)
//   5. Natija:
//        - YOPIQ: "We are sorry but no appointment slots are currently available.
//                 New slots open at regular intervals, please try again later"
//                 + Continue tugmasi NOFAOL (disabled).
//        - OCHIQ: kalendar/sana tanlash chiqadi + Continue FAOL bo'ladi.
//
//  Proxy true bo'lsa — STICKY IP (monitor akkaunti bo'yicha), chunki login
//  sessiyasi barqaror IP talab qiladi (rotating IP sessiyani buzadi).
//
//  .env sozlamalari:
//   BOOKING_CALENDAR_URL          — appointment-detail URL (default LVA)
//   SLOT_MONITOR_EMAIL/PASSWORD   — kalendar tekshiruvi uchun VFS akkaunti
//   SLOT_MONITOR_PROFILE_KEY      — profil/sticky-IP kaliti (default: email)
//   BOOKING_CALENDAR_CENTRE       — default Application Centre matni
//   BOOKING_CALENDAR_CATEGORY     — default appointment category matni
//   BOOKING_CALENDAR_SUBCATEGORY  — default sub-category matni
//   BOOKING_CALENDAR_NO_SLOT_TEXT — "yopiq" belgisi (default VFS xabari)
//   BOOKING_CONTINUE_TEXT         — Continue tugma matni (default "Continue")
//   BOOKING_CALENDAR_SCREENSHOT   — true (default) har tekshiruvda skrinshot
//   BOOKING_CALENDAR_SHOT_DIR     — skrinshot papkasi (default uploads/slot-monitor)
//   BOOKING_CALENDAR_WAIT_MS      — render kutish (default 9000)
// ====================================================================

import * as fs from "fs";
import * as path from "path";
import type { Page } from "playwright";
import type { CalendarDetectResult } from "./types";
import {
  openBrowserContext,
  profileDirFor,
  applyResourceBlocking,
} from "./browser";
import {
  readExitIp,
  acceptCookies,
  clickTurnstile,
  waitForTurnstile,
  waitForCloudflareClear,
  fillFieldReliably,
} from "./page-utils";
import { humanPause } from "./human";
import { proxyMetaFor, shouldLogExitIp, isProxyEnabled } from "../proxy";

const DEFAULT_CALENDAR_URL =
  "https://visa.vfsglobal.com/uzb/en/lva/application-detail";
const DEFAULT_NO_SLOT_TEXT =
  "no appointment slots are currently available|" +
  "no appointment slot is currently available|" +
  "currently no appointments|band emas|slot mavjud emas";

// Bo'sh (tanlanadigan) kalendar kun katakchalari.
const AVAILABLE_DATE_SELECTORS = [
  ".mat-calendar-body-cell:not(.mat-calendar-body-disabled)",
  ".mat-mdc-calendar-body-cell:not(.mat-calendar-body-disabled)",
  "td.available a",
  "[role='gridcell'] button:not([disabled]):not(.mat-calendar-body-disabled)",
];
const CALENDAR_SELECTORS = [
  "mat-calendar",
  ".mat-calendar",
  ".mat-datepicker-content",
  "[class*='calendar' i]",
];

export type CalendarConfig = {
  slotId?: number;
  centre?: string | null;
  category?: string | null;
  subCategory?: string | null;
  email?: string | null;
  password?: string | null;
  profileKey?: string | null;
};

function envStr(name: string, fallback = ""): string {
  return (process.env[name] || "").trim() || fallback;
}

function splitList(v: string, sep = "|"): string[] {
  return v
    .split(sep)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function calendarUrl(): string {
  return (
    envStr("BOOKING_CALENDAR_URL") ||
    envStr("BOOKING_SLOT_URL") ||
    DEFAULT_CALENDAR_URL
  );
}

function screenshotDir(): string {
  const rel =
    envStr("BOOKING_CALENDAR_SHOT_DIR") || path.join("uploads", "slot-monitor");
  return path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
}

function screenshotsEnabled(): boolean {
  const v = (process.env.BOOKING_CALENDAR_SCREENSHOT || "true")
    .trim()
    .toLowerCase();
  return v !== "false" && v !== "0";
}

/**
 * Slot tekshiruvi proxy orqali o'tsinmi? (.env: SLOT_CHECK_PROXY)
 * Default: FALSE — slot tekshiruvi har 10 minutda takrorlanadi, proxy orqali
 * o'tsa trafik ko'p ketib qimmatga tushadi. Shu sababli default to'g'ridan-to'g'ri
 * internet. Kerak bo'lsa (IP bloklansa) SLOT_CHECK_PROXY=true qilinadi.
 */
function slotCheckProxyEnabled(): boolean {
  const v = (process.env.SLOT_CHECK_PROXY || "false").trim().toLowerCase();
  return v === "true" || v === "1";
}

/**
 * Slot-monitor uchun ALOHIDA, doimiy CDP profil bazasi. Bu yerda token/cookie
 * va cache SAQLANADI — har 10 minutda qayta login qilinmaydi (tezroq, IP kam
 * "charchaydi"). register/order profilidan ajratilgan, ularga ta'sir qilmaydi.
 * .env: SLOT_MONITOR_PROFILE_DIR (bo'sh bo'lsa uploads/slot-monitor-profiles).
 */
function slotMonitorProfileBase(): string {
  const rel =
    envStr("SLOT_MONITOR_PROFILE_DIR") ||
    path.join("uploads", "slot-monitor-profiles");
  return path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
}

/** Saqlangan sessiya (token) fayli — har profileKey uchun alohida. */
function sessionStorePath(profileKey: string): string {
  const safe = profileKey.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60);
  return path.join(slotMonitorProfileBase(), `session-${safe}.json`);
}

/**
 * Sahifadan localStorage + sessionStorage'ni o'qib, diskka saqlaydi. VFS token'ni
 * sessionStorage'da saqlaydi — u brauzer yopilganda yo'qoladi. Shuni faylga
 * yozib qo'yamiz, keyingi tekshiruvda qayta tiklaymiz (qayta login KERAK EMAS).
 */
async function saveSession(
  page: import("playwright").Page,
  profileKey: string,
): Promise<void> {
  try {
    const data = await page.evaluate(() => {
      const dump = (s: Storage) => {
        const o: Record<string, string> = {};
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k) o[k] = s.getItem(k) ?? "";
        }
        return o;
      };
      return { ls: dump(localStorage), ss: dump(sessionStorage) };
    });
    // Token bormi? (bo'sh sessiyani saqlamaymiz.)
    const hasAny =
      Object.keys(data.ls).length > 0 || Object.keys(data.ss).length > 0;
    if (!hasAny) return;
    const file = sessionStorePath(profileKey);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ savedAt: Date.now(), ...data }),
      "utf8",
    );
  } catch {
    /* sessiyani saqlay olmadik — muhim emas, keyingi safar login bo'ladi */
  }
}

/**
 * Diskdagi saqlangan sessiyani (localStorage + sessionStorage) sahifaga TIKLAYDI.
 * DIQQAT: sahifa AYNI origin'da ochilgan bo'lishi kerak (storage origin'ga bog'liq).
 * Tiklangan bo'lsa true qaytaradi.
 */
async function restoreSession(
  page: import("playwright").Page,
  profileKey: string,
): Promise<boolean> {
  try {
    const file = sessionStorePath(profileKey);
    if (!fs.existsSync(file)) return false;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      ls?: Record<string, string>;
      ss?: Record<string, string>;
    };
    await page.evaluate((d) => {
      try {
        for (const [k, v] of Object.entries(d.ls || {}))
          localStorage.setItem(k, v);
        for (const [k, v] of Object.entries(d.ss || {}))
          sessionStorage.setItem(k, v);
      } catch {
        /* storage yozib bo'lmadi */
      }
    }, raw);
    return true;
  } catch {
    return false;
  }
}

/** Akkaunt 429001 "Access Restricted" bo'lganmi? (qayta login QILMAYMIZ.) */
async function isAccountRestricted(
  page: import("playwright").Page,
): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const t = (document.body?.innerText || "").toLowerCase();
      return (
        t.includes("429001") ||
        t.includes("access restricted") ||
        t.includes("temporarily restricted")
      );
    });
  } catch {
    return false;
  }
}

/** 429001 backoff marker fayli — akkaunt necha vaqtgача tinch qoldirilsin. */
function restrictedMarkerPath(profileKey: string): string {
  const safe = profileKey.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60);
  return path.join(slotMonitorProfileBase(), `restricted-${safe}.json`);
}

/** 429001 aniqlansa — backoff yozamiz (default 60 min urinmaymiz). */
function markRestricted(profileKey: string): void {
  try {
    const min = Number(process.env.SLOT_RESTRICTED_BACKOFF_MIN || 60);
    const file = restrictedMarkerPath(profileKey);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ until: Date.now() + Math.max(1, min) * 60_000 }),
      "utf8",
    );
  } catch {
    /* muhim emas */
  }
}

/** Backoff hali tugamaganmi? Tugamagan bo'lsa necha daqiqa qolganini qaytaradi. */
function restrictedRemainingMin(profileKey: string): number {
  try {
    const file = restrictedMarkerPath(profileKey);
    if (!fs.existsSync(file)) return 0;
    const { until } = JSON.parse(fs.readFileSync(file, "utf8")) as {
      until?: number;
    };
    if (!until) return 0;
    const remMs = until - Date.now();
    if (remMs <= 0) {
      fs.rmSync(file, { force: true });
      return 0;
    }
    return Math.ceil(remMs / 60_000);
  } catch {
    return 0;
  }
}

/**
 * VFS Angular Material mat-select dropdownni TANLAYDI.
 *  - labelHint: dropdown ustidagi yorliq matni (masalan "appointment category").
 *    Topilsa shu yorliqqa eng yaqin mat-select ishlatiladi.
 *  - orderIndex: yorliq topilmasa, sahifadagi mat-select tartibi (0,1,2).
 *  - optionText: tanlanadigan variant matni. Bo'sh bo'lsa birinchi haqiqiy variant.
 * Tanlangan/tanlanmaganini qaytaradi (xato tashlamaydi).
 */
async function selectDropdown(
  page: Page,
  orderIndex: number,
  optionText: string | null | undefined,
  labelHint: string,
): Promise<boolean> {
  try {
    // 1) Dropdown tetigini (mat-select) topamiz — yorliq yoki tartib bo'yicha.
    const opened = await page.evaluate(
      ({ orderIndex, labelHint }) => {
        const selects = Array.from(
          document.querySelectorAll(
            "mat-select, .mat-mdc-select, .mat-select, [role='combobox']",
          ),
        ) as HTMLElement[];
        if (selects.length === 0) return false;

        let target: HTMLElement | null = null;
        if (labelHint) {
          const hint = labelHint.toLowerCase();
          for (const s of selects) {
            const block =
              s.closest(
                ".mat-mdc-form-field, mat-form-field, .field, form, div",
              )?.parentElement || s.parentElement;
            const txt = (block?.textContent || "").toLowerCase();
            if (txt.includes(hint)) {
              target = s;
              break;
            }
          }
        }
        if (!target) target = selects[Math.min(orderIndex, selects.length - 1)];
        if (!target) return false;
        target.scrollIntoView({ block: "center" });
        target.click();
        return true;
      },
      { orderIndex, labelHint },
    );
    if (!opened) return false;

    // 2) Ochilgan overlay paneldagi variantlar render bo'lishini kutamiz.
    await page
      .waitForSelector(
        "mat-option, .mat-mdc-option, .mat-option, [role='option']",
        { timeout: 6000, state: "visible" },
      )
      .catch(() => {});

    // 3) Variantni matn bo'yicha tanlaymiz (bo'sh bo'lsa birinchi haqiqiysini).
    const picked = await page.evaluate((optionText) => {
      const opts = Array.from(
        document.querySelectorAll(
          "mat-option, .mat-mdc-option, .mat-option, [role='option']",
        ),
      ) as HTMLElement[];
      if (opts.length === 0) return false;
      const want = (optionText || "").trim().toLowerCase();
      let chosen: HTMLElement | undefined;
      if (want) {
        chosen =
          opts.find(
            (o) => (o.textContent || "").trim().toLowerCase() === want,
          ) ||
          opts.find((o) => (o.textContent || "").toLowerCase().includes(want));
      } else {
        chosen = opts.find((o) => {
          const t = (o.textContent || "").trim().toLowerCase();
          return (
            t &&
            !t.startsWith("select") &&
            !t.startsWith("choose") &&
            o.getAttribute("aria-disabled") !== "true"
          );
        });
      }
      if (!chosen) return false;
      chosen.scrollIntoView({ block: "center" });
      chosen.click();
      return true;
    }, optionText);

    // Tanlovdan keyin bog'liq (dependent) dropdownlar yuklanishi uchun kutamiz.
    await page.waitForTimeout(900);
    return picked;
  } catch {
    return false;
  }
}

/** Sahifada kalendar/bo'sh kun bor-yo'qligini va Continue holatini o'qiydi. */
async function readAvailability(
  page: Page,
  noSlotMarks: string[],
  continueText: string,
): Promise<{
  noSlot: boolean;
  continueEnabled: boolean;
  calendarFound: boolean;
  availableDates: string[];
}> {
  return page.evaluate(
    ({ noSlotMarks, continueText, dateSel, calSel }) => {
      const visible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const st = window.getComputedStyle(el as HTMLElement);
        return (
          r.width > 0 &&
          r.height > 0 &&
          st.visibility !== "hidden" &&
          st.display !== "none"
        );
      };

      const bodyText = (document.body?.innerText || "").toLowerCase();
      const noSlot = noSlotMarks.some((m: string) => bodyText.includes(m));

      // Continue tugmasi — matn bo'yicha topamiz, disabled holatini tekshiramiz.
      const wantBtn = (continueText || "continue").toLowerCase();
      const buttons = Array.from(
        document.querySelectorAll(
          "button, [role='button'], input[type='submit']",
        ),
      ) as HTMLElement[];
      const cont = buttons.find((b) =>
        (b.textContent || (b as HTMLInputElement).value || "")
          .toLowerCase()
          .includes(wantBtn),
      );
      let continueEnabled = false;
      if (cont) {
        const disabled =
          (cont as HTMLButtonElement).disabled === true ||
          cont.getAttribute("disabled") !== null ||
          cont.getAttribute("aria-disabled") === "true" ||
          cont.className.toLowerCase().includes("disabled");
        continueEnabled = !disabled && visible(cont);
      }

      let calendarFound = false;
      for (const sel of calSel) {
        try {
          if (Array.from(document.querySelectorAll(sel)).some(visible)) {
            calendarFound = true;
            break;
          }
        } catch {
          /* noto'g'ri selektor */
        }
      }

      const dates: string[] = [];
      for (const sel of dateSel) {
        try {
          for (const n of Array.from(document.querySelectorAll(sel))) {
            if (!visible(n)) continue;
            if (n.getAttribute("aria-disabled") === "true") continue;
            const t = (n.textContent || "").trim();
            if (t) dates.push(t);
          }
        } catch {
          /* noto'g'ri selektor */
        }
        if (dates.length) break;
      }

      return {
        noSlot,
        continueEnabled,
        calendarFound,
        availableDates: Array.from(new Set(dates)).slice(0, 40),
      };
    },
    {
      noSlotMarks,
      continueText,
      dateSel: AVAILABLE_DATE_SELECTORS,
      calSel: CALENDAR_SELECTORS,
    },
  );
}

/**
 * Sahifa holatini aniqlaydi va Angular yuklanishini KUTADI:
 *  - "detail": appointment-detail tayyor (mat-select dropdownlar render bo'ldi).
 *  - "login": login formasi (parol maydoni) yoki login URL.
 *  - "unknown": vaqt tugadi (hali "Loading" spinnerда qotgan).
 * Angular SPA sekin yuklanadi — shu sababli dropdown PAYDO bo'lishini kutamiz.
 */
async function waitForDetailOrLogin(
  page: Page,
  timeoutMs: number,
): Promise<"detail" | "login" | "unknown"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await page
      .evaluate(() => {
        const url = location.href.toLowerCase();
        const hasLogin = !!document.querySelector(
          "input[type='password'], #password, [formcontrolname='password']",
        );
        if (hasLogin || url.includes("/login") || url.includes("/auth"))
          return "login";
        const hasAppt = !!document.querySelector(
          "mat-select, .mat-mdc-select, .mat-select",
        );
        if (hasAppt) return "detail";
        return "loading";
      })
      .catch(() => "loading");
    if (st === "detail" || st === "login") return st;
    await page.waitForTimeout(500).catch(() => {});
  }
  return "unknown";
}

/**
 * Dashboard yuklanishini kutadi:
 *  - "dashboard": "Start New Booking" tugmasi ko'rindi.
 *  - "login": login formasi (parol) yoki login URL.
 *  - "unknown": vaqt tugadi (hali Loading).
 */
async function waitForDashboardOrLogin(
  page: Page,
  timeoutMs: number,
): Promise<"dashboard" | "login" | "unknown"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await page
      .evaluate(() => {
        const url = location.href.toLowerCase();
        const hasLogin = !!document.querySelector(
          "input[type='password'], #password, [formcontrolname='password']",
        );
        if (hasLogin || url.includes("/login") || url.includes("/auth"))
          return "login";
        const txt = (document.body?.innerText || "").toLowerCase();
        if (txt.includes("start new booking")) return "dashboard";
        return "loading";
      })
      .catch(() => "loading");
    if (st === "dashboard" || st === "login") return st;
    await page.waitForTimeout(500).catch(() => {});
  }
  return "unknown";
}

/**
 * Bitta urinish: profilni ochib appointment-detail'ga o'tadi, dropdownlarni
 * tanlaydi va natijani o'qiydi. Login kerak bo'lsa needLogin=true qaytaradi.
 */
const LOGIN_URL_DEFAULT = "https://visa.vfsglobal.com/uzb/en/lva/login";

function loginUrl(): string {
  return envStr("BOOKING_LOGIN_URL") || LOGIN_URL_DEFAULT;
}

const DASHBOARD_URL_DEFAULT = "https://visa.vfsglobal.com/uzb/en/lva/dashboard";

function dashboardUrl(): string {
  return envStr("BOOKING_DASHBOARD_URL") || DASHBOARD_URL_DEFAULT;
}

/**
 * Dashboard'dagi "Start New Booking" tugmasini bosib, SPA ICHIDA
 * application-detail'ga o'tadi (to'g'ridan-to'g'ri URL ochish Angular holatini
 * buzadi va "Loading"da qotadi). Tugma topilmasa false.
 */
async function clickStartNewBooking(
  page: import("playwright").Page,
): Promise<boolean> {
  const btn = page
    .locator(
      'button:has-text("Start New Booking"), a:has-text("Start New Booking"), ' +
        'button:has-text("Start new booking"), [role="button"]:has-text("Start New Booking")',
    )
    .first();
  if ((await btn.count().catch(() => 0)) === 0) return false;
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click({ timeout: 8000 }).catch(() => {});
  return true;
}

/**
 * AYNI sessiyada (brauzer ochiq turganda) login qiladi — VFS login sahifasiga
 * o'tib, email/parol to'ldirib, Turnstile token kutib, Sign In bosadi. Token
 * RAM'da tirik qoladi, shu sababli darrov application-detail ishlaydi.
 * Captcha "Verification failed" bersa — O'SHA brauzerда sahifani QAYTA YUKLAB
 * yana urinadi (yangi brauzer ochilmaydi). Muvaffaqiyatli bo'lsa true.
 */
async function loginInSession(
  page: import("playwright").Page,
  email: string,
  password: string,
): Promise<boolean> {
  // Captcha xato berishi mumkin — o'sha sahifani qayta yuklab necha marta urinish.
  const maxTries = Math.max(
    1,
    Number(process.env.SLOT_LOGIN_CAPTCHA_RETRIES || 3),
  );

  for (let attempt = 0; attempt < maxTries; attempt++) {
    // Login sahifasini (qayta) yuklaymiz — Turnstile widget toza holatda render
    // bo'ladi (oldingi "Verification failed" yo'qoladi). Brauzer O'SHA-O'ZI.
    await page
      .goto(loginUrl(), { waitUntil: "domcontentloaded", timeout: 45000 })
      .catch(() => {});
    await waitForCloudflareClear(page).catch(() => {});
    if (await acceptCookies(page)) {
      /* cookie qabul qilindi */
    }

    const emailSel = '#email, input[formcontrolname="username"]';
    await page
      .waitForSelector(emailSel, { state: "visible", timeout: 20000 })
      .catch(() => {});

    // Turnstile token email/parol bilan PARALLEL yechiladi (kutish ~0 bo'ladi).
    const captchaPromise = waitForTurnstile(page);

    const emailEl = page.locator(emailSel).first();
    if ((await emailEl.count()) > 0) {
      await fillFieldReliably(page, emailEl, email);
    }
    await humanPause();

    const passSel = '#password, input[formcontrolname="password"]';
    const passEl = page.locator(passSel).first();
    if ((await passEl.count()) > 0) {
      await fillFieldReliably(page, passEl, password);
    }
    await humanPause();

    let captcha = await captchaPromise;
    if (captcha.present && !captcha.solved) {
      await clickTurnstile(page).catch(() => {});
      captcha = await waitForTurnstile(page);
    }

    // Captcha hali ham o'tmagan bo'lsa — sahifani qayta yuklab yangi widget
    // bilan urinamiz (oxirgi urinish bo'lmasa). Yangi brauzer ochmaymiz.
    if (captcha.present && !captcha.solved && attempt < maxTries - 1) {
      continue;
    }

    await humanPause(400, 900);
    if (await acceptCookies(page)) {
      /* banner Sign In'ni to'smasin */
    }

    const signInBtn = page
      .locator(
        'button:has-text("Sign In"), button:has-text("Sign in"), button[type="submit"]',
      )
      .first();
    if ((await signInBtn.count()) > 0) {
      await signInBtn.click({ timeout: 8000 }).catch(() => {});
    }

    // Dashboard'ga o'tishni (login sahifasidan chiqishni) kutamiz.
    await page
      .waitForURL((u) => !/\/login(\b|\/|$)/i.test(u.toString()), {
        timeout: 20000,
      })
      .catch(() => {});
    await page.waitForTimeout(800).catch(() => {});

    if (!/\/login(\b|\/|$)/i.test(page.url().toLowerCase())) {
      return true; // login sahifasidan chiqdi — muvaffaqiyatli.
    }
    // Hali login sahifasida — keyingi urinish (sahifa qayta yuklanadi).
  }
  return false;
}

/**
 * VFS appointment-detail sahifasini ochib, bo'sh slot bor-yo'qligini aniqlaydi.
 * HAMMASI BITTA brauzer sessiyasida: saqlangan token bilan ishlaydi; sessiya
 * yo'q yoki token 401 bersa — AYNI sessiyada qayta login qilib, toza tekshiradi
 * (token RAM'da tirik bo'lgani uchun ishonchli). Hech qachon exception tashlamaydi.
 */
export async function detectCalendar(
  cfg: CalendarConfig = {},
): Promise<CalendarDetectResult> {
  const startedAt = Date.now();
  const email = cfg.email || envStr("SLOT_MONITOR_EMAIL") || null;
  const password = cfg.password || envStr("SLOT_MONITOR_PASSWORD") || null;
  const profileKey =
    cfg.profileKey ||
    envStr("SLOT_MONITOR_PROFILE_KEY") ||
    email ||
    "slot-monitor";

  const centre = cfg.centre || envStr("BOOKING_CALENDAR_CENTRE") || null;
  const category = cfg.category || envStr("BOOKING_CALENDAR_CATEGORY") || null;
  const subCategory =
    cfg.subCategory || envStr("BOOKING_CALENDAR_SUBCATEGORY") || null;

  const url = calendarUrl();
  const noProxy = !slotCheckProxyEnabled();
  const target = { profileKey, noProxy };
  const pmeta = proxyMetaFor(target);
  const waitMs = Number(process.env.BOOKING_CALENDAR_WAIT_MS || 9000);
  // Angular SPA (dropdown yoki login formasi) render bo'lishini kutish vaqti.
  const readyMs = Number(process.env.BOOKING_CALENDAR_READY_MS || 30000);
  const noSlotMarks = splitList(
    envStr("BOOKING_CALENDAR_NO_SLOT_TEXT", DEFAULT_NO_SLOT_TEXT),
  );
  const continueText = envStr("BOOKING_CONTINUE_TEXT", "Continue");

  const base: CalendarDetectResult = {
    open: false,
    loggedIn: true,
    calendarFound: false,
    availableDates: [],
    note: "",
    url,
    finalUrl: url,
    screenshotPath: null,
    exitIp: null,
    statusCode: null,
    proxyServer: pmeta?.server ?? null,
    proxyCountry: pmeta?.country ?? null,
    durationMs: 0,
  };

  // 429001 BACKOFF: akkaunt yaqinda bloklangan bo'lsa — urinmaymiz (login bilan
  // ahvolni yomonlashtirmaslik uchun). Backoff tugaguncha kutamiz.
  const rem = restrictedRemainingMin(profileKey);
  if (rem > 0) {
    return {
      ...base,
      loggedIn: false,
      note: `Akkaunt 429001 bilan bloklangan — ${rem} daqiqadan keyin qayta urinadi.`,
      durationMs: Date.now() - startedAt,
    };
  }

  let closeSession: (() => Promise<void>) | null = null;

  // Bitta sessiyani ochib tekshiradi. fresh=true => profilni TOZALAB ochadi
  // (iflos cookie/Turnstile holatini yo'qotadi — toza captcha). doLogin=true =>
  // login kerak bo'lsa AYNI sessiyada login qiladi (token RAM'da tirik qoladi).
  // Qaytaradi: tayyor natija YOKI {needLogin:true} (login kerak, lekin qilinmadi).
  const runSession = async (
    fresh: boolean,
    doLogin: boolean,
  ): Promise<CalendarDetectResult | { needLogin: true }> => {
    const session = await openBrowserContext(
      profileDirFor("login", profileKey),
      target,
      { cdpProfileBase: slotMonitorProfileBase(), cdpFreshProfile: fresh },
    );
    closeSession = session.close;
    // Resurs bloklash slot-monitor uchun DEFAULT O'CHIQ: autentifikatsiyalangan
    // dashboard/application-detail og'ir Angular bo'lib, bloklash "Loading"da
    // qotirishi mumkin. .env: SLOT_CHECK_BLOCK_RESOURCES=true bo'lsa yoqiladi.
    if (
      (process.env.SLOT_CHECK_BLOCK_RESOURCES || "false")
        .trim()
        .toLowerCase() === "true"
    ) {
      await applyResourceBlocking(session.context);
    }

    const page = await session.context.newPage();
    let apiUnauthorized = false;
    page.on("response", (res: import("playwright").Response) => {
      const s = res.status();
      const u = res.url().toLowerCase();
      if (
        (s === 401 || s === 403) &&
        /lift-api|vfsglobal|user\/|login|appointment|booking/.test(u) &&
        !u.includes("challenges.cloudflare.com")
      ) {
        apiUnauthorized = true;
      }
    });

    // application-detail'ga HAR DOIM dashboard -> "Start New Booking" orqali
    // o'tamiz (xuddi haqiqiy foydalanuvchi kabi). Avval SAQLANGAN tokenni
    // (localStorage + sessionStorage) tiklaymiz — shunda qayta login KERAK EMAS
    // (429001 "unusual activity" blokini oldini oladi).
    const gotoDetail = async (): Promise<
      "detail" | "login" | "unknown" | "restricted"
    > => {
      apiUnauthorized = false;
      // 1) Origin'ga yengil kiramiz (storage origin'ga bog'liq — shu kerak).
      await page
        .goto(loginUrl(), { waitUntil: "domcontentloaded", timeout: 45000 })
        .catch(() => {});
      if (await isAccountRestricted(page)) return "restricted";
      // 2) Saqlangan token'ni tiklaymiz (bo'lsa) — login so'ralmaydi.
      await restoreSession(page, profileKey);
      // 3) Dashboard'ga o'tamiz.
      const resp = await page
        .goto(dashboardUrl(), {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        })
        .catch(() => null);
      base.statusCode = resp?.status() ?? base.statusCode;
      if (await isAccountRestricted(page)) return "restricted";
      const dash = await waitForDashboardOrLogin(page, readyMs);
      if (dash === "login") return "login";
      if (dash === "unknown") return "unknown";
      // Dashboard tayyor — token amal qilyapti. Yangilab saqlaymiz.
      await saveSession(page, profileKey);
      const clicked = await clickStartNewBooking(page);
      if (!clicked) return "unknown";
      return waitForDetailOrLogin(page, readyMs);
    };

    let state = await gotoDetail();

    // Akkaunt 429001 bilan bloklangan — login QILMAYMIZ (ahvolni yomonlashtiradi).
    if (state === "restricted") {
      markRestricted(profileKey);
      base.screenshotPath = await maybeScreenshot(page, cfg.slotId);
      await closeSession();
      closeSession = null;
      return {
        ...base,
        loggedIn: false,
        note:
          "Akkaunt vaqtincha bloklangan (429001 — unusual activity). " +
          "Login qilinmaydi; akkaunt o'zi tiniqishini kuting.",
        durationMs: Date.now() - startedAt,
      };
    }

    const needLogin = state === "login" || apiUnauthorized;

    if (needLogin) {
      // Login QILMAYMIZ (token tekshiruvi bosqichi) — yuqoriga xabar beramiz.
      if (!doLogin) {
        await closeSession();
        closeSession = null;
        return { needLogin: true };
      }
      const ok = await loginInSession(page, email!, password!);
      if (!ok) {
        base.screenshotPath = await maybeScreenshot(page, cfg.slotId);
        await closeSession();
        closeSession = null;
        return {
          ...base,
          loggedIn: false,
          note: "Login muvaffaqiyatsiz (parol/captcha/akkaunt holatini tekshiring)",
          durationMs: Date.now() - startedAt,
        };
      }
      // Login bo'ldi — endi dashboard'damiz (loginInSession shu yerda tugadi).
      // RELOAD QILMAYMIZ (in-memory token yo'qolmasin) — to'g'ridan dashboard
      // tayyor bo'lishini kutib, "Start New Booking" bosamiz.
      if (await isAccountRestricted(page)) {
        markRestricted(profileKey);
        base.screenshotPath = await maybeScreenshot(page, cfg.slotId);
        await closeSession();
        closeSession = null;
        return {
          ...base,
          loggedIn: false,
          note: "Login bo'ldi, lekin akkaunt 429001 bilan bloklangan — kuting.",
          durationMs: Date.now() - startedAt,
        };
      }
      const dash = await waitForDashboardOrLogin(page, readyMs);
      if (dash === "dashboard") {
        // Token endi sessionStorage'da — diskka saqlaymiz (keyingi safar login yo'q).
        await saveSession(page, profileKey);
        const clicked = await clickStartNewBooking(page);
        state = clicked
          ? await waitForDetailOrLogin(page, readyMs)
          : ("unknown" as const);
      } else {
        state = dash; // "login" yoki "unknown"
      }
      if (state !== "detail") {
        base.screenshotPath = await maybeScreenshot(page, cfg.slotId);
        await closeSession();
        closeSession = null;
        return {
          ...base,
          loggedIn: false,
          note:
            state === "login"
              ? "Login qilindi, lekin sessiya o'rnashmadi (qayta login kerak)"
              : "Login qilindi, lekin appointment-detail yuklanmadi (Loading)",
          durationMs: Date.now() - startedAt,
        };
      }
    }

    if (shouldLogExitIp())
      base.exitIp = await readExitIp(page).catch(() => null);

    // Detail'ga yetdik — eng yangi token'ni saqlaymiz (keyingi safar login yo'q).
    await saveSession(page, profileKey);

    // 3 ta dropdownni tartib bilan tanlaymiz.
    await selectDropdown(page, 0, centre, "application centre");
    await selectDropdown(page, 1, category, "appointment category");
    await selectDropdown(page, 2, subCategory, "sub-category");

    await page
      .waitForLoadState("networkidle", { timeout: waitMs })
      .catch(() => {});
    await page.waitForTimeout(1200);

    const avail = await readAvailability(page, noSlotMarks, continueText);
    base.screenshotPath = await maybeScreenshot(page, cfg.slotId);
    base.finalUrl = page.url();

    await closeSession();
    closeSession = null;

    base.calendarFound = avail.calendarFound;
    base.availableDates = avail.availableDates;
    base.durationMs = Date.now() - startedAt;

    if (avail.noSlot && avail.availableDates.length === 0) {
      return { ...base, open: false, note: "Bo'sh slot yo'q (VFS xabari)" };
    }
    if (avail.availableDates.length > 0) {
      return {
        ...base,
        open: true,
        note: `${avail.availableDates.length} ta bo'sh kun topildi`,
      };
    }
    if (avail.continueEnabled || avail.calendarFound) {
      return {
        ...base,
        open: true,
        note: avail.continueEnabled
          ? "Continue faol — slot mavjud"
          : "Kalendar ochildi — slot mavjud",
      };
    }
    return {
      ...base,
      open: false,
      note: "Slot holati aniqlanmadi (xabar/kalendar/Continue topilmadi)",
    };
  };

  try {
    // BITTA brauzer sessiyasi (yangi brauzer ochilmaydi):
    //  - saqlangan token bo'lsa darrov application-detail ishlaydi (login yo'q).
    //  - token yo'q/eskirgan bo'lsa AYNI sessiyada login qilib davom etamiz.
    //    Captcha xato bersa loginInSession o'sha sahifani qayta yuklab urinadi.
    const result = await runSession(false, true);
    if (!("needLogin" in result)) return result;

    // Login kerak edi, lekin akkaunt sozlanmagan.
    return {
      ...base,
      loggedIn: false,
      note:
        "Login kerak, lekin akkaunt sozlanmagan " +
        "(.env: SLOT_MONITOR_EMAIL / SLOT_MONITOR_PASSWORD)",
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const cs = closeSession as null | (() => Promise<void>);
    if (cs) await cs().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      open: false,
      note: `Kalendar tekshirish xatosi: ${msg.slice(0, 200)}`,
      durationMs: Date.now() - startedAt,
    };
  }
}

/** Skrinshotni uploads/slot-monitor ga saqlaydi (proof/debug). Yo'lni qaytaradi. */
async function maybeScreenshot(
  page: Page,
  slotId?: number,
): Promise<string | null> {
  if (!screenshotsEnabled()) return null;
  try {
    const dir = screenshotDir();
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `calendar-${slotId ?? "slot"}-${ts}.png`;
    const file = path.join(dir, name);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch {
    return null;
  }
}

export { isProxyEnabled };
