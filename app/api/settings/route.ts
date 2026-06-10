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

  const patch: SettingsPatch = {};

  // --- Proksi ---
  if (typeof body.proxyEnabled === "boolean")
    patch.proxyEnabled = body.proxyEnabled;
  if (typeof body.proxyHost === "string")
    patch.proxyHost = body.proxyHost.trim();
  if (typeof body.proxyPort === "string")
    patch.proxyPort = body.proxyPort.trim();
  if (typeof body.proxyUser === "string")
    patch.proxyUser = body.proxyUser.trim();
  if (typeof body.proxyCountries === "string")
    patch.proxyCountries = body.proxyCountries.trim();
  // Parol faqat yangi qiymat kiritilganda yangilanadi (maska bo'sh kelsa — tegmaymiz).
  if (typeof body.proxyPass === "string" && body.proxyPass.length > 0)
    patch.proxyPass = body.proxyPass;

  // --- Chrome ko'rinishi ---
  if (typeof body.chromeHeadless === "boolean")
    patch.chromeHeadless = body.chromeHeadless;

  // --- Timeout'lar / urinishlar (mantiqiy chegaralar bilan) ---
  const num = (v: unknown, min: number, max: number): number | undefined => {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const cap = num(body.captchaTimeoutMs, 5000, 180000);
  if (cap !== undefined) patch.captchaTimeoutMs = cap;
  const cf = num(body.cfChallengeTimeoutMs, 5000, 180000);
  if (cf !== undefined) patch.cfChallengeTimeoutMs = cf;
  const ma = num(body.maxAttempts, 1, 10);
  if (ma !== undefined) patch.maxAttempts = ma;
  const ir = num(body.ipRetries, 1, 20);
  if (ir !== undefined) patch.ipRetries = ir;
  const wpc = num(body.workerPerCpu, 1, 8);
  if (wpc !== undefined) patch.workerPerCpu = wpc;

  const s = await updateAppSettings(patch, superUser);
  return NextResponse.json({ ok: true, settings: maskSettings(s) });
}
