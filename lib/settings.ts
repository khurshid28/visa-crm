/**
 * ====================================================================
 *  SETTINGS — tizim sozlamalari BAZADA (singleton AppSettings, id=1)
 * ====================================================================
 *  Avval proxy/headless/timeout qiymatlari faqat .env'da edi. Endi ular
 *  bazada saqlanadi va super-admin "Sozlamalar" sahifasidan tahrirlanadi.
 *
 *  ISHLASH TAMOYILI (hydrate):
 *   - getAppSettings()      : singleton yozuvni o'qiydi (yo'q bo'lsa joriy
 *                             .env qiymatlaridan yaratadi — silliq ko'chish).
 *   - applySettingsToEnv(s) : qiymatlarni process.env'ga yozadi, shu sababli
 *                             mavjud kod (proxy.ts, browser.ts, booking.ts)
 *                             o'zgarmaydi — endi qiymatlar bazadan keladi.
 *   - loadSettingsIntoEnv() : getAppSettings + applyToEnv (qisqa keshlangan).
 *                             Worker-pool startda va har job oldidan chaqiradi.
 *
 *  DIQQAT: Next.js server va worker-pool — ALOHIDA jarayonlar. Ikkalasi ham
 *  o'z process.env'ini bazadan hydrate qiladi (bir xil DB yozuvidan). Shu
 *  sababli sozlama o'zgarsa, ikkala jarayon ham (kesh muddati ichida) ko'radi.
 * ====================================================================
 */

import { prisma } from "./prisma";

export type AppSettings = {
  id: number;
  proxyEnabled: boolean;
  proxyHost: string;
  proxyPort: string;
  proxyUser: string;
  proxyPass: string;
  proxyCountries: string;
  chromeHeadless: boolean;
  captchaTimeoutMs: number;
  cfChallengeTimeoutMs: number;
  maxAttempts: number;
  ipRetries: number;
  workerPerCpu: number;
  updatedAt: Date;
  updatedBy: string | null;
};

/** UI/API uchun tahrirlanadigan maydonlar (id/updatedAt'siz). */
export type SettingsPatch = Partial<
  Omit<AppSettings, "id" | "updatedAt" | "updatedBy">
>;

const ENV_TRUE = (v: string | undefined): boolean => {
  const s = (v || "").trim().toLowerCase();
  return s === "true" || s === "1";
};

/**
 * Birinchi marta yozuv yaratilganda joriy .env qiymatlaridan to'ldiradi.
 * Shunda mavjud .env sozlamalari bazaga "ko'chadi" va keyin baza asosiy bo'ladi.
 */
function envSeed(): SettingsPatch {
  return {
    proxyEnabled: ENV_TRUE(process.env.PROXY_ENABLED),
    proxyHost: (process.env.PROXY_HOST || "").trim(),
    proxyPort: (process.env.PROXY_PORT || "").trim(),
    proxyUser: (process.env.PROXY_USER || "").trim(),
    proxyPass: (process.env.PROXY_PASS || "").trim(),
    proxyCountries: (process.env.PROXY_COUNTRIES || "uz,kz").trim(),
    chromeHeadless:
      (process.env.BOOKING_HEADLESS || "true").trim().toLowerCase() !== "false",
    captchaTimeoutMs: Number(process.env.BOOKING_CAPTCHA_TIMEOUT_MS || 30000),
    cfChallengeTimeoutMs: Number(
      process.env.BOOKING_CF_CHALLENGE_TIMEOUT_MS || 45000,
    ),
    maxAttempts: Number(process.env.ORDER_MAX_ATTEMPTS || 3),
    ipRetries: Number(process.env.BOOKING_PROXY_IP_RETRIES || 4),
    workerPerCpu: Number(process.env.WORKER_PER_CPU || 2),
  };
}

/**
 * Singleton AppSettings yozuvini qaytaradi. Yo'q bo'lsa — .env'dan yaratadi.
 */
export async function getAppSettings(): Promise<AppSettings> {
  const row = await prisma.appSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, ...envSeed() },
  });
  return row as AppSettings;
}

/** Sozlama qiymatlarini process.env'ga yozadi (mavjud kod shu env'ni o'qiydi). */
export function applySettingsToEnv(s: AppSettings): void {
  process.env.PROXY_ENABLED = s.proxyEnabled ? "true" : "false";
  process.env.PROXY_HOST = s.proxyHost;
  process.env.PROXY_PORT = s.proxyPort;
  process.env.PROXY_USER = s.proxyUser;
  process.env.PROXY_PASS = s.proxyPass;
  process.env.PROXY_COUNTRIES = s.proxyCountries;
  process.env.BOOKING_HEADLESS = s.chromeHeadless ? "true" : "false";
  process.env.BOOKING_CAPTCHA_TIMEOUT_MS = String(s.captchaTimeoutMs);
  process.env.BOOKING_CF_CHALLENGE_TIMEOUT_MS = String(s.cfChallengeTimeoutMs);
  process.env.ORDER_MAX_ATTEMPTS = String(s.maxAttempts);
  process.env.BOOKING_PROXY_IP_RETRIES = String(s.ipRetries);
  process.env.WORKER_PER_CPU = String(s.workerPerCpu);
}

// Hydrate kesh — har job/poll bazaga urmasin (TTL ichida keshdan beriladi).
const HYDRATE_TTL = Number(process.env.SETTINGS_HYDRATE_TTL_MS || 5000);
let cached: AppSettings | null = null;
let cachedAt = 0;
let inflight: Promise<AppSettings> | null = null;

/**
 * Sozlamalarni o'qib process.env'ga yuklaydi (keshlangan). Worker-pool
 * startda va har bosqich oldidan chaqiradi — eng yangi sozlama bilan ishlaydi.
 */
export async function loadSettingsIntoEnv(force = false): Promise<AppSettings> {
  if (!force && cached && Date.now() - cachedAt < HYDRATE_TTL) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const s = await getAppSettings();
      applySettingsToEnv(s);
      cached = s;
      cachedAt = Date.now();
      return s;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Sozlamani yangilaydi (super-admin), keshni tozalaydi va env'ga qo'llaydi. */
export async function updateAppSettings(
  patch: SettingsPatch,
  updatedBy?: string | null,
): Promise<AppSettings> {
  await getAppSettings(); // yozuv borligiga ishonch (yo'q bo'lsa yaratadi)
  const row = await prisma.appSettings.update({
    where: { id: 1 },
    data: { ...patch, updatedBy: updatedBy ?? null },
  });
  const s = row as AppSettings;
  applySettingsToEnv(s);
  cached = s;
  cachedAt = Date.now();
  return s;
}

/**
 * UI uchun xavfsiz ko'rinish — maxfiy parolni qaytarmaydi, faqat bor/yo'qligini.
 * updatedAt ISO satrga aylantiriladi (server-prop ham, API JSON ham bir xil shakl).
 */
export function maskSettings(s: AppSettings) {
  const { proxyPass, updatedAt, ...rest } = s;
  return {
    ...rest,
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
    hasProxyPass: Boolean(proxyPass),
  };
}

export type MaskedSettings = ReturnType<typeof maskSettings>;
