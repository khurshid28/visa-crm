import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { GroupStatus } from "@prisma/client";

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

// PATCH /api/groups/:id — guruh nomi/holati/izoh
export async function PATCH(req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const body = await req.json().catch(() => ({}));
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
