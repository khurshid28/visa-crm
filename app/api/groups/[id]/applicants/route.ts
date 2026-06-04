import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildEmail } from "@/lib/email";
import { REQUIRED_FIELDS } from "@/lib/excel";

type Params = { params: { id: string } };

// Qo'lda kiritishda ruxsat etilgan maydonlar.
const FIELDS = [
  "surname",
  "name",
  "passportNumber",
  "nationality",
  "gender",
  "birthdate",
  "passportValidity",
  "phone",
  "email",
  "category",
  "subcategory",
] as const;

// POST /api/groups/:id/applicants — guruhga bitta arizachi qo'shish
export async function POST(req: NextRequest, { params }: Params) {
  const groupId = Number(params.id);
  const body = await req.json().catch(() => ({}));

  const data: Record<string, string> = {};
  for (const key of FIELDS) {
    const v = body[key];
    if (typeof v === "string" && v.trim()) data[key] = v.trim();
  }

  if (!data.surname || !data.name || !data.passportNumber) {
    return NextResponse.json(
      { error: "Familiya, Ism va Pasport raqami majburiy" },
      { status: 400 },
    );
  }

  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) {
    return NextResponse.json({ error: "Guruh topilmadi" }, { status: 404 });
  }

  const complete = REQUIRED_FIELDS.every(
    (f) => String(data[f] ?? "").trim().length > 0,
  );

  const created = await prisma.applicant.create({
    data: {
      surname: data.surname,
      name: data.name,
      passportNumber: data.passportNumber,
      nationality: data.nationality,
      gender: data.gender,
      birthdate: data.birthdate,
      passportValidity: data.passportValidity,
      phone: data.phone,
      email: data.email,
      category: data.category,
      subcategory: data.subcategory,
      groupId,
      complete,
    },
  });

  // Tizim emaili: foydalanuvchi kiritgan bo'lsa o'shani, bo'lmasa avtomatik.
  const provided =
    typeof body.generatedEmail === "string" && body.generatedEmail.trim()
      ? body.generatedEmail.trim()
      : null;
  const updated = await prisma.applicant.update({
    where: { id: created.id },
    data: {
      generatedEmail:
        provided ?? buildEmail(created.name, created.surname, created.id),
    },
  });

  return NextResponse.json({ ok: true, applicant: updated });
}
