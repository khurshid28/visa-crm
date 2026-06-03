import { NextRequest, NextResponse } from "next/server";
import { bookApplicant, bookGroup } from "@/lib/booking";

/**
 * ====================================================================
 *  BOOKING TRIGGER — 2 bosqichli avtomatlashtirish
 * ====================================================================
 *  "register" -> REGISTERED, "order" -> ORDERED (keyin PDF ko'rinadi).
 *
 *  Asl logika lib/booking.ts ichida (web + Telegram bot uchun umumiy).
 *  Har bir guruh run'i RunAttempt sifatida saqlanadi (run-1, run-2...).
 * ====================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const groupId = body.groupId ? Number(body.groupId) : null;
  const applicantId = body.applicantId ? Number(body.applicantId) : null;

  const stage =
    String(body.stage || "register") === "order" ? "order" : "register";

  // --- Bitta arizachi ---
  if (applicantId) {
    const out = await bookApplicant(applicantId, stage);
    if (!out) {
      return NextResponse.json(
        { error: "Arizachi topilmadi" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: out.result.ok,
      mode: "applicant",
      stage,
      automation: out.result,
      applicant: out.applicant,
    });
  }

  // --- Butun guruh ---
  if (groupId) {
    const out = await bookGroup(groupId, stage, "web");
    if (!out) {
      return NextResponse.json({ error: "Guruh topilmadi" }, { status: 404 });
    }
    return NextResponse.json({
      ok: out.failedCount === 0,
      mode: "group",
      stage,
      attempt: out.attempt,
      processed: out.processed,
      succeeded: out.succeeded,
      failedCount: out.failedCount,
      slotBlocked: out.slotBlocked ?? null,
      failed: out.failed,
      results: out.results,
    });
  }

  return NextResponse.json(
    { error: "groupId yoki applicantId kerak" },
    { status: 400 },
  );
}
