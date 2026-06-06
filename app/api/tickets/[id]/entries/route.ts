import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type Params = { params: { id: string } };

// POST /api/tickets/[id]/entries — tiketga yangi xabar (zanjir) qo'shish.
// Body (JSON): { body }. Fayllar keyin /attachments?entryId=... orqali yuklanadi.
export async function POST(req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) {
    return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  }

  const payload = await req.json().catch(() => null);
  const text = String(payload?.body ?? "").trim();
  if (!text) {
    return NextResponse.json(
      { error: "Xabar matni bo'sh bo'lmasin" },
      { status: 400 },
    );
  }

  const session = await getSession();
  const entry = await prisma.ticketEntry.create({
    data: {
      ticketId: id,
      body: text,
      author: session?.username ?? null,
    },
    select: { id: true, body: true, author: true, createdAt: true },
  });

  // updatedAt yangilanishi uchun tiketga teginamiz.
  await prisma.ticket.update({
    where: { id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({
    entry: {
      id: entry.id,
      body: entry.body,
      author: entry.author,
      createdAt: entry.createdAt.toISOString(),
      attachments: [],
    },
  });
}
