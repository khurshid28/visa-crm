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

  // --- VFS / Booking URL'lari ---
  registerUrl: string;
  loginUrl: string;
  orderUrl: string;
  calendarUrl: string;
  warmupUrl: string;

  // --- Email / domen ---
  emailDomain: string;

  // --- Telegram bot ---
  telegramBotToken: string;
  telegramAdminChatIds: string;

  // --- Gmail / IMAP ---
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string;
  imapMailbox: string;
  imapSecure: boolean;

  // --- VFS slot-monitor akkaunti ---
  slotMonitorEmail: string;
  slotMonitorPassword: string;

  // --- Slot-worker ---
  slotWorkerIntervalMs: number;
  slotWorkerConcurrency: number;
  slotNotifyTelegram: boolean;
  slotCheckProxy: boolean;

  // --- Boshqa toggle / vaqt sozlamalari ---
  blockResources: boolean;
  osClick: boolean;
  chromeCdp: boolean;
  proxyLogIp: boolean;
  registerTtlHours: number;
  proxySessionTtlMin: number;
  typeDelayMs: number;

  configVersion: number;
  updatedAt: Date;
  updatedBy: string | null;
};

/** UI/API uchun tahrirlanadigan maydonlar (id/updatedAt'siz). */
export type SettingsPatch = Partial<
  Omit<AppSettings, "id" | "updatedAt" | "updatedBy" | "configVersion">
>;

const ENV_TRUE = (v: string | undefined, dflt = false): boolean => {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "") return dflt;
  return s === "true" || s === "1";
};

const ENV_NUM = (v: string | undefined, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

// Joriy konfiguratsiya versiyasi. Oshirilganda — yangi maydonlar .env'dan
// BIR MARTA to'ldiriladi (eski singleton yozuv bo'sh ko'rsatmasligi uchun).
const CONFIG_VERSION = 2;

/**
 * 2-versiyada qo'shilgan yangi maydonlarni joriy .env'dan oladi. Yangi yozuv
 * yaratishda ham, eski yozuvni migratsiya qilishda ham ishlatiladi.
 */
function newFieldsSeed(): SettingsPatch {
  return {
    registerUrl: (process.env.BOOKING_REGISTER_URL || "").trim(),
    loginUrl: (process.env.BOOKING_LOGIN_URL || "").trim(),
    orderUrl: (process.env.BOOKING_ORDER_URL || "").trim(),
    calendarUrl: (process.env.BOOKING_CALENDAR_URL || "").trim(),
    warmupUrl: (process.env.BOOKING_WARMUP_URL || "").trim(),
    emailDomain: (process.env.EMAIL_DOMAIN || "").trim(),
    telegramBotToken: (process.env.TELEGRAM_BOT_TOKEN || "").trim(),
    telegramAdminChatIds: (process.env.TELEGRAM_ADMIN_CHAT_IDS || "").trim(),
    imapHost: (process.env.IMAP_HOST || "").trim(),
    imapPort: ENV_NUM(process.env.IMAP_PORT, 993),
    imapUser: (process.env.IMAP_USER || "").trim(),
    imapPassword: process.env.IMAP_PASSWORD || "",
    imapMailbox: (process.env.IMAP_MAILBOX || "INBOX").trim(),
    imapSecure: ENV_TRUE(process.env.IMAP_SECURE, true),
    slotMonitorEmail: (process.env.SLOT_MONITOR_EMAIL || "").trim(),
    slotMonitorPassword: process.env.SLOT_MONITOR_PASSWORD || "",
    slotWorkerIntervalMs: ENV_NUM(process.env.SLOT_WORKER_INTERVAL_MS, 600000),
    slotWorkerConcurrency: ENV_NUM(process.env.SLOT_WORKER_CONCURRENCY, 2),
    slotNotifyTelegram: ENV_TRUE(process.env.SLOT_NOTIFY_TELEGRAM, true),
    slotCheckProxy: ENV_TRUE(process.env.SLOT_CHECK_PROXY, false),
    blockResources: ENV_TRUE(process.env.BOOKING_BLOCK_RESOURCES, true),
    osClick: ENV_TRUE(process.env.BOOKING_OS_CLICK, true),
    chromeCdp: ENV_TRUE(process.env.BOOKING_CHROME_CDP, true),
    proxyLogIp: ENV_TRUE(process.env.PROXY_LOG_IP, false),
    registerTtlHours: ENV_NUM(process.env.REGISTER_TTL_HOURS, 24),
    proxySessionTtlMin: ENV_NUM(process.env.PROXY_SESSION_TTL_MIN, 60),
    typeDelayMs: ENV_NUM(process.env.BOOKING_TYPE_DELAY_MS, 35),
  };
}

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
    ...newFieldsSeed(),
  };
}

/**
 * Singleton AppSettings yozuvini qaytaradi. Yo'q bo'lsa — .env'dan yaratadi.
 * Eski yozuv (configVersion < CONFIG_VERSION) bo'lsa — yangi maydonlarni
 * .env'dan BIR MARTA to'ldiradi (migratsiya), so'ng baza asosiy manba bo'ladi.
 */
export async function getAppSettings(): Promise<AppSettings> {
  const row = await prisma.appSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, configVersion: CONFIG_VERSION, ...envSeed() },
  });
  let s = row as AppSettings;
  if (s.configVersion < CONFIG_VERSION) {
    const migrated = await prisma.appSettings.update({
      where: { id: 1 },
      data: { ...newFieldsSeed(), configVersion: CONFIG_VERSION },
    });
    s = migrated as AppSettings;
  }
  return s;
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

  // --- Yangi maydonlar ---
  // Satr (string) maydonlar: faqat bo'sh BO'LMAGANDA yoziladi — ishlayotgan
  // env qiymatini tasodifan bo'sh bilan ezib yubormaslik uchun.
  const setStr = (key: string, val: string) => {
    if (val && val.trim()) process.env[key] = val;
  };
  setStr("BOOKING_REGISTER_URL", s.registerUrl);
  setStr("BOOKING_LOGIN_URL", s.loginUrl);
  setStr("BOOKING_ORDER_URL", s.orderUrl);
  setStr("BOOKING_CALENDAR_URL", s.calendarUrl);
  setStr("BOOKING_WARMUP_URL", s.warmupUrl);
  setStr("EMAIL_DOMAIN", s.emailDomain);
  setStr("TELEGRAM_BOT_TOKEN", s.telegramBotToken);
  setStr("TELEGRAM_ADMIN_CHAT_IDS", s.telegramAdminChatIds);
  setStr("IMAP_HOST", s.imapHost);
  setStr("IMAP_USER", s.imapUser);
  setStr("IMAP_PASSWORD", s.imapPassword);
  setStr("IMAP_MAILBOX", s.imapMailbox);
  setStr("SLOT_MONITOR_EMAIL", s.slotMonitorEmail);
  setStr("SLOT_MONITOR_PASSWORD", s.slotMonitorPassword);

  // Raqam / boolean maydonlar: doimo yoziladi (baza asosiy manba).
  process.env.IMAP_PORT = String(s.imapPort);
  process.env.IMAP_SECURE = s.imapSecure ? "true" : "false";
  process.env.SLOT_WORKER_INTERVAL_MS = String(s.slotWorkerIntervalMs);
  process.env.SLOT_WORKER_CONCURRENCY = String(s.slotWorkerConcurrency);
  process.env.SLOT_NOTIFY_TELEGRAM = s.slotNotifyTelegram ? "true" : "false";
  process.env.SLOT_CHECK_PROXY = s.slotCheckProxy ? "true" : "false";
  process.env.BOOKING_BLOCK_RESOURCES = s.blockResources ? "true" : "false";
  process.env.BOOKING_OS_CLICK = s.osClick ? "true" : "false";
  process.env.BOOKING_CHROME_CDP = s.chromeCdp ? "true" : "false";
  process.env.PROXY_LOG_IP = s.proxyLogIp ? "true" : "false";
  process.env.REGISTER_TTL_HOURS = String(s.registerTtlHours);
  process.env.PROXY_SESSION_TTL_MIN = String(s.proxySessionTtlMin);
  process.env.BOOKING_TYPE_DELAY_MS = String(s.typeDelayMs);
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
  const {
    proxyPass,
    telegramBotToken,
    imapPassword,
    slotMonitorPassword,
    updatedAt,
    ...rest
  } = s;
  return {
    ...rest,
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
    hasProxyPass: Boolean(proxyPass),
    hasTelegramBotToken: Boolean(telegramBotToken),
    hasImapPassword: Boolean(imapPassword),
    hasSlotMonitorPassword: Boolean(slotMonitorPassword),
  };
}

export type MaskedSettings = ReturnType<typeof maskSettings>;
