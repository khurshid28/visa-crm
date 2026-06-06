import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  parseApplicantsFromBuffer,
  isComplete,
  missingFields,
} from "@/lib/excel";
import { buildEmail } from "@/lib/email";

// GET /api/groups — barcha guruhlar (arizachilar soni bilan)
export async function GET() {
  const groups = await prisma.group.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { applicants: true } } },
  });
  return NextResponse.json(groups);
}

// POST /api/groups — Excel yuklash -> guruh + arizachilar yaratish
// multipart/form-data: file, name, [confirm], [exclude]
//
// Ikki bosqichli: agar fayldagi passportlardan ba'zilari bazada bo'lsa
// (oldingi guruhlarda), `confirm` bo'lmasa — ularning ro'yxati qaytadi
// (needsConfirm). Foydalanuvchi belgilab tasdiqlagach (`confirm=1`),
// belgilanmaganlari `exclude` orqali tashlab yuboriladi va guruh yaratiladi.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const name = String(form.get("name") ?? "").trim();
  const slotIdRaw = String(form.get("slotId") ?? "").trim();
  const slotId =
    slotIdRaw && /^\d+$/.test(slotIdRaw) ? Number(slotIdRaw) : null;
  const confirm = String(form.get("confirm") ?? "") === "1";
  const excludeRaw = String(form.get("exclude") ?? "");
  const excludeSet = new Set(
    excludeRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fayl topilmadi" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let applicants;
  try {
    applicants = parseApplicantsFromBuffer(buf);
  } catch {
    return NextResponse.json(
      { error: "Faylni o'qib bo'lmadi (xlsx/csv kerak)" },
      { status: 400 },
    );
  }

  if (applicants.length === 0) {
    return NextResponse.json(
      { error: "Faylda yaroqli qator topilmadi (surname/name/passport kerak)" },
      { status: 400 },
    );
  }

  // Fayldagi passportlardan qaysilari bazada (boshqa guruhlarda) bor?
  const passports = applicants.map((a) => a.passportNumber).filter(Boolean);
  const existingPersons = await prisma.person.findMany({
    where: { passportNumber: { in: passports } },
    include: {
      applicants: {
        include: { group: { select: { name: true } } },
      },
    },
  });
  const existingByPassport = new Map(
    existingPersons.map((p) => [p.passportNumber, p]),
  );

  // 1-bosqich: tasdiqlanmagan bo'lsa va takrorlar bor bo'lsa — so'raymiz.
  if (!confirm && existingPersons.length > 0) {
    const existing = applicants
      .filter((a) => existingByPassport.has(a.passportNumber))
      .map((a) => {
        const p = existingByPassport.get(a.passportNumber)!;
        const groups = Array.from(
          new Set(p.applicants.map((ap) => ap.group?.name).filter(Boolean)),
        );
        return {
          passportNumber: a.passportNumber,
          name: `${a.surname} ${a.name}`,
          groups, // qaysi guruhlarda bor
        };
      });
    return NextResponse.json({
      needsConfirm: true,
      total: applicants.length,
      existingCount: existing.length,
      existing,
    });
  }

  // 2-bosqich: belgilanmaganlarini (exclude) tashlab, qolganini yaratamiz.
  const toCreate = applicants.filter((a) => !excludeSet.has(a.passportNumber));
  if (toCreate.length === 0) {
    return NextResponse.json(
      { error: "Hech bo'lmaganda bitta arizachi tanlang" },
      { status: 400 },
    );
  }

  // Guruh + arizachilarni yaratamiz. Passport bo'yicha Person mavjud bo'lsa
  // ulanadi (connect), bo'lmasa yangi yaratiladi (connectOrCreate).
  const group = await prisma.group.create({
    data: {
      name: name || file.name.replace(/\.[^.]+$/, ""),
      fileName: file.name,
      ...(slotId ? { slotId } : {}),
      applicants: {
        create: toCreate.map((a) => ({
          surname: a.surname,
          name: a.name,
          passportNumber: a.passportNumber,
          nationality: a.nationality,
          gender: a.gender,
          birthdate: a.birthdate,
          passportValidity: a.passportValidity,
          phone: a.phone,
          email: a.email,
          source: a.source,
          subcategory: a.subcategory,
          city: a.city,
          category: a.category,
          price: a.price,
          bookDateFrom: a.bookDateFrom,
          bookDateTo: a.bookDateTo,
          regDaysBefore: a.regDaysBefore,
          groupLabel: a.groupLabel,
          complete: isComplete(a),
          person: {
            connectOrCreate: {
              where: { passportNumber: a.passportNumber },
              create: {
                passportNumber: a.passportNumber,
                surname: a.surname,
                name: a.name,
                nationality: a.nationality,
                gender: a.gender,
                birthdate: a.birthdate,
                passportValidity: a.passportValidity,
                phone: a.phone,
              },
            },
          },
        })),
      },
    },
    include: { applicants: true },
  });

  // Har bir arizachiga tizim emailini beramiz: ism.familiya{id}@uzbekviza.uz
  await Promise.all(
    group.applicants.map((a) =>
      prisma.applicant.update({
        where: { id: a.id },
        data: { generatedEmail: buildEmail(a.name, a.surname, a.id) },
      }),
    ),
  );

  const completeCount = toCreate.filter((a) => isComplete(a)).length;
  const incomplete = toCreate
    .map((a, i) => ({
      row: i + 1,
      name: `${a.surname} ${a.name}`,
      missing: missingFields(a),
    }))
    .filter((x) => x.missing.length > 0);

  const reusedCount = toCreate.filter((a) =>
    existingByPassport.has(a.passportNumber),
  ).length;

  return NextResponse.json({
    ok: true,
    groupId: group.id,
    imported: toCreate.length,
    complete: completeCount,
    incompleteCount: incomplete.length,
    reused: reusedCount, // mavjud shaxslar (ko'p guruhda)
    incomplete,
  });
}
