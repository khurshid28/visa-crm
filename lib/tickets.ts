import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

// Tiket statuslari — kalit (bazada) -> ko'rsatiladigan nom va rang.
export const TICKET_STATUS = {
  OPEN: { label: "Ochiq", tone: "amber" },
  PROGRESS: { label: "Jarayonda", tone: "blue" },
  WAITING: { label: "Kutilmoqda", tone: "violet" },
  DONE: { label: "Bajarildi", tone: "emerald" },
} as const;

export type TicketStatusKey = keyof typeof TICKET_STATUS;
export const TICKET_STATUS_KEYS = Object.keys(
  TICKET_STATUS,
) as TicketStatusKey[];

// Tiket manbalari (qayerdan kelgan).
export const TICKET_SOURCE = {
  system: { label: "Tizim" },
  web: { label: "Web" },
  bot: { label: "Bot" },
} as const;

export type TicketSourceKey = keyof typeof TICKET_SOURCE;
export const TICKET_SOURCE_KEYS = Object.keys(
  TICKET_SOURCE,
) as TicketSourceKey[];

// Bog'lanadigan obyekt turlari.
export const TICKET_REF_KIND = {
  slot: { label: "Slot" },
  group: { label: "Guruh" },
  user: { label: "User" },
  document: { label: "Hujjat" },
} as const;

export type TicketRefKind = keyof typeof TICKET_REF_KIND;

export type TicketRefView = {
  id: number;
  kind: TicketRefKind;
  refId: number;
  label: string;
};

export type TicketAttachmentView = {
  id: number;
  name: string | null;
  kind: string; // image | file
  mime: string;
  size: number;
  url: string;
};

export type TicketEntryView = {
  id: number;
  body: string | null;
  author: string | null;
  createdAt: string;
  attachments: TicketAttachmentView[];
};

export type TicketView = {
  id: number;
  title: string;
  body: string | null;
  source: string;
  status: string;
  tags: string[];
  archived: boolean;
  author: string | null;
  createdAt: string;
  updatedAt: string;
  refs: TicketRefView[];
  attachments: TicketAttachmentView[];
  entries: TicketEntryView[];
};

// "#slot #shoshilinch" -> ["slot", "shoshilinch"] (oddiy normallashtirish).
export function parseTags(raw?: string | null): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[\s,]+/)
        .map((t) => t.replace(/^#+/, "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function tagsToString(tags: string[]): string {
  return tags.map((t) => `#${t}`).join(" ");
}

const ATTACH_SELECT = {
  id: true,
  name: true,
  kind: true,
  mime: true,
  size: true,
} as const;

export const TICKET_INCLUDE = {
  refs: { orderBy: { id: "asc" as const } },
  attachments: {
    where: { entryId: null },
    select: ATTACH_SELECT,
    orderBy: { id: "asc" as const },
  },
  entries: {
    orderBy: { id: "asc" as const },
    include: {
      attachments: { select: ATTACH_SELECT, orderBy: { id: "asc" as const } },
    },
  },
} as const;

type AttachRow = {
  id: number;
  name: string | null;
  kind: string;
  mime: string;
  size: number;
};

function serializeAttachment(a: AttachRow): TicketAttachmentView {
  return {
    id: a.id,
    name: a.name,
    kind: a.kind,
    mime: a.mime,
    size: a.size,
    url: `/api/tickets/attachments/${a.id}`,
  };
}

type TicketWithRelations = Prisma.TicketGetPayload<{
  include: typeof TICKET_INCLUDE;
}>;

export function serializeTicket(t: TicketWithRelations): TicketView {
  return {
    id: t.id,
    title: t.title,
    body: t.body,
    source: t.source,
    status: t.status,
    tags: parseTags(t.tags),
    archived: t.archived,
    author: t.author,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    refs: t.refs.map((r) => ({
      id: r.id,
      kind: r.kind as TicketRefKind,
      refId: r.refId,
      label: r.label,
    })),
    attachments: t.attachments.map(serializeAttachment),
    entries: t.entries.map((e) => ({
      id: e.id,
      body: e.body,
      author: e.author,
      createdAt: e.createdAt.toISOString(),
      attachments: e.attachments.map(serializeAttachment),
    })),
  };
}

// Bitta tiketni to'liq (zanjir + fayllar bilan) olib kelish.
export async function getTicket(id: number): Promise<TicketView | null> {
  const t = await prisma.ticket.findUnique({
    where: { id },
    include: TICKET_INCLUDE,
  });
  return t ? serializeTicket(t) : null;
}

// Tiketlar ro'yxati — arxiv holati, qidiruv va sana bo'yicha filtr.
export async function listTickets(opts: {
  archived?: boolean;
  q?: string;
  from?: Date | null;
  to?: Date | null;
}): Promise<TicketView[]> {
  const where: Prisma.TicketWhereInput = {
    archived: opts.archived ?? false,
  };
  const q = (opts.q ?? "").trim();
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { body: { contains: q } },
      { tags: { contains: q } },
      { author: { contains: q } },
      { refs: { some: { label: { contains: q } } } },
      { entries: { some: { body: { contains: q } } } },
    ];
  }
  if (opts.from || opts.to) {
    where.createdAt = {};
    if (opts.from) where.createdAt.gte = opts.from;
    if (opts.to) where.createdAt.lte = opts.to;
  }
  const rows = await prisma.ticket.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: TICKET_INCLUDE,
  });
  return rows.map(serializeTicket);
}

// Bog'lash uchun obyektlarni qidirish (slot/guruh/user/hujjat).
export async function searchRefs(
  kind: TicketRefKind,
  q: string,
): Promise<TicketRefView[]> {
  const term = q.trim();
  const take = 12;

  if (kind === "slot") {
    const rows = await prisma.slot.findMany({
      where: term ? { name: { contains: term } } : undefined,
      orderBy: { id: "desc" },
      take,
      select: { id: true, name: true },
    });
    return rows.map((s) => ({
      id: 0,
      kind,
      refId: s.id,
      label: s.name,
    }));
  }

  if (kind === "group") {
    const rows = await prisma.group.findMany({
      where: term ? { name: { contains: term } } : undefined,
      orderBy: { id: "desc" },
      take,
      select: { id: true, name: true },
    });
    return rows.map((g) => ({
      id: 0,
      kind,
      refId: g.id,
      label: g.name,
    }));
  }

  // user / document — har ikkisi ham arizachi (applicant) bo'yicha.
  const rows = await prisma.applicant.findMany({
    where: term
      ? {
          OR: [
            { surname: { contains: term } },
            { name: { contains: term } },
            { passportNumber: { contains: term } },
            { generatedEmail: { contains: term } },
          ],
        }
      : undefined,
    orderBy: { id: "desc" },
    take,
    select: { id: true, surname: true, name: true, passportNumber: true },
  });
  return rows.map((a) => ({
    id: 0,
    kind,
    refId: a.id,
    label: `${a.surname} ${a.name} · ${a.passportNumber}`.trim(),
  }));
}
