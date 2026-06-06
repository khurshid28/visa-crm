import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Params = { params: { id: string } };

const MAX_TICKET_FILES = 10; // tiket darajasidagi fayllar
const MAX_ENTRY_FILES = 10; // bitta xabardagi fayllar
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB / rasm
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB / hujjat

const IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

// Xavfli (bajariladigan) turlarni rad etamiz.
const BLOCKED = new Set([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-sh",
  "application/x-bat",
  "text/x-shellscript",
]);

function attachKind(mime: string): "image" | "file" {
  return IMAGE_MIME.has(mime) ? "image" : "file";
}

// POST /api/tickets/[id]/attachments — rasm/hujjat yuklash.
// FormData: files[], [entryId] (xabarga biriktirish uchun).
export async function POST(req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) {
    return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  }

  const form = await req.formData();
  const entryIdRaw = String(form.get("entryId") ?? "").trim();
  const entryId =
    entryIdRaw && /^\d+$/.test(entryIdRaw) ? Number(entryIdRaw) : null;

  if (entryId) {
    const entry = await prisma.ticketEntry.findUnique({
      where: { id: entryId },
    });
    if (!entry || entry.ticketId !== id) {
      return NextResponse.json({ error: "Xabar topilmadi" }, { status: 404 });
    }
  }

  const files = form
    .getAll("files")
    .filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "Fayl topilmadi" }, { status: 400 });
  }

  const used = await prisma.ticketAttachment.count({
    where: { ticketId: id, entryId },
  });
  const limit = entryId ? MAX_ENTRY_FILES : MAX_TICKET_FILES;
  const remaining = limit - used;
  if (remaining <= 0) {
    return NextResponse.json(
      { error: `${limit} tadan ortiq fayl bo'lmaydi` },
      { status: 400 },
    );
  }

  const toSave = files.slice(0, remaining);
  const created: unknown[] = [];

  for (const file of toSave) {
    const mime = file.type || "application/octet-stream";
    if (BLOCKED.has(mime)) continue;
    const kind = attachKind(mime);
    const cap = kind === "image" ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
    if (file.size > cap) continue;
    const buf = Buffer.from(await file.arrayBuffer());
    const row = await prisma.ticketAttachment.create({
      data: {
        ticketId: id,
        entryId,
        data: buf,
        mime,
        name: file.name || null,
        size: file.size,
        kind,
      },
      select: { id: true, name: true, kind: true, mime: true, size: true },
    });
    created.push({
      ...row,
      url: `/api/tickets/attachments/${row.id}`,
    });
  }

  await prisma.ticket.update({
    where: { id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({ attachments: created });
}
