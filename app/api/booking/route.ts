import { NextRequest, NextResponse } from "next/server";
import { checkSlotOpen } from "@/lib/automation";
import {
  enqueueGroupOrder,
  enqueueGroupRegister,
  enqueueApplicant,
} from "@/lib/order-queue";
import { prisma } from "@/lib/prisma";

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
    if (stage === "order") {
      const applicant = await prisma.applicant.findUnique({
        where: { id: applicantId },
        select: { id: true, groupId: true },
      });
      if (!applicant) {
        return NextResponse.json(
          { error: "Arizachi topilmadi" },
          { status: 404 },
        );
      }

      const slot = await checkSlotOpen();
      if (!slot.open) {
        return NextResponse.json({
          ok: false,
          mode: "applicant",
          stage,
          queued: false,
          slotBlocked: slot.note,
        });
      }

      // Faqat shu userni navbatga qo'shamiz (guruhni emas) — bittalab.
      const queued = await enqueueApplicant({
        applicantId,
        stage: "order",
        source: "web",
        reason: "manual-applicant-order",
      });
      if (!queued.ok && queued.reason === "Arizachi topilmadi") {
        return NextResponse.json(
          { error: "Arizachi topilmadi" },
          { status: 404 },
        );
      }
      return NextResponse.json({
        ok: true,
        mode: "applicant",
        stage,
        queued: queued.queued,
        note: queued.queued
          ? "Order navbatga qo'shildi (worker bajaradi)"
          : queued.reason || "Allaqachon navbatda",
      });
    }

    // register — navbatga tushadi, 10 worker parallel bajaradi.
    const queued = await enqueueApplicant({
      applicantId,
      stage: "register",
      source: "web",
      reason: "manual-applicant-register",
    });
    if (!queued.ok && queued.reason === "Arizachi topilmadi") {
      return NextResponse.json(
        { error: "Arizachi topilmadi" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      mode: "applicant",
      stage,
      queued: queued.queued,
      note: queued.queued
        ? "Register navbatga qo'shildi (worker bajaradi)"
        : queued.reason || "Allaqachon navbatda",
    });
  }

  // --- Butun guruh ---
  if (groupId) {
    if (stage === "order") {
      const slot = await checkSlotOpen();
      if (!slot.open) {
        return NextResponse.json({
          ok: false,
          mode: "group",
          stage,
          queued: false,
          slotBlocked: slot.note,
        });
      }

      const queued = await enqueueGroupOrder({
        groupId,
        source: "web",
        reason: "manual-order",
      });
      return NextResponse.json({
        ok: true,
        mode: "group",
        stage,
        queued: queued.queuedJobs > 0,
        queuedJobs: queued.queuedJobs,
        skippedJobs: queued.skippedJobs,
        note: `Order navbatga qo'shildi: ${queued.queuedJobs} user (skip: ${queued.skippedJobs})`,
      });
    }

    // register — guruhdagi barcha userlar navbatga, 10 worker parallel.
    const queued = await enqueueGroupRegister({
      groupId,
      source: "web",
      reason: "manual-register",
    });
    return NextResponse.json({
      ok: true,
      mode: "group",
      stage,
      queued: queued.queuedJobs > 0,
      queuedJobs: queued.queuedJobs,
      skippedJobs: queued.skippedJobs,
      note: `Register navbatga qo'shildi: ${queued.queuedJobs} user (skip: ${queued.skippedJobs}) — 10 worker parallel bajaradi`,
    });
  }

  return NextResponse.json(
    { error: "groupId yoki applicantId kerak" },
    { status: 400 },
  );
}
