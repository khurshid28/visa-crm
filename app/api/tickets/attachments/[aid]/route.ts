import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: { aid: string } };

// GET /api/tickets/attachments/[aid] — saqlangan faylni qaytaradi.
// Rasm bo'lsa inline ko'rsatadi; hujjat bo'lsa yuklab olish (attachment).
export async function GET(_req: NextRequest, { params }: Params) {
  const aid = Number(params.aid);
  const att = await prisma.ticketAttachment.findUnique({
    where: { id: aid },
    select: { data: true, mime: true, name: true, kind: true },
  });
  if (!att) {
    return NextResponse.json({ error: "Fayl yo'q" }, { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": att.mime || "application/octet-stream",
    "Cache-Control": "private, max-age=86400",
  };

  if (att.kind !== "image") {
    const safeName = (att.name || `fayl-${aid}`).replace(/["\r\n]/g, "");
    headers["Content-Disposition"] = `attachment; filename="${safeName}"`;
  }

  return new NextResponse(new Uint8Array(att.data), { headers });
}
