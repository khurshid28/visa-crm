import { NextRequest, NextResponse } from "next/server";
import { checkSlotSuper } from "@/lib/auth";
import {
  getAppSettings,
  updateAppSettings,
  maskSettings,
  loadSettingsIntoEnv,
  type SettingsPatch,
} from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — joriy sozlamalar (parol MASKALANGAN: faqat hasProxyPass qaytadi).
// Admin sessiyasi yetarli (middleware tekshiradi) — ko'rish uchun super shart emas.
export async function GET() {
  // Next.js jarayoni ham o'z env'ini bazadan yangilab tursin (proksi banneri,
  // boshqa ko'rsatkichlar uchun) — keshlangan, arzon.
  await loadSettingsIntoEnv();
  const s = await getAppSettings();
  return NextResponse.json({ settings: maskSettings(s) });
}

// POST — sozlamalarni yangilash. Alohida SUPER login/parol talab qilinadi
// (oddiy admin emas) — slot yaratish bilan bir xil himoya.
// action:"verify" — faqat login/parolni tekshiradi (Sozlamalar sahifasini
// ochish uchun "qulf" — hech narsa o'zgartirmaydi).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  const superUser = String(body.superUsername || "");
  const superPass = String(body.superPassword || "");
  if (!checkSlotSuper(superUser, superPass)) {
    return NextResponse.json(
      { error: "Super login yoki parol noto'g'ri" },
      { status: 401 },
    );
  }

  // Faqat ochish (unlock) uchun tekshiruv — sozlamalarni ko'rsatish.
  if (body.action === "verify") {
    await loadSettingsIntoEnv();
    const s = await getAppSettings();
    return NextResponse.json({ ok: true, settings: maskSettings(s) });
  }

  const patch: SettingsPatch = {};

  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v.trim() : undefined;
  const bool = (v: unknown): boolean | undefined =>
    typeof v === "boolean" ? v : undefined;
  const num = (v: unknown, min: number, max: number): number | undefined => {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  // Maxfiy maydon: faqat bo'sh BO'LMAGAN qiymat kelganda yangilanadi
  // (UI bo'sh yuborsa — eski qiymat saqlanadi).
  const secret = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;

  const setStr = (key: keyof SettingsPatch, v: unknown) => {
    const x = str(v);
    if (x !== undefined) (patch as Record<string, unknown>)[key] = x;
  };
  const setBool = (key: keyof SettingsPatch, v: unknown) => {
    const x = bool(v);
    if (x !== undefined) (patch as Record<string, unknown>)[key] = x;
  };
  const setNum = (
    key: keyof SettingsPatch,
    v: unknown,
    min: number,
    max: number,
  ) => {
    const x = num(v, min, max);
    if (x !== undefined) (patch as Record<string, unknown>)[key] = x;
  };
  const setSecret = (key: keyof SettingsPatch, v: unknown) => {
    const x = secret(v);
    if (x !== undefined) (patch as Record<string, unknown>)[key] = x;
  };

  // --- Proksi ---
  setBool("proxyEnabled", body.proxyEnabled);
  setStr("proxyHost", body.proxyHost);
  setStr("proxyPort", body.proxyPort);
  setStr("proxyUser", body.proxyUser);
  setStr("proxyCountries", body.proxyCountries);
  setSecret("proxyPass", body.proxyPass);
  setBool("proxyLogIp", body.proxyLogIp);
  setNum("proxySessionTtlMin", body.proxySessionTtlMin, 1, 1440);

  // --- Chrome / brauzer ---
  setBool("chromeHeadless", body.chromeHeadless);
  setBool("chromeCdp", body.chromeCdp);
  setBool("osClick", body.osClick);
  setBool("blockResources", body.blockResources);
  setNum("typeDelayMs", body.typeDelayMs, 0, 500);

  // --- Timeout'lar / urinishlar ---
  setNum("captchaTimeoutMs", body.captchaTimeoutMs, 5000, 180000);
  setNum("cfChallengeTimeoutMs", body.cfChallengeTimeoutMs, 5000, 180000);
  setNum("maxAttempts", body.maxAttempts, 1, 10);
  setNum("ipRetries", body.ipRetries, 1, 20);
  setNum("workerPerCpu", body.workerPerCpu, 1, 8);
  setNum("registerTtlHours", body.registerTtlHours, 1, 168);

  // --- VFS / Booking URL'lari ---
  setStr("registerUrl", body.registerUrl);
  setStr("loginUrl", body.loginUrl);
  setStr("orderUrl", body.orderUrl);
  setStr("calendarUrl", body.calendarUrl);
  setStr("warmupUrl", body.warmupUrl);

  // --- Email / domen ---
  setStr("emailDomain", body.emailDomain);

  // --- Telegram ---
  setSecret("telegramBotToken", body.telegramBotToken);
  setStr("telegramAdminChatIds", body.telegramAdminChatIds);

  // --- Gmail / IMAP ---
  setStr("imapHost", body.imapHost);
  setNum("imapPort", body.imapPort, 1, 65535);
  setStr("imapUser", body.imapUser);
  setSecret("imapPassword", body.imapPassword);
  setStr("imapMailbox", body.imapMailbox);
  setBool("imapSecure", body.imapSecure);

  // --- VFS slot-monitor akkaunti ---
  setStr("slotMonitorEmail", body.slotMonitorEmail);
  setSecret("slotMonitorPassword", body.slotMonitorPassword);

  // --- Slot-worker ---
  setNum("slotWorkerIntervalMs", body.slotWorkerIntervalMs, 60000, 3600000);
  setNum("slotWorkerConcurrency", body.slotWorkerConcurrency, 1, 10);
  setBool("slotNotifyTelegram", body.slotNotifyTelegram);
  setBool("slotCheckProxy", body.slotCheckProxy);

  const s = await updateAppSettings(patch, superUser);
  return NextResponse.json({ ok: true, settings: maskSettings(s) });
}
