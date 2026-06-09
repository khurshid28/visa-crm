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
import { readExitIp, acceptCookies } from "./page-utils";
import { waitForCloudflareClear, solveTurnstile } from "./turnstile";
import {
  startLoginCaptcha,
  fillCredentials,
  solveLoginCaptcha,
  clickSignIn,
  waitForLoginForm,
} from "./login-form";
import { humanPause } from "./human";
import { proxyMetaFor, shouldLogExitIp, isProxyEnabled } from "../proxy";
import {
  slotMonitorProfileBase,
  saveSession,
  restoreSession,
  clearSession,
  saveVfsOptions,
  markRestricted,
  restrictedRemainingMin,
  markLoginAttempt,
  loginCooldownRemainingMin,
} from "./session";

// ── Timing (debug): SLOT_TIMING=true bo'lsa har bosqich vaqtini chop etadi ──
const TIMING = (process.env.SLOT_TIMING || "").trim().toLowerCase() === "true";
function makeLap(): (label: string) => void {
  const t0 = Date.now();
  let last = t0;
  return (label: string) => {
    if (!TIMING) return;
    const now = Date.now();
    const d = ((now - last) / 1000).toFixed(1);
    const tot = ((now - t0) / 1000).toFixed(1);
    console.log(`  ⏱  ${label.padEnd(30)} +${d}s  (jami ${tot}s)`);
    last = now;
  };
}

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
): Promise<{ picked: boolean; options: string[] }> {
  try {
    // 1) Dropdown tetigini (mat-select) topamiz — yorliq yoki tartib bo'yicha.
    //    Agar ALLAQACHON kerakli qiymat tanlangan bo'lsa (masalan, bitta markaz
    //    avto-tanlanadi) — ochmaymiz, "already" qaytaramiz (vaqt tejaladi).
    const opened = await page.evaluate(
      ({ orderIndex, labelHint, optionText }) => {
        const selects = Array.from(
          document.querySelectorAll(
            "mat-select, .mat-mdc-select, .mat-select, [role='combobox']",
          ),
        ) as HTMLElement[];
        if (selects.length === 0) return "none";

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
        if (!target) return "none";

        // Joriy ko'rsatilayotgan qiymat (placeholder bo'lmagan haqiqiy matn)?
        const valEl = target.querySelector(
          ".mat-mdc-select-value-text, .mat-select-value-text, .mat-mdc-select-value, .mat-select-value",
        );
        const cur = (valEl?.textContent || "").trim().toLowerCase();
        const isPlaceholder =
          !cur || cur.startsWith("select") || cur.startsWith("choose");
        const want = (optionText || "").trim().toLowerCase();
        if (!isPlaceholder) {
          // Aniq qiymat so'ralmagan, yoki joriy qiymat so'ralganga mos => tayyor.
          if (!want || cur === want || cur.includes(want)) return "already";
        }
        target.scrollIntoView({ block: "center" });
        target.click();
        return "opened";
      },
      { orderIndex, labelHint, optionText },
    );
    if (opened === "none") return { picked: false, options: [] };
    // Allaqachon kerakli qiymat tanlangan — ochish/kutish shart emas.
    if (opened === "already") return { picked: true, options: [] };

    // 2) Ochilgan overlay paneldagi variantlar render bo'lishini kutamiz.
    //    Sozlanadi: BOOKING_DROPDOWN_OPEN_TIMEOUT_MS (default 2500 — eski 6000
    //    juda uzun edi; variantlar 2.5s ichida chiqmasa, baribir chiqmaydi).
    await page
      .waitForSelector(
        "mat-option, .mat-mdc-option, .mat-option, [role='option']",
        {
          timeout: Number(process.env.BOOKING_DROPDOWN_OPEN_TIMEOUT_MS || 2500),
          state: "visible",
        },
      )
      .catch(() => {});

    // 3) Variantni matn bo'yicha tanlaymiz (bo'sh bo'lsa birinchi haqiqiysini).
    //    Bir vaqtda BARCHA variantlar ro'yxatini ham qaytaramiz (kelajakda
    //    formalar uchun saqlash maqsadida — centre/category/subCategory ro'yxati).
    const result = await page.evaluate((optionText) => {
      const opts = Array.from(
        document.querySelectorAll(
          "mat-option, .mat-mdc-option, .mat-option, [role='option']",
        ),
      ) as HTMLElement[];
      const options = opts
        .map((o) => (o.textContent || "").trim())
        .filter((t) => t.length > 0);
      if (opts.length === 0) return { picked: false, options };
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
      if (!chosen) return { picked: false, options };
      chosen.scrollIntoView({ block: "center" });
      chosen.click();
      return { picked: true, options };
    }, optionText);

    // Tanlovdan keyin bog'liq (dependent) dropdownlar yuklanishi uchun kutamiz.
    // Sozlanadi: BOOKING_DROPDOWN_SETTLE_MS. 900ms — bog'liq sub-category VFS'dan
    // yuklanib ulgurishi uchun (500ms juda qisqa edi — sub bo'sh qolardi).
    await page.waitForTimeout(
      Number(process.env.BOOKING_DROPDOWN_SETTLE_MS || 900),
    );
    return result;
  } catch {
    return { picked: false, options: [] };
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
  errorPage: boolean;
}> {
  return page.evaluate(
    ({ noSlotMarks, continueText, dateSel, calSel }) => {
      const bodyText = (document.body?.innerText || "").toLowerCase();
      const noSlot = noSlotMarks.some((m: string) => bodyText.includes(m));

      // VFS server xato sahifasi (500 / "unexpected error") — bu slot holati EMAS,
      // serverning vaqtinchalik xatosi yoki sessiya/so'rov mos kelmagani. Qayta
      // urinish kerak. Forma render bo'lmaydi (dropdownlar bo'sh chiqadi).
      const errorPage =
        bodyText.includes("unexpected error") ||
        bodyText.includes("error (500)") ||
        bodyText.includes("(500)") ||
        bodyText.includes("(502)") ||
        bodyText.includes("(503)") ||
        bodyText.includes("(504)");

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
        const cr = cont.getBoundingClientRect();
        const cst = window.getComputedStyle(cont);
        const cvis =
          cr.width > 0 &&
          cr.height > 0 &&
          cst.visibility !== "hidden" &&
          cst.display !== "none";
        continueEnabled = !disabled && cvis;
      }

      let calendarFound = false;
      for (const sel of calSel) {
        try {
          const anyVis = Array.from(document.querySelectorAll(sel)).some(
            (el) => {
              const r = el.getBoundingClientRect();
              const st = window.getComputedStyle(el);
              return (
                r.width > 0 &&
                r.height > 0 &&
                st.visibility !== "hidden" &&
                st.display !== "none"
              );
            },
          );
          if (anyVis) {
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
            const r = n.getBoundingClientRect();
            const st = window.getComputedStyle(n);
            const vis =
              r.width > 0 &&
              r.height > 0 &&
              st.visibility !== "hidden" &&
              st.display !== "none";
            if (!vis) continue;
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
        errorPage,
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
  bail?: () => boolean,
): Promise<"detail" | "login" | "unknown"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // 401/403 API javobi kelgan bo'lsa — token o'lik, kutib o'tirmaymiz.
    if (bail?.()) return "login";
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
  bail?: () => boolean,
): Promise<"dashboard" | "login" | "unknown"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // 401/403 API javobi kelgan bo'lsa — token o'lik, 30s kutmaymiz.
    if (bail?.()) return "login";
    const st = await page
      .evaluate(() => {
        const url = location.href.toLowerCase();
        const hasLogin = !!document.querySelector(
          "input[type='password'], #password, [formcontrolname='password']",
        );
        if (hasLogin || url.includes("/login") || url.includes("/auth"))
          return "login";
        // Token eskirgan: VFS "Session Expired or Invalid (401)" / page-not-found
        // sahifasiga olib boradi. Bu yerda login formasi YO'Q — 30s kutmasdan
        // DARROV "login" deb qaytaramiz (eski token o'chiriladi, toza login).
        const txt = (document.body?.innerText || "").toLowerCase();
        if (
          url.includes("page-not-found") ||
          url.includes("session-expired") ||
          txt.includes("session expired or invalid") ||
          txt.includes("session has expired") ||
          txt.includes("(401)")
        )
          return "expired";
        if (txt.includes("start new booking")) return "dashboard";
        return "loading";
      })
      .catch(() => "loading");
    if (st === "dashboard" || st === "login") return st;
    if (st === "expired") return "login"; // eski token — toza login kerak
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
    const lap = makeLap();
    // Login sahifasini yuklaymiz. 1-urinishda gotoDetail ALLAQACHON login URL'ni
    // ochgan bo'lsa — qayta yuklamaymiz (Angular bootstrap'ni noldan boshlamay,
    // ~1-2s tejaymiz). Retry'larda esa Turnstile toza render bo'lishi uchun
    // sahifani qayta yuklaymiz (oldingi "Verification failed" yo'qoladi).
    const onLogin = /\/login(\b|\/|$)/i.test(page.url().toLowerCase());
    if (attempt > 0 || !onLogin) {
      await page
        .goto(loginUrl(), { waitUntil: "domcontentloaded", timeout: 45000 })
        .catch(() => {});
    }
    await waitForCloudflareClear(page).catch(() => {});
    if (await acceptCookies(page)) {
      /* cookie qabul qilindi */
    }
    lap("goto login + cf + cookie");

    await waitForLoginForm(page);
    lap("email maydoni ko'rindi");

    // Turnstile token email/parol bilan PARALLEL yechiladi (umumiy login-form
    // moduli: booking login bilan bir xil mantiq — selektorlar/captcha takrorlanmaydi).
    const captchaPromise = startLoginCaptcha(page);
    await fillCredentials(page, email, password);
    lap("email/parol to'ldirildi");

    const captcha = await solveLoginCaptcha(page, captchaPromise);
    lap(`captcha: present=${captcha.present} solved=${captcha.solved}`);

    // Captcha hali ham o'tmagan bo'lsa — sahifani qayta yuklab yangi widget
    // bilan urinamiz (oxirgi urinish bo'lmasa). Yangi brauzer ochmaymiz.
    if (captcha.present && !captcha.solved && attempt < maxTries - 1) {
      continue;
    }

    await humanPause(150, 400);
    await clickSignIn(page);
    lap("Sign In bosildi");

    // Sign In bosgandan keyin IKKI holatdan birini kutamiz (qaysi avval bo'lsa):
    //  (a) login sahifasidan CHIQISH (URL o'zgardi) = muvaffaqiyat;
    //  (b) "Verification failed" / "please try again" xabari = VFS Turnstile
    //      tokenni RAD etdi → 20s behuda kutmasdan DARROV qayta urinamiz.
    const leftLogin = page
      .waitForURL((u) => !/\/login(\b|\/|$)/i.test(u.toString()), {
        timeout: 20000,
      })
      .then(() => true)
      .catch(() => false);
    const verifyFailed = page
      .waitForFunction(
        () => {
          const t = (
            document.body && document.body.innerText
              ? document.body.innerText
              : ""
          ).toLowerCase();
          return (
            t.indexOf("verification failed") >= 0 ||
            t.indexOf("verification unsuccessful") >= 0 ||
            t.indexOf("captcha verification") >= 0 ||
            t.indexOf("please try again") >= 0
          );
        },
        { timeout: 20000, polling: 500 },
      )
      .then(() => true)
      .catch(() => false);
    await Promise.race([leftLogin, verifyFailed]);
    await page.waitForTimeout(350).catch(() => {});
    lap("natija (login/captcha)");

    if (!/\/login(\b|\/|$)/i.test(page.url().toLowerCase())) {
      return true; // login sahifasidan chiqdi — muvaffaqiyatli.
    }
    // Hali login sahifasida (captcha rad etildi yoki timeout) — keyingi urinish
    // (sahifa qayta yuklanadi, yangi Turnstile widget bilan).
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
  const lap = makeLap();
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
    lap("brauzer ochildi");
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
      lap("goto loginUrl (origin)");
      if (await isAccountRestricted(page)) return "restricted";
      // 2) Saqlangan token'ni tiklaymiz (bo'lsa) — login so'ralmaydi.
      const hadToken = await restoreSession(page, profileKey);
      // Token YO'Q bo'lsa — dashboard'ga borish behuda (baribir login'ga
      // qaytaradi). To'g'ridan-to'g'ri "login" qaytaramiz: bitta ortiqcha
      // navigatsiya + waitForDashboardOrLogin kutishi tejaladi.
      if (!hadToken) return "login";
      // 3) Dashboard'ga o'tamiz.
      const resp = await page
        .goto(dashboardUrl(), {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        })
        .catch(() => null);
      base.statusCode = resp?.status() ?? base.statusCode;
      if (await isAccountRestricted(page)) return "restricted";
      const dash = await waitForDashboardOrLogin(
        page,
        readyMs,
        () => apiUnauthorized,
      );
      if (dash === "login") {
        // Token bor edi-yu, lekin dashboard ochilmadi (401 "Session Expired").
        // Eskirgan sessiya faylini O'CHIRAMIZ — keyingi tekshiruv uni qayta
        // sinamasin (sekin 401 yo'lini takrorlamasin), toza login qilsin.
        clearSession(profileKey);
        return "login";
      }
      if (dash === "unknown") return "unknown";
      // Dashboard tayyor — token amal qilyapti. Yangilab saqlaymiz.
      await saveSession(page, profileKey);
      const clicked = await clickStartNewBooking(page);
      if (!clicked) return "unknown";
      return waitForDetailOrLogin(page, readyMs, () => apiUnauthorized);
    };

    let state = await gotoDetail();
    lap(`gotoDetail: ${state}`);

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
      // Token o'lik (yo'q, yo eskirgan/401) — saqlangan sessiyani O'CHIRAMIZ,
      // keyingi tekshiruv uni qayta sinab vaqt sarflamasin (toza login qiladi).
      clearSession(profileKey);
      // Login QILMAYMIZ (token tekshiruvi bosqichi) — yuqoriga xabar beramiz.
      if (!doLogin) {
        await closeSession();
        closeSession = null;
        return { needLogin: true };
      }
      // COOLDOWN: yaqinda login qilingan bo'lsa — QAYTA LOGIN QILMAYMIZ
      // (har login VFS 429001 blokini uzaytiradi). Cooldown tugashini kutamiz.
      const cd = loginCooldownRemainingMin(profileKey);
      if (cd > 0) {
        await closeSession();
        closeSession = null;
        return {
          ...base,
          loggedIn: false,
          note: `Token amal qilmadi, lekin login cooldown faol — ${cd} daqiqadan keyin qayta login (akkauntni charchatmaslik uchun).`,
          durationMs: Date.now() - startedAt,
        };
      }
      // Login urinishini BELGILAYMIZ (cooldown shu vaqtdan boshlanadi).
      markLoginAttempt(profileKey);
      const ok = await loginInSession(page, email!, password!);
      lap(`loginInSession: ${ok}`);
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
    lap("detail tayyor + token saqlandi");

    // 3 ta dropdownni tartib bilan tanlaymiz. Variantlar ro'yxatini ham yig'amiz.
    const dCentre = await selectDropdown(page, 0, centre, "application centre");
    lap(
      `dropdown1 centre: picked=${dCentre.picked} opts=${dCentre.options.length}`,
    );
    const dCategory = await selectDropdown(
      page,
      1,
      category,
      "appointment category",
    );
    lap(
      `dropdown2 category: picked=${dCategory.picked} opts=${dCategory.options.length}`,
    );
    const dSub = await selectDropdown(page, 2, subCategory, "sub-category");
    lap(`dropdown3 sub: picked=${dSub.picked} opts=${dSub.options.length}`);

    // Sub-category category'ga BOG'LIQ — ba'zan VFS'dan kechroq yuklanadi.
    // Bo'sh chiqsa (0 variant) bir marta qisqa kutib qayta urinamiz.
    if (!dSub.picked && dSub.options.length === 0) {
      await page.waitForTimeout(800);
      const dSub2 = await selectDropdown(page, 2, subCategory, "sub-category");
      lap(
        `dropdown3 sub (retry): picked=${dSub2.picked} opts=${dSub2.options.length}`,
      );
      if (dSub2.options.length) dSub.options = dSub2.options;
      dSub.picked = dSub.picked || dSub2.picked;
    }

    // Dropdownlar umuman yuklandimi? Centre (1-chi, mustaqil) bo'sh bo'lsa —
    // detail sahifa to'g'ri render bo'lmagan (sessiya g'alati holat / Angular
    // yuklanmadi). Bu SLOT HOLATI emas, balki tekshiruv bajarilmaganini bildiradi.
    const dropdownsLoaded =
      dCentre.picked ||
      dCentre.options.length > 0 ||
      dCategory.options.length > 0 ||
      dSub.options.length > 0;

    // KELAJAK uchun: o'qilgan dropdown variantlarini diskka saqlaymiz
    // (uploads/slot-monitor-profiles/vfs-options-<key>.json) — formalarda
    // centre/category/subCategory ro'yxatini ishlatish mumkin.
    saveVfsOptions(profileKey, {
      centre: dCentre.options,
      category: dCategory.options,
      subCategory: dSub.options,
      selected: { centre, category, subCategory },
    });

    // VFS dropdownlardan KEYIN "Verify Captcha" (Cloudflare Turnstile) chiqaradi —
    // u yechilmaguncha Continue yoqilmaydi va kalendar ko'rinmaydi. Avval auto-pass
    // kutamiz (~3s), token kelmasa interaktiv checkbox'ni OS-klik bilan bosamiz.
    // "Verify Captcha" INTERMITTENT (ba'zan umuman chiqmaydi) — chiqmasa widget
    // paydo bo'lishini UZOQ (12s) kutmaymiz: appearMs qisqa (default 4s).
    const ts = await solveTurnstile(page, {
      step: (m) => lap(`turnstile: ${m}`),
      appearMs: Number(process.env.BOOKING_VERIFY_CAPTCHA_APPEAR_MS || "4000"),
    });
    lap(`turnstile: present=${ts.present} solved=${ts.solved}`);

    // "Verify Captcha" modalida "Submit" tugmasi bo'lsa — token olingach bosamiz
    // (modal yopilib, kalendar/natija ko'rsatiladi). Disabled bo'lsa tegmaymiz.
    if (ts.present) {
      const submitted = await page
        .evaluate(() => {
          const btns = Array.from(
            document.querySelectorAll("button, [role='button']"),
          ) as HTMLElement[];
          const submit = btns.find(
            (b) => (b.textContent || "").trim().toLowerCase() === "submit",
          );
          if (
            submit &&
            !(submit as HTMLButtonElement).disabled &&
            submit.getAttribute("aria-disabled") !== "true"
          ) {
            submit.click();
            return true;
          }
          return false;
        })
        .catch(() => false);
      if (submitted) {
        lap("turnstile: Submit bosildi");
        await page.waitForTimeout(800);
      }
    }

    // Dropdownlardan keyin natija (kalendar/xabar) render bo'lishini kutamiz.
    // Angular SPA ko'pincha "networkidle"ga YETMAYDI (uzluksiz polling) — shu
    // sababli to'liq 9s kutib o'tirmaymiz. Qisqa, sozlanadigan kutish:
    const settleMs = Number(process.env.BOOKING_CALENDAR_SETTLE_MS || 3500);
    await page
      .waitForLoadState("networkidle", { timeout: settleMs })
      .catch(() => {});
    await page.waitForTimeout(
      Number(process.env.BOOKING_CALENDAR_READ_DELAY_MS || 600),
    );

    const avail = await readAvailability(page, noSlotMarks, continueText);
    lap(
      `readAvailability: noSlot=${avail.noSlot} dates=${avail.availableDates.length}`,
    );
    base.screenshotPath = await maybeScreenshot(page, cfg.slotId);
    base.finalUrl = page.url();

    await closeSession();
    closeSession = null;

    base.calendarFound = avail.calendarFound;
    base.availableDates = avail.availableDates;
    base.durationMs = Date.now() - startedAt;

    // ── 1) SLOT OCHIQ (bron qilsa bo'ladi) ──────────────────────────────────
    // Bo'sh kun(lar) topildi YOKI Continue faol (sana keyingi bosqichda).
    if (avail.availableDates.length > 0) {
      return {
        ...base,
        open: true,
        note: `Slot OCHIQ — ${avail.availableDates.length} ta bo'sh kun bor`,
      };
    }
    if (avail.continueEnabled) {
      return {
        ...base,
        open: true,
        note: "Slot OCHIQ — Continue faol (sana mavjud)",
      };
    }

    // ── 2) SLOT OCHIQ EMAS — VFS xabari (slot umuman ochilmagan) ────────────
    // VFS aniq "no appointment slots currently available" deydi (Continue o'chiq).
    if (avail.noSlot) {
      return {
        ...base,
        open: false,
        note: "Slot ochiq EMAS (VFS xabari)",
      };
    }

    // ── 3) SLOT QOLMADI — kalendar bor, lekin bo'sh slot soni = 0 ───────────
    // Kalendar/sana tanlagich KO'RINADI (slot bo'limi ochilgan), ammo
    // tanlanadigan bo'sh kun YO'Q (soni 0) va Continue ham o'chiq. Demak slot
    // ochilgan edi, lekin barcha bo'sh o'rinlar band qilib bo'lingan = QOLMADI.
    if (avail.calendarFound) {
      return {
        ...base,
        open: false,
        note: "Slot qolmadi — bo'sh slotlar band qilingan (slot soni: 0)",
      };
    }

    // ── 4) TEKSHIRUV BAJARILMADI — sahifa kerakli bosqichga yetmadi ─────────
    // Na bo'sh kun, na "yo'q" xabari, na kalendar. Dropdownlar bo'sh bo'lsa,
    // detail sahifa to'liq yuklanmagan (sessiya g'alati / Angular render qilmadi)
    // — bu SLOT HOLATI emas, tekshiruv amalga oshmagani.
    // VFS 500 (server) xatosi — alohida, qayta urinish kerak.
    if (avail.errorPage || base.statusCode === 500) {
      // 500 "ma'lumot mos kelmadi" — odatda eskirgan/buzilgan token shu URL'da
      // 500 qaytaradi. Saqlangan sessiyani O'CHIRAMIZ: keyingi tekshiruv (login
      // cooldown'ga rioya qilib) toza login qilib o'zini-o'zi tuzatadi.
      clearSession(profileKey);
      return {
        ...base,
        open: false,
        note: "VFS server xatosi (500) — sessiya tozalandi, keyingi tekshiruvda qayta login",
      };
    }
    if (!dropdownsLoaded) {
      return {
        ...base,
        open: false,
        note: "Tekshiruv bajarilmadi — sahifa yuklanmadi (dropdownlar bo'sh, qayta urinish kerak)",
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
