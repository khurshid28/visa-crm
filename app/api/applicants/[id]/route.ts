import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApplicantStatus } from "@prisma/client";
import { REQUIRED_FIELDS } from "@/lib/excel";
import { logApplicantChange } from "@/lib/audit";
import { getSession } from "@/lib/auth";

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
  "generatedPassword",
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
  const current = await prisma.applicant.findUnique({ where: { id } });

  // Pasport seriyasi majburiy moslik: arizachida (masalan Exceldan) pasport
  // raqami mavjud bo'lsa, yangi (skan qilingan) raqam undan farq qilsa —
  // saqlashni rad etamiz. Bu frontenddagi tekshiruvni backendda mustahkamlaydi.
  if ("passportNumber" in body && current?.passportNumber) {
    const norm = (x: unknown) =>
      String(x ?? "")
        .replace(/[^a-z0-9]/gi, "")
        .toUpperCase();
    const incoming = norm(body.passportNumber);
    const existing = norm(current.passportNumber);
    if (incoming && existing && incoming !== existing) {
      return NextResponse.json(
        {
          error: "Pasport raqami mos kelmadi",
          message: `Bazadagi pasport (${current.passportNumber}) skan qilingan pasportdan (${body.passportNumber}) farq qiladi. O'zgartirishga ruxsat yo'q.`,
          existing: current.passportNumber,
          incoming: body.passportNumber,
        },
        { status: 409 },
      );
    }
  }

  if (fieldEdited && current) {
    const merged = { ...current, ...data } as Record<string, unknown>;
    data.complete = REQUIRED_FIELDS.every(
      (f) => String(merged[f] ?? "").trim().length > 0,
    );
  }

  const applicant = await prisma.applicant.update({ where: { id }, data });

  // O'zgarishni tarixga yozamiz (kim, nima, oldin/keyin).
  const session = await getSession();
  const changedKeys = Object.keys(data);
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of changedKeys) {
    before[k] = current ? (current as Record<string, unknown>)[k] : null;
    after[k] = (applicant as Record<string, unknown>)[k];
  }
  await logApplicantChange({
    applicantId: id,
    groupId: applicant.groupId,
    action: fieldEdited ? "edit" : "status",
    fields: changedKeys,
    before,
    after,
    actor: session?.username ?? null,
    source: "web",
  });

  return NextResponse.json(applicant);
}

// DELETE /api/applicants/:id
export async function DELETE(_req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const current = await prisma.applicant.findUnique({ where: { id } });
  await prisma.applicant.delete({ where: { id } });

  const session = await getSession();
  await logApplicantChange({
    applicantId: null, // arizachi o'chirildi
    groupId: current?.groupId ?? null,
    action: "delete",
    before: current ? (current as Record<string, unknown>) : null,
    actor: session?.username ?? null,
    source: "web",
  });

  return NextResponse.json({ ok: true });
}
