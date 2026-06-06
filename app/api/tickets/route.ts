import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  listTickets,
  parseTags,
  tagsToString,
  serializeTicket,
  TICKET_INCLUDE,
  TICKET_STATUS_KEYS,
  TICKET_SOURCE_KEYS,
  type TicketRefKind,
} from "@/lib/tickets";

const REF_KINDS: TicketRefKind[] = ["slot", "group", "user", "document"];

// GET /api/tickets?archived=0&q=...&from=...&to=...
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const archived = sp.get("archived") === "1";
  const q = sp.get("q") ?? "";
  const fromRaw = sp.get("from");
  const toRaw = sp.get("to");
  const from = fromRaw ? new Date(fromRaw) : null;
  const to = toRaw ? new Date(toRaw) : null;
  const tickets = await listTickets({
    archived,
    q,
    from: from && !isNaN(from.getTime()) ? from : null,
    to: to && !isNaN(to.getTime()) ? to : null,
  });
  return NextResponse.json({ tickets });
}

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

// POST /api/tickets — yangi tiket yaratish
export async function POST(req: NextRequest) {
  const session = await getSession();
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 });
  }

  const title = String(body.title ?? "").trim();
  if (!title) {
    return NextResponse.json(
      { error: "Sarlavha kiritilishi shart" },
      { status: 400 },
    );
  }

  const text = String(body.body ?? "").trim() || null;
  const source = TICKET_SOURCE_KEYS.includes(body.source)
    ? body.source
    : "system";
  const status = TICKET_STATUS_KEYS.includes(body.status)
    ? body.status
    : "OPEN";
  const tags = tagsToString(parseTags(body.tags));
  const refs = cleanRefs(body.refs);

  const ticket = await prisma.ticket.create({
    data: {
      title,
      body: text,
      source,
      status,
      tags: tags || null,
      author: session?.username ?? null,
      refs: { create: refs },
    },
    include: TICKET_INCLUDE,
  });

  return NextResponse.json({ ticket: serializeTicket(ticket) });
}
