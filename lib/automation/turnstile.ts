// ====================================================================
//  TURNSTILE — Cloudflare Turnstile / challenge yechuvchi (qayta ishlatiladigan)
// ====================================================================
//  VFS login sahifasidagi Cloudflare himoyasini o'tish uchun YAGONA modul.
//  Ko'p joyda ishlatiladi (login.ts, calendar.ts, ...). Hech qachon throw qilmaydi.
//
//  ── Asosiy kirish nuqtasi ───────────────────────────────────────────────────
//    solveTurnstile(page, opts?) — to'liq oqim: challenge kutish → widget kutish →
//      token kelmasa checkbox bosish → token. { present, solved } qaytaradi.
//
//  ── Quyi darajali (kerak bo'lsa alohida) ────────────────────────────────────
//    waitForCloudflareClear(page)  — "Just a moment" interstitial hal bo'lishi
//    waitForTurnstile(page)        — widget bor-yo'qligi + token holati
//    clickTurnstile(page)          — interaktiv checkbox'ni bosadi (OS → CDP)
//    osClickTurnstile(page)        — HAQIQIY OS kursori bilan fizik klik
//    hasTurnstileToken(page)       — cf-turnstile-response to'lganmi
//
//  ── OS-CLICK (fizik klik) ───────────────────────────────────────────────────
//  CDP page.mouse.click() EMAS — OS kursori. Murakkab (interaktiv) Turnstile
//  trusted (isTrusted) klik talab qiladi; OS klik inson klikidan farq qilmaydi.
//   - Windows: lib/automation/os-click.ps1 (user32 SetCursorPos + mouse_event).
//   - Linux/Docker: xdotool (mousemove + click). Ekran kerak — docker-entrypoint.sh
//     Xvfb virtual ekran ochadi (BOOKING_XVFB=true) va Chrome NON-headless
//     ishlaydi, shu sababli interaktiv checkbox Docker'da ham bosiladi.
//  .env / compose: BOOKING_OS_CLICK=true + BOOKING_HEADLESS=false (+ Linux'da
//  DISPLAY o'rnatilgan, Xvfb ishlab turibdi). CDP auto-pass baribir BIRINCHI
//  sinaladi; OS-klik faqat token kelmaganda (interaktiv) ishga tushadi.
// ====================================================================

import type { Page } from "playwright";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import { rand } from "./human";
import { getLastChromePid } from "./browser";

// ── Selektorlar (bir joyda) ───────────────────────────────────────────────────
const TOKEN_INPUT = 'input[name="cf-turnstile-response"]';
const TURNSTILE_IFRAME =
  'iframe[src*="challenges.cloudflare.com"], .cf-turnstile iframe, #widgetId iframe';
const WIDGET_PRESENT =
  '.cf-turnstile, iframe[src*="challenges.cloudflare.com"]';
const WIDGET_OR_INPUT = `${TOKEN_INPUT}, [id^="cf-chl-widget"]`;

/**
 * Turnstile token (cf-turnstile-response) to'lганmi? Haqiqiy tokenlar 300+ belgi,
 * bo'sh = 0. Chegara > 20: Cloudflare TEST sitekey'ining dummy tokeni
 * ("XXXX.DUMMY.TOKEN.XXXX" = 21 belgi) ham aniqlansin (real test uchun).
 */
export async function hasTurnstileToken(page: Page): Promise<boolean> {
  return page
    .evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      return !!el && !!el.value && el.value.length > 20;
    }, TOKEN_INPUT)
    .catch(() => false);
}

// ====================================================================
//  YUQORI DARAJALI — solveTurnstile
// ====================================================================

/**
 * To'liq Turnstile oqimi (qayta ishlatiladigan):
 *  1) "Just a moment" managed challenge bo'lsa — hal bo'lishini kutadi.
 *  2) Turnstile widget'ini va token (auto-pass) ni kutadi.
 *  3) Token kelmasa va opts.click !== false — checkbox'ni bosadi (OS → CDP),
 *     so'ng token'ni qayta kutadi.
 * Hech qachon throw qilmaydi. { present, solved } qaytaradi.
 */
export async function solveTurnstile(
  page: Page,
  opts?: { step?: (m: string) => void; click?: boolean; appearMs?: number },
): Promise<{ present: boolean; solved: boolean }> {
  const step = opts?.step;

  // 1) Managed challenge interstitial ("Just a moment...").
  await waitForCloudflareClear(page, step).catch(() => {});

  // 2) Widget + auto-pass token. JUDA QISQA oyna beramiz (~3s) — auto-pass'ni
  //    UZOQ kutib o'tirmaymiz. Token shu qisqa vaqtda o'zi kelmasa, interaktiv
  //    checkbox bor demak — DARROV OS-klik bilan o'zimiz bosamiz (kutib turmaymiz).
  //    appearMs: captcha YO'Q bo'lsa widget paydo bo'lishini qancha kutamiz
  //    (intermittent "Verify Captcha" uchun chaqiruvchi qisqa qiymat beradi).
  const autoPassMs = Number(process.env.BOOKING_CAPTCHA_AUTOPASS_MS || "3000");
  let res = await waitForTurnstile(page, autoPassMs, opts?.appearMs);
  if (res.solved) {
    step?.("Turnstile token olindi (auto) ✓");
    return res;
  }

  // 3) Token kelmadi — interaktiv checkbox bo'lsa bosamiz.
  if (res.present && opts?.click !== false) {
    step?.("Turnstile token kelmadi — checkbox bosilmoqda...");
    await clickTurnstile(page, step).catch(() => {});
    res = await waitForTurnstile(page);
    if (res.solved) step?.("Turnstile token olindi (klik) ✓");
    else step?.("Turnstile token hali yo'q ✗");
  }
  return res;
}

// ====================================================================
//  WIDGET / TOKEN KUTISH
// ====================================================================

/**
 * Cloudflare Turnstile captcha'ni aniqlaydi va token to'lguncha kutadi.
 * Widget kech render bo'lishi mumkin (Angular SPA) — avval widget PAYDO
 * BO'LISHINI biroz kutamiz, keyin token kutamiz. { present, solved }.
 */
export async function waitForTurnstile(
  page: Page,
  tokenTimeoutMs?: number,
  appearTimeoutMs?: number,
): Promise<{ present: boolean; solved: boolean }> {
  // Token (auto-pass yoki klikdan keyin) kutish vaqti. Login oqimida BIRINCHI
  // kutish QISQA beriladi (auto-pass oynasi) — interaktiv checkbox bo'lsa to'liq
  // 30s kutmasdan darrov bosish uchun. Klikdan keyin to'liq vaqt beriladi.
  const timeoutMs =
    tokenTimeoutMs ?? Number(process.env.BOOKING_CAPTCHA_TIMEOUT_MS || "30000");
  // Widget paydo bo'lishini kutish vaqti (sahifa to'liq yuklanishini kutmaymiz).
  // Captcha YO'Q bo'lsa shu vaqt behuda ketadi — chaqiruvchi qisqa qiymat
  // berishi mumkin (masalan, dropdownlardan keyingi "Verify Captcha" intermittent).
  const appearMs =
    appearTimeoutMs ?? Number(process.env.BOOKING_CAPTCHA_APPEAR_MS || "12000");
  try {
    // Widget paydo bo'lishini kutamiz (iframe / hidden input / .cf-turnstile).
    await page
      .waitForFunction(
        (s) =>
          !!document.querySelector(s.widgetOrInput) ||
          !!document.querySelector(s.widget),
        { widgetOrInput: WIDGET_OR_INPUT, widget: WIDGET_PRESENT },
        { timeout: appearMs },
      )
      .catch(() => {});

    const present = await page
      .evaluate(
        (s) =>
          !!document.querySelector(s.widgetOrInput) ||
          !!document.querySelector(s.widget),
        { widgetOrInput: WIDGET_OR_INPUT, widget: WIDGET_PRESENT },
      )
      .catch(() => false);

    if (!present) return { present: false, solved: false };

    // Token to'lguncha kutamiz (cf-turnstile-response value uzunligi > 30).
    await page
      .waitForFunction(
        (sel) => {
          const el = document.querySelector(sel) as HTMLInputElement | null;
          return !!el && !!el.value && el.value.length > 30;
        },
        TOKEN_INPUT,
        { timeout: timeoutMs },
      )
      .catch(() => {});

    const solved = await hasTurnstileToken(page);
    return { present: true, solved };
  } catch {
    return { present: false, solved: false };
  }
}

/**
 * Cloudflare "Just a moment" / "Checking your browser" interstitial (managed
 * challenge) hal bo'lishini kutadi. JS challenge avtomatik bajarilib, asl
 * sahifaga o'tishini kutamiz. Hech qachon throw qilmaydi.
 *  - true: challenge yo'q yoki hal bo'ldi (asl sahifa ko'rindi).
 *  - false: vaqt tugadi, hali ham challenge/blokda.
 */
export async function waitForCloudflareClear(
  page: Page,
  step?: (m: string) => void,
): Promise<boolean> {
  const timeoutMs = Number(
    process.env.BOOKING_CF_CHALLENGE_TIMEOUT_MS || "45000",
  );
  const isChallenge = async (): Promise<boolean> => {
    try {
      return await page.evaluate(() => {
        const t = (document.title || "").toLowerCase();
        const b = (document.body?.innerText || "").toLowerCase();
        const marks = [
          "just a moment",
          "checking your browser",
          "verify you are human",
          "needs to review the security",
          "attention required",
        ];
        const hit = marks.some((m) => t.includes(m) || b.includes(m));
        // Challenge sahifasida odatda asosiy app (app-login/app-root) bo'lmaydi.
        const hasApp = !!document.querySelector(
          "app-login, app-root, #email, form",
        );
        return hit && !hasApp;
      });
    } catch {
      return false;
    }
  };

  if (!(await isChallenge())) return true;
  step?.("Cloudflare challenge aniqlandi, hal bo'lishi kutilmoqda...");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000).catch(() => {});
    if (!(await isChallenge())) {
      step?.("Cloudflare challenge hal bo'ldi ✓");
      await page
        .waitForLoadState("networkidle", { timeout: 8000 })
        .catch(() => {});
      return true;
    }
  }
  step?.("Cloudflare challenge hal bo'lmadi ✗");
  return false;
}

// ====================================================================
//  CHECKBOX KLIK (OS fizik → CDP zaxira)
// ====================================================================

/**
 * Turnstile checkbox'i interaktiv ("Verify you are human") bo'lsa — uni bosadi.
 *  0) BOOKING_OS_CLICK yoqilgan bo'lsa — avval HAQIQIY OS kursori bilan bosamiz.
 *  1) Aks holda iframe ICHIDAGI checkbox'ni frameLocator bilan bosamiz.
 *  2) Bo'lmasa — koordinata bo'yicha (iframe chap qismi) inson kabi bosamiz.
 * Har bosishdan keyin token kelishini kutamiz. Hech qachon throw qilmaydi.
 */
export async function clickTurnstile(
  page: Page,
  step?: (m: string) => void,
): Promise<boolean> {
  // ── OS-darajasidagi fizik klik (yoqilgan bo'lsa, eng ishonchli) ─────────────
  if (osClickEnabled()) {
    step?.("OS-klik yo'li (enabled)");
    if (await osClickTurnstile(page, step)) return true;
    step?.("OS-klik token bermadi → CDP zaxira");
    // OS klik o'tmadi — pastdagi CDP usuliga tushamiz (zaxira).
  } else {
    step?.("OS-klik O'CHIQ → CDP zaxira (frameLocator/koordinata)");
  }

  try {
    const frameEl = await page
      .waitForSelector(TURNSTILE_IFRAME, { state: "visible", timeout: 6000 })
      .catch(() => null);
    if (!frameEl) return false;

    // --- 1-usul: iframe ichidagi checkbox'ni frameLocator bilan bosamiz ---
    try {
      const fl = page.frameLocator(TURNSTILE_IFRAME).first();
      const candidates = [
        fl.locator('input[type="checkbox"]'),
        fl.getByLabel(/verify you are human|i am human|human/i),
        fl.locator("label"),
        fl.locator("body"),
      ];
      for (const c of candidates) {
        if ((await c.count().catch(() => 0)) > 0) {
          await c
            .first()
            .click({ timeout: 4000, force: true })
            .catch(() => {});
          for (let w = 0; w < 16; w++) {
            await page.waitForTimeout(500).catch(() => {});
            if (await hasTurnstileToken(page)) return true;
          }
        }
      }
    } catch {
      /* frameLocator ishlamadi — koordinataga o'tamiz */
    }

    // --- 2-usul: koordinata bo'yicha (iframe chap qismidagi checkbox) ---
    const box = await frameEl.boundingBox().catch(() => null);
    if (!box) return false;
    const tries = rand(2, 4);
    for (let i = 0; i < tries; i++) {
      // Checkbox odatda chap chetda (~30px). Tor diapazonda aniqroq bosamiz.
      const x = box.x + rand(24, 44);
      const y = box.y + box.height / 2 + rand(-4, 4);
      await page.mouse.move(x - rand(20, 60), y - rand(10, 30)).catch(() => {});
      await page.waitForTimeout(rand(120, 320)).catch(() => {});
      await page.mouse.move(x, y).catch(() => {});
      await page.waitForTimeout(rand(80, 200)).catch(() => {});
      await page.mouse.click(x, y).catch(() => {});
      for (let w = 0; w < 12; w++) {
        await page.waitForTimeout(500).catch(() => {});
        if (await hasTurnstileToken(page)) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ====================================================================
//  OS-DARAJASIDAGI FIZIK KLIK (Windows ps1 / Linux xdotool)
// ====================================================================

/**
 * OS-click yoqilganmi? Shartlar:
 *  - BOOKING_OS_CLICK=true
 *  - ko'rinadigan brauzer (BOOKING_HEADLESS=false) — ekran/kursor kerak
 *  - Windows: har doim (powershell mavjud)
 *  - Linux:   DISPLAY o'rnatilgan (Xvfb/X11) — aks holda kursor yo'q
 */
export function osClickEnabled(): boolean {
  if ((process.env.BOOKING_OS_CLICK || "").trim().toLowerCase() !== "true")
    return false;
  const hv = (process.env.BOOKING_HEADLESS || "true").toLowerCase();
  const visible = hv === "false" || hv === "0";
  if (!visible) return false;
  if (process.platform === "win32") return true;
  // Linux: faqat DISPLAY bo'lsa (Xvfb). Docker headless'da DISPLAY yo'q.
  return !!(process.env.DISPLAY || "").trim();
}

/**
 * Turnstile checkbox'ini HAQIQIY OS kursori bilan bosadi (CDP'siz). Token kelsa
 * true. Platformaga qarab Windows (os-click.ps1) yoki Linux (xdotool) ishlatadi.
 *  1) Oynani foreground'ga ko'taradi.
 *  2) Checkbox fizik koordinatasini o'lchaydi.
 *  3) OS-klik, token kelishini ~12s kutadi (3 urinish).
 */
export async function osClickTurnstile(
  page: Page,
  step?: (m: string) => void,
): Promise<boolean> {
  if (await hasTurnstileToken(page)) {
    step?.("osClick: token allaqachon bor (kirishda)");
    return true;
  }
  const isWin = process.platform === "win32";
  const script = isWin ? osClickScriptPath() : null;
  if (isWin && !script) {
    step?.("osClick: os-click.ps1 topilmadi");
    return false; // Windows'da skript topilmadi
  }

  const pid = getLastChromePid();

  // Checkbox koordinatasi tayyor bo'lguncha kutamiz — widget kech render bo'ladi
  // (ayniqsa dropdownlardan keyingi "Verify Captcha" modali iframe'ni biroz
  // kechroq chizadi). MUHIM: kutish davomida har gal TOKEN kelganini ham
  // tekshiramiz — managed/"Verifying..." Turnstile o'zi (auto) tugashi mumkin,
  // unda klik SHART EMAS, darrov true qaytaramiz (sekin CDP zaxiraga tushmaymiz).
  const measureMs = Number(process.env.BOOKING_CAPTCHA_MEASURE_MS || "8000");
  const tMeasure = Date.now();
  let coord: { physX: number; physY: number } | null = null;
  const measureDeadline = Date.now() + measureMs;
  while (Date.now() < measureDeadline) {
    if (await hasTurnstileToken(page)) {
      step?.(
        `osClick: token o'lchash paytida keldi (auto) +${((Date.now() - tMeasure) / 1000).toFixed(1)}s`,
      );
      return true;
    }
    coord = await measureTurnstilePhysical(page);
    if (coord) break;
    await page.waitForTimeout(500).catch(() => {});
  }
  if (!coord) {
    step?.(
      `osClick: o'lchov MUVAFFAQIYATSIZ +${((Date.now() - tMeasure) / 1000).toFixed(1)}s (iframe topilmadi)`,
    );
    return false;
  }
  step?.(`o'lchov tayyor +${((Date.now() - tMeasure) / 1000).toFixed(1)}s`);

  for (let t = 0; t < 3; t++) {
    // 1-urinishda yuqoridagi measureWithRetry koordinatasini ishlatamiz (qayta
    // o'lchamaymiz — vaqt tejaymiz). 2-urinishdan qayta o'lchaymiz (klik tegmagan
    // bo'lsa widget biroz siljigan bo'lishi mumkin).
    if (t > 0) {
      const cFresh = await measureTurnstilePhysical(page);
      if (cFresh) coord = cFresh;
    }

    // osClickAt kompilyatsiya qilingan KICHIK .exe ni chaqiradi (VfsOsClick.exe)
    // — u oynani o'zi ENG USTGA ko'taradi (AttachThreadInput + SetWindowPos) va
    // kursorni inson kabi ko'chirib bosadi. powershell.exe YO'Q => ~0.5s (cache'da).
    const tClick = Date.now();
    await osClickAt(coord.physX, coord.physY, pid, script);
    step?.(
      `OS-klik #${t + 1} (${((Date.now() - tClick) / 1000).toFixed(1)}s) — token kutilmoqda...`,
    );

    // HAQIQIY klikdan keyin token ~2-4s da keladi. Kelmasa — klik tegmagandir,
    // uzoq kutmaymiz: qayta o'lchab qayta bosamiz.
    for (let w = 0; w < 14; w++) {
      await page.waitForTimeout(400).catch(() => {});
      if (await hasTurnstileToken(page)) {
        step?.(
          `token keldi (urinish ${t + 1}, +${((Date.now() - tClick) / 1000).toFixed(1)}s)`,
        );
        return true;
      }
    }
    step?.(
      `urinish ${t + 1}: token kelmadi (+${((Date.now() - tClick) / 1000).toFixed(1)}s)`,
    );
  }
  return false;
}

/**
 * TEST-ONLY: Turnstile checkbox'iga MAJBURIY OS-klik — token bor-yo'qligidan
 * QAT'I NAZAR, auto-pass'ni KUTMASDAN. Kursorni darrov checkbox ustiga olib
 * borib bosadi, shunda fizik klik ishlayotganini KO'Z bilan ko'rish mumkin.
 * Har bosqichni log qiladi. Faqat captcha-click-test.ts uchun.
 */
export async function forceOsClickTurnstile(
  page: Page,
  log: (m: string) => void = () => {},
): Promise<{
  enabled: boolean;
  measured: boolean;
  physX: number;
  physY: number;
  tokenBefore: boolean;
  tokenAfter: boolean;
  measureMs: number;
  clickMs: number;
  solveMs: number;
  totalMs: number;
}> {
  const tStart = Date.now();
  const el = (ms: number) => (ms / 1000).toFixed(1);
  const enabled = osClickEnabled();
  const tokenBefore = await hasTurnstileToken(page);
  const fail = (measured = false, physX = 0, physY = 0) => ({
    enabled,
    measured,
    physX,
    physY,
    tokenBefore,
    tokenAfter: tokenBefore,
    measureMs: 0,
    clickMs: 0,
    solveMs: 0,
    totalMs: Date.now() - tStart,
  });

  log(
    `osClickEnabled = ${enabled}  (BOOKING_OS_CLICK=true + BOOKING_HEADLESS=false kerak)`,
  );
  log(`token bor (klikdan oldin) = ${tokenBefore}`);
  if (tokenBefore)
    log(
      "DIQQAT: token ALLAQACHON bor — Cloudflare auto-pass qildi. Klik baribir " +
        "bajariladi (kursor harakatini KO'RASIZ), lekin bu interaktiv checkbox EMAS.",
    );
  if (!enabled) {
    log(
      'OS-klik o\'chiq — .env: BOOKING_OS_CLICK="true" va BOOKING_HEADLESS="false" bo\'lsin.',
    );
    return fail();
  }

  const isWin = process.platform === "win32";
  const script = isWin ? osClickScriptPath() : null;
  if (isWin && !script) {
    log("os-click.ps1 topilmadi (lib/automation/os-click.ps1).");
    return fail();
  }
  const pid = getLastChromePid();
  log(`chrome pid = ${pid ?? "(noma'lum)"}`);

  const tMeasure = Date.now();
  let coord = await measureWithRetry(page, 10);
  const measureMs = Date.now() - tMeasure;
  if (!coord) {
    log(
      `✗ Turnstile checkbox topilmadi — iframe (challenges.cloudflare.com) render bo'lmadi. (o'lchov ${el(measureMs)}s)`,
    );
    return { ...fail(), measureMs, totalMs: Date.now() - tStart };
  }
  log(
    `checkbox fizik koordinata = (${coord.physX}, ${coord.physY})  ⏱ o'lchov ${el(measureMs)}s`,
  );

  const tClick = Date.now();
  for (let t = 0; t < 3; t++) {
    const tAttempt = Date.now();
    log(
      `── urinish ${t + 1}/3: kursor + klik (OS o'zi oynani ustga ko'taradi) ──`,
    );
    const fresh = await measureTurnstilePhysical(page);
    if (fresh) {
      coord = fresh;
      log(`o'lchov = (${fresh.physX}, ${fresh.physY})`);
    }
    await osClickAt(coord.physX, coord.physY, pid, script);
    log(
      `→ OS-klik yuborildi ⏱ (klik ${el(Date.now() - tAttempt)}s). Kursor checkbox ustiga borib bosishi kerak.`,
    );
    for (let w = 0; w < 14; w++) {
      await page.waitForTimeout(400).catch(() => {});
      if (await hasTurnstileToken(page)) {
        const how = tokenBefore ? "(avval ham bor edi)" : "KLIKDAN KEYIN";
        const solveMs = Date.now() - tClick;
        log(
          `✓ TOKEN BOR ${how} — ${el((w + 1) * 400)}s ichida (klik→token ${el(solveMs)}s).`,
        );
        return {
          enabled,
          measured: true,
          physX: coord.physX,
          physY: coord.physY,
          tokenBefore,
          tokenAfter: true,
          measureMs,
          clickMs: Date.now() - tClick,
          solveMs,
          totalMs: Date.now() - tStart,
        };
      }
    }
    log(
      `… token kelmadi (urinish ${t + 1} = ${el(Date.now() - tAttempt)}s), qayta urinaman.`,
    );
  }
  const clickMs = Date.now() - tClick;
  log(
    `✗ 3 urinishdan keyin ham token kelmadi. ⏱ klik bosqichi ${el(clickMs)}s`,
  );
  return {
    enabled,
    measured: true,
    physX: coord.physX,
    physY: coord.physY,
    tokenBefore,
    tokenAfter: false,
    measureMs,
    clickMs,
    solveMs: 0,
    totalMs: Date.now() - tStart,
  };
}

/**
 * TEST-ONLY: Berilgan selektordagi ELEMENTNI haqiqiy OS kursori bilan bosadi.
 * Cloudflare'ga bog'liq EMAS — OS-klik mexanizmini mahalliy sahifada (yoki
 * istalgan elementda) sinab ko'rish uchun. Element markazini fizik ekran
 * koordinatasiga aylantirib, oynani old planga ko'tarib, OS-klik yuboradi.
 * Faqat os-click-proof.ts uchun.
 */
export async function osPhysicalClickElement(
  page: Page,
  selector: string,
  log: (m: string) => void = () => {},
): Promise<{ enabled: boolean; physX: number; physY: number } | null> {
  const enabled = osClickEnabled();
  log(`osClickEnabled = ${enabled}`);
  if (!enabled) {
    log(
      'OS-klik o\'chiq — .env: BOOKING_OS_CLICK="true" + BOOKING_HEADLESS="false".',
    );
    return null;
  }
  const isWin = process.platform === "win32";
  const script = isWin ? osClickScriptPath() : null;
  if (isWin && !script) {
    log("os-click.ps1 topilmadi.");
    return null;
  }
  const pid = getLastChromePid();
  log(`chrome pid = ${pid ?? "(noma'lum)"}`);

  const coord = await measureElementPhysical(page, selector);
  if (!coord) {
    log(`✗ element topilmadi: ${selector}`);
    return null;
  }
  log(`element fizik koordinata = (${coord.physX}, ${coord.physY})`);

  await focusBrowserWindow(pid, script);
  await page.waitForTimeout(250).catch(() => {});
  const fresh = await measureElementPhysical(page, selector);
  const c = fresh || coord;
  log("→ OS-klik yuborilmoqda… (kursor element ustiga borib bosadi)");
  await osClickAt(c.physX, c.physY, pid, script);
  return { enabled, physX: c.physX, physY: c.physY };
}

/**
 * Berilgan selektordagi elementning MARKAZINI fizik ekran koordinatasiga
 * (devicePixelRatio bilan) aylantiradi. phys = (screenX/Y + chromeTop + cx/cy) * dpr.
 */
async function measureElementPhysical(
  page: Page,
  selector: string,
): Promise<{ physX: number; physY: number } | null> {
  try {
    return await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      el.scrollIntoView({ block: "center", behavior: "instant" as never });
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      const chromeTop = window.outerHeight - window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      return {
        physX: Math.round((window.screenX + r.x + r.width / 2) * dpr),
        physY: Math.round(
          (window.screenY + chromeTop + r.y + r.height / 2) * dpr,
        ),
      };
    }, selector);
  } catch {
    return null;
  }
}

/** Koordinatani bir necha marta o'lchashga urinadi (widget kech render bo'ladi). */
async function measureWithRetry(
  page: Page,
  attempts: number,
): Promise<{ physX: number; physY: number } | null> {
  for (let i = 0; i < attempts; i++) {
    const c = await measureTurnstilePhysical(page);
    if (c) return c;
    await page.waitForTimeout(600).catch(() => {});
  }
  return null;
}

/** Brauzer oynasini foreground'ga ko'taradi (Windows ps1 / Linux xdotool). */
async function focusBrowserWindow(
  pid: number | null,
  winScript: string | null,
): Promise<void> {
  if (process.platform === "win32") {
    if (winScript && pid)
      await runPs(winScript, ["-procId", String(pid), "-focusOnly"]);
    return;
  }
  // Linux (Xvfb): window manager YO'Q — `windowactivate` osilib qolishi mumkin.
  // `windowraise` WM'siz ishlaydi va oynani ko'taradi. Klik baribir absolyut
  // koordinata bo'yicha boradi (X pointer ostidagi oynaga tushadi), shuning
  // uchun fokus shart emas — bu faqat oynani oldinga chiqarish.
  if (pid) {
    await runCmd("sh", [
      "-c",
      `xdotool search --pid ${pid} windowraise 2>/dev/null | head -n1 || true`,
    ]).catch(() => {});
  }
}

/** Berilgan fizik koordinataga OS-klik (Windows ps1 / Linux xdotool). */
async function osClickAt(
  physX: number,
  physY: number,
  pid: number | null,
  winScript: string | null,
): Promise<void> {
  if (process.platform === "win32") {
    // Avval kompilyatsiya qilingan KICHIK .exe (tez ~0.5s — powershell.exe YO'Q).
    // Ishlamasa (compile bo'lmadi) — bir martalik os-click.ps1 ga tushamiz.
    const exe = await ensureOsClickExe();
    if (exe) {
      await runCmd(exe, [String(physX), String(physY), String(pid ?? 0)]);
      return;
    }
    if (!winScript) return;
    const args = ["-x", String(physX), "-y", String(physY)];
    if (pid) args.push("-procId", String(pid));
    await runPs(winScript, args);
    return;
  }
  // Linux: xdotool bilan kursorni INSON KABI ko'chirib chap klik. Bir zumlik
  // teleport EMAS — tasodifiy yo'nalishdan yaqinlashib, ±3px tebranish bilan
  // boradi (anti-bot kursor traektoriyasini kuzatadi, bot izini kamaytiramiz).
  const ax = String(physX + rand(-70, -30));
  const ay = String(physY + rand(-50, -20));
  const fx = String(physX + rand(-3, 3));
  const fy = String(physY + rand(-3, 3));
  await runCmd("xdotool", [
    "mousemove",
    ax,
    ay,
    "sleep",
    "0.05",
    "mousemove",
    fx,
    fy,
    "sleep",
    (0.06 + Math.random() * 0.08).toFixed(2),
    "mousemove",
    String(physX),
    String(physY),
    "sleep",
    (0.05 + Math.random() * 0.06).toFixed(2),
    "click",
    "1",
  ]).catch(() => {});
}

/**
 * Turnstile checkbox'ining FIZIK ekran koordinatasini (devicePixelRatio bilan)
 * hisoblaydi. phys = (screenX/Y + chromeTop + clientX/Y) * dpr.
 * Checkbox iframe chap chetida (~28px), vertikal markazda. Topilmasa null.
 *
 * MUHIM: Turnstile iframe'ni SHADOW DOM ichiga joylashtiradi —
 * document.querySelectorAll("iframe") uni KO'RMAYDI. Shu sababli barcha
 * shadowRoot'larni REKURSIV kezamiz. Iframe topilmasa — .cf-turnstile /
 * [id^=cf-chl-widget] KONTEYNERIGA tushamiz (u light DOM'da, har doim topiladi).
 */
async function measureTurnstilePhysical(
  page: Page,
): Promise<{ physX: number; physY: number } | null> {
  try {
    return await page.evaluate(() => {
      // MUHIM: tsx/esbuild page.evaluate ICHIDAGI NOMLI funksiyalarga __name()
      // yordamchisini qo'shadi — u brauzerda yo'q, "ReferenceError: __name is
      // not defined" beradi. Shu sababli bu yerda NOMLI funksiya ISHLATMAYMIZ:
      // shadow DOM'ni ITERATIV (stack) kezamiz, faqat anonim callback'lar.
      const chromeTop = window.outerHeight - window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      const sx = window.screenX;
      const sy = window.screenY;

      // Light DOM + barcha shadowRoot'lardan iframe yig'amiz (rekursiyasiz).
      const iframes: HTMLIFrameElement[] = [];
      const stack: Array<Document | ShadowRoot> = [document];
      while (stack.length) {
        const root = stack.pop();
        if (!root) continue;
        root
          .querySelectorAll("iframe")
          .forEach((f) => iframes.push(f as HTMLIFrameElement));
        root.querySelectorAll("*").forEach((el) => {
          const sr = (el as HTMLElement).shadowRoot;
          if (sr) stack.push(sr);
        });
      }

      let best: HTMLIFrameElement | null = null;
      let bestScore = -1;
      iframes.forEach((f) => {
        const r = f.getBoundingClientRect();
        const s = (f.getAttribute("src") || "").toLowerCase();
        const cfSrc =
          s.includes("challenges.cloudflare") || s.includes("turnstile");
        const sizeOk =
          r.width >= 60 && r.width <= 900 && r.height >= 40 && r.height <= 160;
        if ((cfSrc || sizeOk) && r.width > 0 && r.height > 0) {
          const score = (cfSrc ? 1e7 : 0) + r.width * r.height;
          if (score > bestScore) {
            bestScore = score;
            best = f;
          }
        }
      });

      // 1) Haqiqiy iframe (shadow DOM ichida ham) — eng aniq.
      if (best) {
        const bf = best as HTMLIFrameElement;
        bf.scrollIntoView({ block: "center", behavior: "instant" as never });
        const r = bf.getBoundingClientRect();
        // Checkbox iframe chap chetida ~28px, vertikal markazda.
        return {
          physX: Math.round((sx + r.x + 28) * dpr),
          physY: Math.round((sy + chromeTop + r.y + r.height / 2) * dpr),
        };
      }

      // 2) Iframe topilmadi — KONTEYNER (light DOM) bo'yicha. Checkbox widget
      //    chap chetida ~28px, YUQORIDAN ~32px (test sitekey'da pastda qizil
      //    banner bo'lsa height/2 pastga tushib ketadi — fiks ofset ishonchli).
      const box = document.querySelector(
        '.cf-turnstile, [id^="cf-chl-widget"]',
      ) as HTMLElement | null;
      if (box) {
        box.scrollIntoView({ block: "center", behavior: "instant" as never });
        const r = box.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const cy = r.y + Math.min(32, r.height / 2);
          return {
            physX: Math.round((sx + r.x + 28) * dpr),
            physY: Math.round((sy + chromeTop + cy) * dpr),
          };
        }
      }
      return null;
    });
  } catch {
    return null;
  }
}

/** os-click.ps1 skript yo'lini topadi (lib/automation/ ichida). */
function osClickScriptPath(): string | null {
  const candidates: string[] = [];
  // tsx/CJS rejimda __dirname mavjud; ESM'da typeof undefined (xato bermaydi).
  if (typeof __dirname === "string")
    candidates.push(path.join(__dirname, "os-click.ps1"));
  candidates.push(
    path.join(process.cwd(), "lib", "automation", "os-click.ps1"),
  );
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** PowerShell skriptni ishga tushiradi (tugashini kutadi). */
function runPs(scriptPath: string, args: string[]): Promise<void> {
  return runCmd("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    ...args,
  ]);
}

/** Tashqi buyruqni ishga tushiradi (stdio yo'q, tugashini kutadi, throw qilmaydi). */
function runCmd(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: "ignore" });
      p.on("close", () => resolve());
      p.on("error", () => resolve());
    } catch {
      resolve();
    }
  });
}

// ====================================================================
//  KOMPILYATSIYA QILINGAN .exe (Windows) — TEZ OS-klik (powershell.exe'siz)
// ====================================================================
//  powershell.exe ni HAR klikda ochish ~3-5s (sovuq start 1.8s + .NET tip
//  yuklash 1.5s). Buni butunlay YO'Q qilish uchun os-click.cs ni BIR MARTA
//  (umrida) kichik .exe ga kompilyatsiya qilamiz (TEMP'ga cache). Keyin HAR
//  klik shu .exe ni to'g'ridan-to'g'ri chaqiradi: .NET console start ~0.1s +
//  kursor harakati ~0.4s = ~0.5s. Birinchi klikda ham tez (faqat eng birinchi
//  marta ~3s compile, u ham bir martalik va keyingi run'larda cache'dan).
let osExeReady: Promise<string | null> | null = null;

/** os-click.cs manba yo'lini topadi (lib/automation/ ichida). */
function osClickCsPath(): string | null {
  const candidates: string[] = [];
  if (typeof __dirname === "string")
    candidates.push(path.join(__dirname, "os-click.cs"));
  candidates.push(path.join(process.cwd(), "lib", "automation", "os-click.cs"));
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Kompilyatsiya qilingan .exe cache yo'li (TEMP). */
function osClickExePath(): string {
  return path.join(os.tmpdir(), "VfsOsClick_v1.exe");
}

/**
 * os-click.cs ni .exe ga kompilyatsiya qiladi (PowerShell Add-Type orqali,
 * BIR MARTA). Muvaffaqiyatli bo'lsa .exe yo'lini, aks holda null qaytaradi.
 */
async function compileOsClickExe(cs: string, exe: string): Promise<boolean> {
  // PowerShell: manbani o'qib, WindowsApplication (konsolsiz) .exe ga compile.
  const psCmd =
    `try { Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath '${cs.replace(/'/g, "''")}') ` +
    `-OutputAssembly '${exe.replace(/'/g, "''")}' -OutputType WindowsApplication -ErrorAction Stop } catch { exit 1 }`;
  await runCmd("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    psCmd,
  ]);
  try {
    return fs.existsSync(exe);
  } catch {
    return false;
  }
}

/**
 * .exe tayyorligini ta'minlaydi (cache bo'lsa darrov, bo'lmasa bir marta
 * compile). Natija memoizatsiya qilinadi — keyingi kliklar darrov yo'lni oladi.
 */
function ensureOsClickExe(): Promise<string | null> {
  if (osExeReady) return osExeReady;
  osExeReady = (async () => {
    const exe = osClickExePath();
    try {
      if (fs.existsSync(exe)) return exe; // cache bor — darrov.
    } catch {
      /* ignore */
    }
    const cs = osClickCsPath();
    if (!cs) return null;
    const ok = await compileOsClickExe(cs, exe);
    return ok ? exe : null;
  })();
  return osExeReady;
}
