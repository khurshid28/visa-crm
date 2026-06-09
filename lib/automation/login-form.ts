// ====================================================================
//  LOGIN-FORM — VFS login formasining QAYTA ISHLATILADIGAN asosiy bosqichlari
// ====================================================================
//  Bu modul login oqimining "umumiy yadrosi"ni bitta joyda saqlaydi:
//  forma maydonlarini kutish + email/parol to'ldirish + Turnstile token
//  yechish + "Sign In" bosish. IKKI joyda ishlatiladi:
//    - login.ts   → loginToBooking()  (booking: yangi brauzer ochib login)
//    - calendar.ts → loginInSession()  (slot check: ochiq sessiyada login)
//  Shu sababli har ikkalasida bir xil selektorlar/captcha mantig'i takrorlanmaydi
//  (clean code: yagona manba). Hech bir funksiya throw qilmaydi.
// ====================================================================

import type { Page } from "playwright";
import { humanPause } from "./human";
import { fillFieldReliably, acceptCookies } from "./page-utils";
import { clickTurnstile, waitForTurnstile } from "./turnstile";

/** Turnstile holati: widget bor-yo'qligi + token to'lgan-to'lmagani. */
export type CaptchaState = { present: boolean; solved: boolean };

/** Step-logger turi (ixtiyoriy — booking login bosqichlarni chiqaradi). */
export type StepFn = (msg: string) => void;

// ── Selektorlar (YAGONA manba) ────────────────────────────────────────────────
//  Angular Material formasi: ko'rinadigan #email/#password (yashirin
//  #username/#password1 EMAS). Sign In tugmasi matn yoki type=submit bo'yicha.
export const LOGIN_SELECTORS = {
  email: '#email, input[formcontrolname="username"]',
  password: '#password, input[formcontrolname="password"]',
  signIn:
    'button:has-text("Sign In"), button:has-text("Sign in"), button[type="submit"]',
} as const;

/**
 * Auto-pass kutish oynasi (ms): Turnstile token sahifa yuklanishi bilan FONda
 * yechila boshlaydi. Shu QISQA oynada o'zi kelmasa — interaktiv checkbox bor
 * demak, OS-klik bilan o'zimiz bosamiz. Qisqa (~1s) — OS-klikка tezroq o'tamiz;
 * auto-pass YO'QOLMAYDI, chunki OS-klik sikli token kelishini har 400ms tekshiradi.
 */
function autoPassMs(): number {
  return Number(process.env.BOOKING_CAPTCHA_AUTOPASS_MS || "1000");
}

/** Klikdan keyin token kelishini tasdiqlash kutish oynasi (ms). */
function confirmMs(): number {
  return Number(process.env.BOOKING_CAPTCHA_CONFIRM_MS || "4000");
}

/**
 * Email maydoni ko'rinishini kutadi (Angular SPA kech render qiladi).
 * Ko'rinsa true, timeoutda jim false qaytaradi (throw qilmaydi).
 */
export async function waitForLoginForm(
  page: Page,
  timeoutMs = 20000,
): Promise<boolean> {
  return page
    .waitForSelector(LOGIN_SELECTORS.email, {
      state: "visible",
      timeout: timeoutMs,
    })
    .then(() => true)
    .catch(() => false);
}

/**
 * Turnstile token kutishni (auto-pass) PARALLEL ishga tushiradi. Email/parol
 * to'ldirilayotganda token fonda yechiladi — keyin qo'shimcha kutish ~0 bo'ladi.
 * Natijani keyin solveLoginCaptcha() ga uzating.
 */
export function startLoginCaptcha(page: Page): Promise<CaptchaState> {
  return waitForTurnstile(page, autoPassMs());
}

/**
 * Email + parolni inson kabi (ishonchli) to'ldiradi. Maydon topilmasa — chala
 * deb belgilaydi (emailFound=false), lekin throw qilmaydi.
 */
export async function fillCredentials(
  page: Page,
  email: string,
  password: string,
  step?: StepFn,
): Promise<{
  filledEmail: boolean;
  filledPassword: boolean;
  emailFound: boolean;
  passwordFound: boolean;
}> {
  let filledEmail = false;
  let filledPassword = false;

  const emailEl = page.locator(LOGIN_SELECTORS.email).first();
  const emailFound = (await emailEl.count()) > 0;
  if (emailFound) {
    filledEmail = await fillFieldReliably(page, emailEl, email);
    step?.(
      filledEmail ? "Email kiritildi" : "Email to'liq kiritilmadi (chala)",
    );
  } else {
    step?.("Email maydoni topilmadi!");
  }
  await humanPause();

  const passEl = page.locator(LOGIN_SELECTORS.password).first();
  const passwordFound = (await passEl.count()) > 0;
  if (passwordFound) {
    filledPassword = await fillFieldReliably(page, passEl, password);
    step?.(
      filledPassword ? "Parol kiritildi" : "Parol to'liq kiritilmadi (chala)",
    );
  } else {
    step?.("Parol maydoni topilmadi!");
  }
  await humanPause();

  return { filledEmail, filledPassword, emailFound, passwordFound };
}

/**
 * Turnstile'ni yechadi: PARALLEL boshlangan auto-pass kutishini yig'adi, token
 * o'zi kelmagan bo'lsa checkbox ustiga bosadi (OS-klik → CDP zaxira) va token
 * kelishini qisqa tasdiqlaydi. clickTurnstile o'zi to'liq token byudjetini
 * kutadi, shuning uchun bu yerda ikki marta 30s kutilmaydi.
 *
 * `wasPresent`: widget BIR MARTA bo'lsa ham true (klikdan keyin widget qayta
 * render bo'lib `present` bir lahza false o'qilishi mumkin — shunga tayanib
 * "captcha yo'q" deb noto'g'ri xulosa chiqmasligi uchun sticky bayroq).
 */
export async function solveLoginCaptcha(
  page: Page,
  captchaPromise: Promise<CaptchaState>,
  step?: StepFn,
): Promise<CaptchaState & { wasPresent: boolean }> {
  let captcha = await captchaPromise;
  let wasPresent = captcha.present;
  if (captcha.present && !captcha.solved) {
    step?.("Captcha o'zi o'tmadi — ustiga bosilmoqda...");
    const clicked = await clickTurnstile(page, step).catch(() => false);
    if (clicked) step?.("Captcha ustiga bosildi, token kutilmoqda...");
    captcha = await waitForTurnstile(page, confirmMs());
    if (captcha.present) wasPresent = true;
  }
  return { present: captcha.present, solved: captcha.solved, wasPresent };
}

/**
 * "Sign In" tugmasini bosadi (avval cookie bannerini yopadi — tugmani to'smasin).
 * Tugma topilib bosilsa true. Hech qachon throw qilmaydi.
 */
export async function clickSignIn(page: Page, step?: StepFn): Promise<boolean> {
  if (await acceptCookies(page)) step?.("Cookie qabul qilindi");
  const btn = page.locator(LOGIN_SELECTORS.signIn).first();
  if ((await btn.count()) > 0) {
    await btn.click({ timeout: 8000 }).catch(() => {});
    step?.("Sign In bosildi");
    return true;
  }
  step?.("Sign In tugmasi topilmadi!");
  return false;
}
