import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApplicantStatus } from "@prisma/client";
import { REQUIRED_FIELDS } from "@/lib/excel";

type Params = { params: { id: string } };

const EDITABLE = [
  "surname",
  "name",
  "passportNumber",
  "nationality",
  "gender",
  "birthdate",
  "passportValidity",
  "phone",
  "email",
  "source",
  "subcategory",
  "city",
  "category",
  "price",
  "bookDateFrom",
  "bookDateTo",
  "regDaysBefore",
  "groupLabel",
  "generatedEmail",
  "appointmentRef",
  "resultNote",
] as const;

// PATCH /api/applicants/:id — arizachini tahrirlash yoki status
export async function PATCH(req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  for (const key of EDITABLE) {
    if (key in body) data[key] = body[key];
  }

  if (typeof body.status === "string" && body.status in ApplicantStatus) {
    data.status = body.status as ApplicantStatus;
  } else if (Object.keys(data).length > 0) {
    // tahrir bo'lsa va status berilmagan bo'lsa -> EDITED
    data.status = ApplicantStatus.EDITED;
  }

  // Maydon tahrir qilingan bo'lsa, to'liqlikni qayta hisoblaymiz.
  const fieldEdited = EDITABLE.some((k) => k in body);
  if (fieldEdited) {
    const current = await prisma.applicant.findUnique({ where: { id } });
    if (current) {
      const merged = { ...current, ...data } as Record<string, unknown>;
      data.complete = REQUIRED_FIELDS.every(
        (f) => String(merged[f] ?? "").trim().length > 0,
      );
    }
  }

  const applicant = await prisma.applicant.update({ where: { id }, data });
  return NextResponse.json(applicant);
}

// DELETE /api/applicants/:id
export async function DELETE(_req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  await prisma.applicant.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
