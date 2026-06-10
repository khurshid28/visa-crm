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

  // --- v3: web slot-check matnlari ---
  bookingSlotUrl: string;
  bookingSlotOpenText: string;
  bookingSlotClosedText: string;

  // --- v3: VFS kalendar tanlovlari ---
  calendarCentre: string;
  calendarCategory: string;
  calendarSubcategory: string;
  calendarNoSlotText: string;
  continueText: string;
  calendarReadyMs: number;

  // --- v3: aktivatsiya xati ---
  activationFrom: string;
  activationTimeoutMs: number;
  activationPollMs: number;
  activationSinceMs: number;

  // --- v3: slot login / backoff ---
  slotRestrictedBackoffMin: number;
  slotLoginCaptchaRetries: number;
  slotLoginCooldownMin: number;

  // --- v3: captcha vaqtlari ---
  captchaAutopassMs: number;
  verifyCaptchaAppearMs: number;
  captchaMeasureMs: number;

  // --- v3: brauzer (qo'shimcha) ---
  userAgent: string;
  viewport: string;
  cdpPort: number;
  chromePath: string;
  cdpFreshProfile: boolean;
  cdpKeepCache: boolean;
  cmsCache: boolean;
  assetCache: boolean;

  // --- v4: proksi shablon / echo URL / profil papka ---
  proxyUsernameTemplate: string;
  proxyPasswordTemplate: string;
  proxyIpEchoUrl: string;
  slotMonitorProfileDir: string;

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
// v2 -> v3: ko'proq boshqaruv maydonlari (slot matnlari, kalendar, aktivatsiya,
// captcha vaqtlari, brauzer) qo'shildi.
// v3 -> v4: proksi shablon/echo URL va slot-monitor profil papkasi qo'shildi.
const CONFIG_VERSION = 4;

/**
 * 2-versiyada qo'shilgan maydonlarni joriy .env'dan oladi.
 */
function v2FieldsSeed(): SettingsPatch {
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
 * 3-versiyada qo'shilgan maydonlarni joriy .env'dan oladi.
 */
function v3FieldsSeed(): SettingsPatch {
  return {
    bookingSlotUrl: (process.env.BOOKING_SLOT_URL || "").trim(),
    bookingSlotOpenText: (
      process.env.BOOKING_SLOT_OPEN_TEXT || "available|book now|select slot"
    ).trim(),
    bookingSlotClosedText: (
      process.env.BOOKING_SLOT_CLOSED_TEXT ||
      "no appointment|fully booked|closed"
    ).trim(),
    calendarCentre: (process.env.BOOKING_CALENDAR_CENTRE || "").trim(),
    calendarCategory: (process.env.BOOKING_CALENDAR_CATEGORY || "").trim(),
    calendarSubcategory: (
      process.env.BOOKING_CALENDAR_SUBCATEGORY || ""
    ).trim(),
    calendarNoSlotText: (
      process.env.BOOKING_CALENDAR_NO_SLOT_TEXT || ""
    ).trim(),
    continueText: (process.env.BOOKING_CONTINUE_TEXT || "Continue").trim(),
    calendarReadyMs: ENV_NUM(process.env.BOOKING_CALENDAR_READY_MS, 30000),
    activationFrom: (process.env.ACTIVATION_FROM || "").trim(),
    activationTimeoutMs: ENV_NUM(process.env.ACTIVATION_TIMEOUT_MS, 180000),
    activationPollMs: ENV_NUM(process.env.ACTIVATION_POLL_MS, 4000),
    activationSinceMs: ENV_NUM(process.env.ACTIVATION_SINCE_MS, 1800000),
    slotRestrictedBackoffMin: ENV_NUM(
      process.env.SLOT_RESTRICTED_BACKOFF_MIN,
      720,
    ),
    slotLoginCaptchaRetries: ENV_NUM(process.env.SLOT_LOGIN_CAPTCHA_RETRIES, 3),
    slotLoginCooldownMin: ENV_NUM(process.env.SLOT_LOGIN_COOLDOWN_MIN, 30),
    captchaAutopassMs: ENV_NUM(process.env.BOOKING_CAPTCHA_AUTOPASS_MS, 800),
    verifyCaptchaAppearMs: ENV_NUM(
      process.env.BOOKING_VERIFY_CAPTCHA_APPEAR_MS,
      4000,
    ),
    captchaMeasureMs: ENV_NUM(process.env.BOOKING_CAPTCHA_MEASURE_MS, 18000),
    userAgent: (process.env.BOOKING_USER_AGENT || "").trim(),
    viewport: (process.env.BOOKING_VIEWPORT || "1366x768").trim(),
    cdpPort: ENV_NUM(process.env.BOOKING_CDP_PORT, 9222),
    chromePath: (process.env.BOOKING_CHROME_PATH || "").trim(),
    cdpFreshProfile: ENV_TRUE(process.env.BOOKING_CDP_FRESH_PROFILE, true),
    cdpKeepCache: ENV_TRUE(process.env.BOOKING_CDP_KEEP_CACHE, true),
    cmsCache: ENV_TRUE(process.env.BOOKING_CMS_CACHE, true),
    assetCache: ENV_TRUE(process.env.BOOKING_ASSET_CACHE, true),
  };
}

/**
 * 4-versiyada qo'shilgan maydonlarni joriy .env'dan oladi.
 */
function v4FieldsSeed(): SettingsPatch {
  return {
    proxyUsernameTemplate: (
      process.env.PROXY_USERNAME_TEMPLATE || "{user}"
    ).trim(),
    proxyPasswordTemplate: (
      process.env.PROXY_PASSWORD_TEMPLATE ||
      "{pass}_country-{country}_session-{session}_lifetime-{ttl}m"
    ).trim(),
    proxyIpEchoUrl: (
      process.env.PROXY_IP_ECHO_URL || "https://api.ipify.org?format=json"
    ).trim(),
    slotMonitorProfileDir: (
      process.env.SLOT_MONITOR_PROFILE_DIR || "uploads/slot-monitor-profiles"
    ).trim(),
  };
}

/** Yangi yozuv yaratishda — v1'dan keyingi BARCHA maydonlar .env'dan. */
function newFieldsSeed(): SettingsPatch {
  return { ...v2FieldsSeed(), ...v3FieldsSeed(), ...v4FieldsSeed() };
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
    // Incremental migratsiya: faqat YANGI maydonlar .env'dan to'ldiriladi,
    // foydalanuvchi avval o'zgartirgan maydonlar ustidan yozilmaydi.
    const data: SettingsPatch & { configVersion: number } = {
      configVersion: CONFIG_VERSION,
    };
    if (s.configVersion < 2) Object.assign(data, v2FieldsSeed());
    if (s.configVersion < 3) Object.assign(data, v3FieldsSeed());
    if (s.configVersion < 4) Object.assign(data, v4FieldsSeed());
    const migrated = await prisma.appSettings.update({
      where: { id: 1 },
      data,
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

  // --- v3 maydonlar ---
  setStr("BOOKING_SLOT_URL", s.bookingSlotUrl);
  setStr("BOOKING_SLOT_OPEN_TEXT", s.bookingSlotOpenText);
  setStr("BOOKING_SLOT_CLOSED_TEXT", s.bookingSlotClosedText);
  setStr("BOOKING_CALENDAR_CENTRE", s.calendarCentre);
  setStr("BOOKING_CALENDAR_CATEGORY", s.calendarCategory);
  setStr("BOOKING_CALENDAR_SUBCATEGORY", s.calendarSubcategory);
  setStr("BOOKING_CALENDAR_NO_SLOT_TEXT", s.calendarNoSlotText);
  setStr("BOOKING_CONTINUE_TEXT", s.continueText);
  setStr("ACTIVATION_FROM", s.activationFrom);
  setStr("BOOKING_USER_AGENT", s.userAgent);
  setStr("BOOKING_VIEWPORT", s.viewport);
  setStr("BOOKING_CHROME_PATH", s.chromePath);

  process.env.BOOKING_CALENDAR_READY_MS = String(s.calendarReadyMs);
  process.env.ACTIVATION_TIMEOUT_MS = String(s.activationTimeoutMs);
  process.env.ACTIVATION_POLL_MS = String(s.activationPollMs);
  process.env.ACTIVATION_SINCE_MS = String(s.activationSinceMs);
  process.env.SLOT_RESTRICTED_BACKOFF_MIN = String(s.slotRestrictedBackoffMin);
  process.env.SLOT_LOGIN_CAPTCHA_RETRIES = String(s.slotLoginCaptchaRetries);
  process.env.SLOT_LOGIN_COOLDOWN_MIN = String(s.slotLoginCooldownMin);
  process.env.BOOKING_CAPTCHA_AUTOPASS_MS = String(s.captchaAutopassMs);
  process.env.BOOKING_VERIFY_CAPTCHA_APPEAR_MS = String(
    s.verifyCaptchaAppearMs,
  );
  process.env.BOOKING_CAPTCHA_MEASURE_MS = String(s.captchaMeasureMs);
  process.env.BOOKING_CDP_PORT = String(s.cdpPort);
  process.env.BOOKING_CDP_FRESH_PROFILE = s.cdpFreshProfile ? "true" : "false";
  process.env.BOOKING_CDP_KEEP_CACHE = s.cdpKeepCache ? "true" : "false";
  process.env.BOOKING_CMS_CACHE = s.cmsCache ? "true" : "false";
  process.env.BOOKING_ASSET_CACHE = s.assetCache ? "true" : "false";

  // --- v4 maydonlar (proksi shablon / echo URL / profil papka) ---
  setStr("PROXY_USERNAME_TEMPLATE", s.proxyUsernameTemplate);
  setStr("PROXY_PASSWORD_TEMPLATE", s.proxyPasswordTemplate);
  setStr("PROXY_IP_ECHO_URL", s.proxyIpEchoUrl);
  setStr("SLOT_MONITOR_PROFILE_DIR", s.slotMonitorProfileDir);
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

/**
 * To'liq ko'rinish — maxfiy qiymatlar HAM qaytadi (super login bilan ochilgach,
 * tokenlar ochiq ko'rinsin — boshqaruv uchun). FAQAT super-admin tasdiqlangach
 * (action:"verify" / saqlash javobida) ishlatiladi, oddiy GET'da emas.
 */
export function fullSettings(s: AppSettings) {
  const { updatedAt, ...rest } = s;
  return {
    ...rest,
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
    hasProxyPass: Boolean(s.proxyPass),
    hasTelegramBotToken: Boolean(s.telegramBotToken),
    hasImapPassword: Boolean(s.imapPassword),
    hasSlotMonitorPassword: Boolean(s.slotMonitorPassword),
  };
}

export type FullSettings = ReturnType<typeof fullSettings>;
