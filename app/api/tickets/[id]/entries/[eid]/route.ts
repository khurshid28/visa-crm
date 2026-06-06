import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: { id: string; eid: string } };

// DELETE /api/tickets/[id]/entries/[eid] — bitta xabarni (va fayllarini) o'chirish
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ticketId = Number(params.id);
  const eid = Number(params.eid);
  const entry = await prisma.ticketEntry.findUnique({ where: { id: eid } });
  if (!entry || entry.ticketId !== ticketId) {
    return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  }
  await prisma.ticketEntry.delete({ where: { id: eid } });
  return NextResponse.json({ ok: true });
}
