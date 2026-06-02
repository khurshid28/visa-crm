import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = { params: { id: string } };

// POST — arizachiga bog'langan shaxsning standart passport rasmini
// (600x600 JPEG) bazaga saqlaydi. Rasm bazada ochiq turadi; faqat
// tashqi tizimga yuborilganda ishlatiladi.
export async function POST(req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const applicant = await prisma.applicant.findUnique({
    where: { id },
    select: { id: true, personId: true, passportNumber: true },
  });
  if (!applicant) {
    return NextResponse.json({ error: "Arizachi topilmadi" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fayl topilmadi" }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";

  // Shaxs bo'lmasa (eski yozuv) — passport bo'yicha ulaymiz/yaratamiz.
  let personId = applicant.personId;
  if (!personId) {
    const person = await prisma.person.upsert({
      where: { passportNumber: applicant.passportNumber },
      update: {},
      create: {
        passportNumber: applicant.passportNumber,
        surname: "",
        name: "",
      },
    });
    personId = person.id;
    await prisma.applicant.update({
      where: { id },
      data: { personId },
    });
  }

  await prisma.person.update({
    where: { id: personId },
    data: { photo: bytes, photoMime: mime },
  });

  return NextResponse.json({ ok: true, personId });
}

// GET — saqlangan standart rasmni qaytaradi (ko'rish uchun, ochiq turadi).
export async function GET(_req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const applicant = await prisma.applicant.findUnique({
    where: { id },
    select: { personId: true },
  });
  if (!applicant?.personId) {
    return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  }
  const person = await prisma.person.findUnique({
    where: { id: applicant.personId },
    select: { photo: true, photoMime: true },
  });
  if (!person?.photo) {
    return NextResponse.json({ error: "Rasm yo'q" }, { status: 404 });
  }
  return new NextResponse(person.photo as unknown as BodyInit, {
    headers: {
      "Content-Type": person.photoMime || "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
}
