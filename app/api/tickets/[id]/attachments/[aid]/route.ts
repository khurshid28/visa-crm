import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: { id: string; aid: string } };

// DELETE /api/tickets/[id]/attachments/[aid] — bitta faylni o'chirish
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ticketId = Number(params.id);
  const aid = Number(params.aid);
  const att = await prisma.ticketAttachment.findUnique({ where: { id: aid } });
  if (!att || att.ticketId !== ticketId) {
    return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  }
  await prisma.ticketAttachment.delete({ where: { id: aid } });
  return NextResponse.json({ ok: true });
}
