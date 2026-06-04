import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GroupStatus } from "@prisma/client";
import { openSlot, closeSlot } from "@/lib/booking";

type Params = { params: { id: string } };

// GET /api/groups/:id — guruh + arizachilar
export async function GET(_req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const group = await prisma.group.findUnique({
    where: { id },
    include: { applicants: { orderBy: { id: "asc" } } },
  });
  if (!group) {
    return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  }
  return NextResponse.json(group);
}

// PATCH /api/groups/:id — guruh nomi/holati/izoh yoki slot boshqaruvi
//   { slot: "open", closeAt?: ISO } — slotni ochadi
//   { slot: "close" }               — slotni yopadi
export async function PATCH(req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const body = await req.json().catch(() => ({}));

  // Slot boshqaruvi (web ham, bot ham shu logikani ishlatadi).
  if (body.slot === "open") {
    const closeAt = body.closeAt ? new Date(body.closeAt) : null;
    const group = await openSlot(id, closeAt);
    return NextResponse.json(group);
  }
  if (body.slot === "close") {
    const group = await closeSlot(id);
    return NextResponse.json(group);
  }

  // Guruh pauzasi — pauzada bo'lsa GO (buyurtma) navbatiga qo'shilmaydi.
  if (typeof body.paused === "boolean") {
    const group = await prisma.group.update({
      where: { id },
      data: { paused: body.paused },
    });
    return NextResponse.json(group);
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name;
  if (typeof body.note === "string") data.note = body.note;
  if (typeof body.status === "string" && body.status in GroupStatus) {
    data.status = body.status as GroupStatus;
  }

  const group = await prisma.group.update({ where: { id }, data });
  return NextResponse.json(group);
}

// DELETE /api/groups/:id
export async function DELETE(_req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  await prisma.group.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
