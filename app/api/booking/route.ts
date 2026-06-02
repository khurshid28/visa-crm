import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApplicantStatus, GroupStatus } from "@prisma/client";
import { runBooking, type AutomationApplicant } from "@/lib/automation";

/**
 * ====================================================================
 *  BOOKING TRIGGER — 2 bosqichli avtomatlashtirish
 * ====================================================================
 *  "register" -> REGISTERED, "order" -> ORDERED (keyin PDF ko'rinadi).
 *
 *  Har bir arizachi uchun Playwright engine (lib/automation.ts) tegishli
 *  URL'dagi formani topib to'ldiradi va yuboradi. URL'lar .env dan:
 *    BOOKING_REGISTER_URL, BOOKING_ORDER_URL  (test: example.com).
 *
 *  Engine hech qachon throw qilmaydi — natija appointmentRef/resultNote
 *  ga yoziladi. Avtomatlashtirish muvaffaqiyatsiz bo'lsa ham status
 *  yangilanadi (qo'lda kuzatish mumkin).
 * ====================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function toAutomationInput(a: {
  surname: string;
  name: string;
  passportNumber: string;
  nationality: string | null;
  gender: string | null;
  birthdate: string | null;
  passportValidity: string | null;
  phone: string | null;
  email: string | null;
  generatedEmail: string | null;
}): AutomationApplicant {
  return {
    surname: a.surname,
    name: a.name,
    passportNumber: a.passportNumber,
    nationality: a.nationality,
    gender: a.gender,
    birthdate: a.birthdate,
    passportValidity: a.passportValidity,
    phone: a.phone,
    email: a.email,
    generatedEmail: a.generatedEmail,
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const groupId = body.groupId ? Number(body.groupId) : null;
  const applicantId = body.applicantId ? Number(body.applicantId) : null;

  const stage =
    String(body.stage || "register") === "order" ? "order" : "register";
  const nextStatus =
    stage === "order" ? ApplicantStatus.ORDERED : ApplicantStatus.REGISTERED;

  // --- Bitta arizachi ---
  if (applicantId) {
    const applicant = await prisma.applicant.findUnique({
      where: { id: applicantId },
    });
    if (!applicant) {
      return NextResponse.json(
        { error: "Arizachi topilmadi" },
        { status: 404 },
      );
    }

    const result = await runBooking(stage, toAutomationInput(applicant));

    const updated = await prisma.applicant.update({
      where: { id: applicantId },
      data: {
        status: result.ok ? nextStatus : ApplicantStatus.FAILED,
        appointmentRef: result.ref ?? applicant.appointmentRef,
        resultNote: result.note,
      },
    });

    return NextResponse.json({
      ok: result.ok,
      mode: "applicant",
      stage,
      automation: result,
      applicant: updated,
    });
  }

  // --- Butun guruh ---
  if (groupId) {
    const applicants = await prisma.applicant.findMany({
      where: { groupId, status: { notIn: [ApplicantStatus.ARCHIVED] } },
    });

    const results: {
      id: number;
      name: string;
      passportNumber: string;
      ok: boolean;
      note: string;
    }[] = [];

    for (const a of applicants) {
      const result = await runBooking(stage, toAutomationInput(a));
      await prisma.applicant.update({
        where: { id: a.id },
        data: {
          status: result.ok ? nextStatus : ApplicantStatus.FAILED,
          appointmentRef: result.ref ?? a.appointmentRef,
          resultNote: result.note,
        },
      });
      results.push({
        id: a.id,
        name: `${a.surname} ${a.name}`,
        passportNumber: a.passportNumber,
        ok: result.ok,
        note: result.note,
      });
    }

    const failed = results.filter((r) => !r.ok);
    const group = await prisma.group.update({
      where: { id: groupId },
      data: { status: GroupStatus.BOOKING },
    });

    return NextResponse.json({
      ok: failed.length === 0,
      mode: "group",
      stage,
      processed: results.length,
      succeeded: results.length - failed.length,
      failedCount: failed.length,
      failed,
      results,
      group,
    });
  }

  return NextResponse.json(
    { error: "groupId yoki applicantId kerak" },
    { status: 400 },
  );
}
