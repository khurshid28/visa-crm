import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkSlotOpen } from "@/lib/automation";
import { enqueueApplicant, type QueueStage } from "@/lib/order-queue";

/**
 * ====================================================================
 *  SITE CHECK — bosh dashboarddagi "qo'lda tekshirish" paneli
 * ====================================================================
 *  Maqsad: VFS saytini qo'lda tekshirish (umumiy diagnostika):
 *   - slot          : saytda joy bor/yo'qligi (umumiy, userga bog'liq emas)
 *   - register/order/login/activation : tanlangan userning O'Z gmail/paroli
 *     bilan, o'sha userning gmail profilida (sticky IP). Navbatga qo'shiladi
 *     va worker bajaradi (natija AutomationLog'da ko'rinadi).
 * ====================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Userga bog'liq (gmail/parol bilan) bosqichlar — navbatga tushadi.
const USER_STAGES: QueueStage[] = ["register", "order", "login", "activation"];

// GET — panel ma'lumotlari:
//   ?applicantId=N  => userning holati + oxirgi natijalari (AutomationLog)
//   ?q=...          => arizachilarni qidirish (picker uchun)
//   (default)       => oxirgi umumiy slot tekshiruvlari
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim();
  const applicantIdRaw = sp.get("applicantId");
  const applicantId = applicantIdRaw ? Number(applicantIdRaw) : null;

  if (applicantId && Number.isFinite(applicantId)) {
    const applicant = await prisma.applicant.findUnique({
      where: { id: applicantId },
      select: {
        id: true,
        surname: true,
        name: true,
        generatedEmail: true,
        generatedPassword: true,
        email: true,
        phone: true,
        status: true,
        activationStatus: true,
        resultNote: true,
        groupId: true,
        profileKey: true,
        registerFinishedAt: true,
        activatedAt: true,
      },
    });
    if (!applicant) {
      return NextResponse.json(
        { error: "Arizachi topilmadi" },
        { status: 404 },
      );
    }
    const logs = await prisma.automationLog.findMany({
      where: { applicantId },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        stage: true,
        ok: true,
        note: true,
        durationMs: true,
        statusCode: true,
        exitIp: true,
        finalUrl: true,
        createdAt: true,
      },
    });
    return NextResponse.json({ applicant, logs });
  }

  if (q) {
    // Juda qisqa qidiruv bazani bezovta qilmasin (kamida 2 belgi).
    if (q.length < 2) {
      return NextResponse.json({ applicants: [] });
    }
    const applicants = await prisma.applicant.findMany({
      where: {
        OR: [
          { surname: { contains: q } },
          { name: { contains: q } },
          { generatedEmail: { contains: q } },
          { email: { contains: q } },
          { passportNumber: { contains: q } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        surname: true,
        name: true,
        generatedEmail: true,
        email: true,
        status: true,
        activationStatus: true,
        groupId: true,
      },
    });
    return NextResponse.json({ applicants });
  }

  // default: oxirgi umumiy slot tekshiruvlari
  const slotLogs = await prisma.automationLog.findMany({
    where: { stage: "slot" },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      ok: true,
      note: true,
      durationMs: true,
      finalUrl: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ slotLogs });
}

// POST — amalni bajaradi:
//   {action:"slot"}  => umumiy slot tekshiruvi (sync, brauzer ochiladi)
//   {action:"register"|"login"|"order"|"activation", applicantId}
//                    => o'sha userni navbatga qo'shadi (worker bajaradi)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const action = String(body.action || "").toLowerCase();

  // ── Umumiy slot tekshiruvi (userga bog'liq emas) ──────────────────
  if (action === "slot") {
    const t0 = Date.now();
    let result: { open: boolean; note: string; url: string };
    try {
      result = await checkSlotOpen();
    } catch (e) {
      result = {
        open: false,
        note: `Xato: ${(e as Error).message}`,
        url: "",
      };
    }
    const durationMs = Date.now() - t0;
    await prisma.automationLog
      .create({
        data: {
          stage: "slot",
          attempt: 1,
          ok: result.open,
          durationMs,
          note: result.note,
          url: result.url || null,
          finalUrl: result.url || null,
          workerProfile: "web-manual",
        },
      })
      .catch(() => {});
    return NextResponse.json({
      ok: true,
      action,
      open: result.open,
      note: result.note,
      url: result.url,
      durationMs,
    });
  }

  // ── Userga bog'liq amallar (navbatga tushadi) ─────────────────────
  if (USER_STAGES.includes(action as QueueStage)) {
    const applicantId = body.applicantId ? Number(body.applicantId) : null;
    if (!applicantId || !Number.isFinite(applicantId)) {
      return NextResponse.json({ error: "applicantId kerak" }, { status: 400 });
    }
    const applicant = await prisma.applicant.findUnique({
      where: { id: applicantId },
      select: { id: true, generatedEmail: true, email: true },
    });
    if (!applicant) {
      return NextResponse.json(
        { error: "Arizachi topilmadi" },
        { status: 404 },
      );
    }
    // login/order/activation uchun avval register (gmail/parol) bo'lishi shart.
    if (
      action !== "register" &&
      !(applicant.generatedEmail || applicant.email)
    ) {
      return NextResponse.json(
        { error: "Bu userda gmail/parol yo'q — avval Register qiling" },
        { status: 400 },
      );
    }

    try {
      const queued = await enqueueApplicant({
        applicantId,
        stage: action as QueueStage,
        source: "web",
        reason: `manual-${action}`,
        force: true,
      });
      return NextResponse.json({
        ok: queued.ok,
        action,
        queued: queued.queued,
        note: queued.queued
          ? "Navbatga qo'shildi — worker bajaradi (natija pastda ko'rinadi)"
          : queued.reason || "Navbatga qo'shilmadi",
      });
    } catch (e) {
      return NextResponse.json(
        {
          error: `Navbatga ulanmadi (RabbitMQ/Redis ishlayaptimi?): ${(e as Error).message}`,
        },
        { status: 503 },
      );
    }
  }

  return NextResponse.json(
    { error: "Noma'lum action (slot|register|login|order|activation)" },
    { status: 400 },
  );
}
