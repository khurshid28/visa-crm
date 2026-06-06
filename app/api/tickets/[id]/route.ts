import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  parseTags,
  tagsToString,
  serializeTicket,
  TICKET_INCLUDE,
  TICKET_STATUS_KEYS,
  TICKET_SOURCE_KEYS,
  type TicketRefKind,
} from "@/lib/tickets";

type Params = { params: { id: string } };

const REF_KINDS: TicketRefKind[] = ["slot", "group", "user", "document"];

const INCLUDE = TICKET_INCLUDE;

type RefInput = { kind: string; refId: number; label: string };

function cleanRefs(input: unknown): RefInput[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: RefInput[] = [];
  for (const r of input) {
    if (!r || typeof r !== "object") continue;
    const kind = String((r as RefInput).kind);
    const refId = Number((r as RefInput).refId);
    const label = String((r as RefInput).label ?? "").trim();
    if (!REF_KINDS.includes(kind as TicketRefKind)) continue;
    if (!Number.isInteger(refId) || refId <= 0) continue;
    const key = `${kind}:${refId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, refId, label: label || `${kind} #${refId}` });
  }
  return out;
}

// GET /api/tickets/[id] — bitta tiketni to'liq olib kelish
export async function GET(_req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: INCLUDE,
  });
  if (!ticket) {
    return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  }
  return NextResponse.json({ ticket: serializeTicket(ticket) });
}

// PATCH /api/tickets/[id] — tahrir / status / arxiv
export async function PATCH(req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const existing = await prisma.ticket.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};

  if (typeof body.title === "string") {
    const t = body.title.trim();
    if (t) data.title = t;
  }
  if (body.body !== undefined) {
    data.body = String(body.body ?? "").trim() || null;
  }
  if (TICKET_SOURCE_KEYS.includes(body.source)) data.source = body.source;
  if (TICKET_STATUS_KEYS.includes(body.status)) data.status = body.status;
  if (body.tags !== undefined) {
    data.tags = tagsToString(parseTags(body.tags)) || null;
  }
  if (typeof body.archived === "boolean") data.archived = body.archived;

  // Bog'lanishlar to'liq qayta yoziladi (refs berilgan bo'lsa).
  if (body.refs !== undefined) {
    const refs = cleanRefs(body.refs);
    await prisma.ticketRef.deleteMany({ where: { ticketId: id } });
    if (refs.length) {
      await prisma.ticketRef.createMany({
        data: refs.map((r) => ({ ...r, ticketId: id })),
      });
    }
  }

  const ticket = await prisma.ticket.update({
    where: { id },
    data,
    include: INCLUDE,
  });

  return NextResponse.json({ ticket: serializeTicket(ticket) });
}

// DELETE /api/tickets/[id] — butunlay o'chirish (skrinshot/ref cascade)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const existing = await prisma.ticket.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  }
  await prisma.ticket.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
