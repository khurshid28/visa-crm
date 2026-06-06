import { prisma } from "./prisma";
import { countryFlag, countryName } from "./options";
import { checkSlotOpen } from "./automation";
import {
  enqueueSlotRegisteredGroups,
  enqueueSlotStaleReRegisters,
} from "./order-queue";

export type SlotDirection = {
  fromCountry: string;
  toCountry: string;
  fromFlag: string;
  toFlag: string;
  fromName: string;
  toName: string;
  label: string; // "🇺🇿 O'zbekiston → 🇱🇻 Latviya"
};

export type SlotView = {
  id: number;
  name: string;
  direction: SlotDirection;
  slotAt: string | null;
  windowMinutes: number;
  registerLeadMinutes: number;
  active: boolean;
  paused: boolean;
  lastCheckAt: string | null;
  lastMessage: string;
  openedAt: string | null;
  createdAt: string;
  groupsCount: number;
  applicantsCount: number;
  events: SlotEventView[];
};

export function slotDirection(from: string, to: string): SlotDirection {
  const fromName = countryName(from);
  const toName = countryName(to);
  const fromFlag = countryFlag(from);
  const toFlag = countryFlag(to);
  return {
    fromCountry: from,
    toCountry: to,
    fromFlag,
    toFlag,
    fromName,
    toName,
    label: `${fromFlag} ${fromName} → ${toFlag} ${toName}`,
  };
}

type SlotRow = {
  id: number;
  name: string;
  fromCountry: string;
  toCountry: string;
  slotAt: Date | null;
  windowMinutes: number;
  registerLeadMinutes: number;
  active: boolean;
  paused: boolean;
  lastCheckAt: Date | null;
  lastMessage: string;
  openedAt: Date | null;
  createdAt: Date;
  _count?: { groups: number };
};

function toView(
  row: SlotRow,
  applicantsCount = 0,
  events: SlotEventView[] = [],
): SlotView {
  return {
    id: row.id,
    name: row.name,
    direction: slotDirection(row.fromCountry, row.toCountry),
    slotAt: row.slotAt ? row.slotAt.toISOString() : null,
    windowMinutes: row.windowMinutes,
    registerLeadMinutes: row.registerLeadMinutes,
    active: row.active,
    paused: row.paused,
    lastCheckAt: row.lastCheckAt ? row.lastCheckAt.toISOString() : null,
    lastMessage: row.lastMessage,
    openedAt: row.openedAt ? row.openedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    groupsCount: row._count?.groups ?? 0,
    applicantsCount,
    events,
  };
}

export async function listSlots(): Promise<SlotView[]> {
  const rows = await prisma.slot.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { groups: true } } },
  });
  if (rows.length === 0) return [];
  // Har bir slotdagi arizachilar soni (bog'langan guruhlar orqali).
  const counts = await prisma.applicant.groupBy({
    by: ["groupId"],
    _count: { _all: true },
  });
  const groupToSlot = new Map<number, number>();
  const groups = await prisma.group.findMany({
    where: { slotId: { not: null } },
    select: { id: true, slotId: true },
  });
  for (const g of groups) if (g.slotId) groupToSlot.set(g.id, g.slotId);
  const perSlot = new Map<number, number>();
  for (const c of counts) {
    const slotId = groupToSlot.get(c.groupId);
    if (!slotId) continue;
    perSlot.set(slotId, (perSlot.get(slotId) ?? 0) + (c._count._all ?? 0));
  }
  // Har bir slot uchun oxirgi voqealar (tarix).
  const eventRows = await prisma.slotEvent.findMany({
    where: { slotId: { in: rows.map((r) => r.id) } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const eventsBySlot = new Map<number, SlotEventView[]>();
  for (const r of eventRows) {
    if (r.slotId == null) continue;
    const list = eventsBySlot.get(r.slotId) ?? [];
    if (list.length < 6) {
      list.push({
        id: r.id,
        type: r.type,
        message: r.message,
        usersQueued: r.usersQueued,
        groupsCount: r.groupsCount,
        durationSec: r.durationSec,
        createdAt: r.createdAt.toISOString(),
      });
      eventsBySlot.set(r.slotId, list);
    }
  }
  return rows.map((r) =>
    toView(r as SlotRow, perSlot.get(r.id) ?? 0, eventsBySlot.get(r.id) ?? []),
  );
}

export async function createSlot(input: {
  name: string;
  fromCountry: string;
  toCountry: string;
  slotAt?: string | null;
  windowMinutes?: number;
  registerLeadMinutes?: number;
}): Promise<SlotView> {
  const row = await prisma.slot.create({
    data: {
      name: input.name.trim() || "Yangi slot",
      fromCountry: (input.fromCountry || "UZB").toUpperCase(),
      toCountry: (input.toCountry || "LVA").toUpperCase(),
      slotAt: input.slotAt ? new Date(input.slotAt) : null,
      windowMinutes: input.windowMinutes ?? 10,
      registerLeadMinutes: input.registerLeadMinutes ?? 5,
    },
    include: { _count: { select: { groups: true } } },
  });
  await logSlotEvent(row.id, "configure", {
    slotAt: row.slotAt,
    message: "Slot yaratildi",
    source: "web",
  });
  return toView(row as SlotRow);
}

export async function controlSlot(
  id: number,
  action: "pause" | "go" | "stop",
): Promise<SlotView | null> {
  const data =
    action === "pause"
      ? { paused: true }
      : action === "go"
        ? { active: true, paused: false }
        : { active: false, paused: false, openedAt: null };
  const row = await prisma.slot.update({
    where: { id },
    data,
    include: { _count: { select: { groups: true } } },
  });
  const msg =
    action === "go"
      ? "Monitoring boshlandi (har 5 soniyada tekshiradi)"
      : action === "pause"
        ? "Pauzaga olindi"
        : "To'xtatildi";
  await logSlotEvent(id, action, {
    slotAt: row.slotAt,
    message: msg,
    source: "web",
  });
  return toView(row as SlotRow);
}

export async function configureSlot(
  id: number,
  input: {
    name?: string;
    fromCountry?: string;
    toCountry?: string;
    slotAt?: string | null;
    windowMinutes?: number;
    registerLeadMinutes?: number;
  },
): Promise<SlotView | null> {
  const row = await prisma.slot.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.fromCountry
        ? { fromCountry: input.fromCountry.toUpperCase() }
        : {}),
      ...(input.toCountry ? { toCountry: input.toCountry.toUpperCase() } : {}),
      ...(input.slotAt !== undefined
        ? { slotAt: input.slotAt ? new Date(input.slotAt) : null }
        : {}),
      ...(input.windowMinutes !== undefined
        ? { windowMinutes: input.windowMinutes }
        : {}),
      ...(input.registerLeadMinutes !== undefined
        ? { registerLeadMinutes: input.registerLeadMinutes }
        : {}),
    },
    include: { _count: { select: { groups: true } } },
  });
  await logSlotEvent(id, "configure", {
    slotAt: row.slotAt,
    message: "Slot sozlamalari yangilandi",
    source: "web",
  });
  return toView(row as SlotRow);
}

// ---- Slot voqealari (tarix) ----

export type SlotEventView = {
  id: number;
  type: string;
  message: string | null;
  usersQueued: number;
  groupsCount: number;
  durationSec: number | null;
  createdAt: string;
};

export async function logSlotEvent(
  slotId: number,
  type: string,
  data: {
    slotAt?: Date | string | null;
    closeAt?: Date | string | null;
    message?: string | null;
    usersQueued?: number;
    groupsCount?: number;
    durationSec?: number | null;
    source?: "web" | "bot" | "system";
  } = {},
): Promise<void> {
  try {
    await prisma.slotEvent.create({
      data: {
        slotId,
        type,
        slotAt: data.slotAt ? new Date(data.slotAt) : null,
        closeAt: data.closeAt ? new Date(data.closeAt) : null,
        message: data.message ?? null,
        usersQueued: data.usersQueued ?? 0,
        groupsCount: data.groupsCount ?? 0,
        durationSec: data.durationSec ?? null,
        source: data.source ?? "system",
      },
    });
  } catch {
    // Log yozilmasa ham asosiy oqim buzilmasin.
  }
}

export async function listSlotEvents(
  slotId: number,
  limit = 8,
): Promise<SlotEventView[]> {
  const rows = await prisma.slotEvent.findMany({
    where: { slotId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    message: r.message,
    usersQueued: r.usersQueued,
    groupsCount: r.groupsCount,
    durationSec: r.durationSec,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---- Per-slot monitoring tick engine ----
// Eski yagona SlotMonitor o'rniga: har bir slot o'z vaqti/oynasi bo'yicha
// mustaqil tekshiriladi. Faqat shu slotga bog'langan guruhlar navbatga ketadi.

export type SlotTickResult = {
  slot: SlotView | null;
  checked: boolean;
  slotOpen: boolean;
  message: string;
};

function fmtRemaining(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin));
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} kun`);
  if (hours > 0 || days > 0) parts.push(`${hours} soat`);
  parts.push(`${mins} daq`);
  return parts.join(" ");
}

async function patchSlot(
  id: number,
  data: Record<string, unknown>,
): Promise<SlotView> {
  const row = await prisma.slot.update({
    where: { id },
    data,
    include: { _count: { select: { groups: true } } },
  });
  return toView(row as SlotRow);
}

export async function runSlotTick(id: number): Promise<SlotTickResult> {
  const now = new Date();
  const current = await prisma.slot.findUnique({ where: { id } });
  if (!current) {
    return {
      slot: null,
      checked: false,
      slotOpen: false,
      message: "Topilmadi",
    };
  }

  if (!current.active) {
    return {
      slot: toView(current as SlotRow),
      checked: false,
      slotOpen: false,
      message: current.lastMessage || "Faol emas",
    };
  }

  if (current.paused) {
    const slot = await patchSlot(id, {
      lastCheckAt: now,
      lastMessage: "PAUSE: tekshiruv to'xtatilgan",
    });
    return { slot, checked: false, slotOpen: false, message: slot.lastMessage };
  }

  if (!current.slotAt) {
    const slot = await patchSlot(id, {
      active: false,
      lastCheckAt: now,
      lastMessage: "Slot vaqti belgilanmagan — to'xtatildi",
    });
    return { slot, checked: false, slotOpen: false, message: slot.lastMessage };
  }

  const target = new Date(current.slotAt);
  const windowMs = current.windowMinutes * 60_000;
  const leadMs = current.registerLeadMinutes * 60_000;
  const leadStart = target.getTime() - windowMs - leadMs;
  const checkStart = target.getTime() - windowMs;
  const end = target.getTime() + windowMs;

  // Hali erta — kutish.
  if (now.getTime() < leadStart) {
    const mins = Math.ceil((leadStart - now.getTime()) / 60_000);
    const slot = await patchSlot(id, {
      lastCheckAt: now,
      lastMessage: `Tekshiruv hali boshlanmadi (${fmtRemaining(mins)} qoldi)`,
    });
    return { slot, checked: false, slotOpen: false, message: slot.lastMessage };
  }

  // Lead oyna — eskirgan registerlarni qayta navbatga.
  if (now.getTime() < checkStart) {
    const re = await enqueueSlotStaleReRegisters(id, "system");
    const slot = await patchSlot(id, {
      lastCheckAt: now,
      lastMessage:
        re.queued > 0
          ? `Register oynasi: ${re.queued} ta qayta navbatga qo'shildi`
          : "Register oynasi: registerlar yangi, slot kutilmoqda",
    });
    return { slot, checked: false, slotOpen: false, message: slot.lastMessage };
  }

  // Oyna tugadi.
  if (now.getTime() > end) {
    const durationSec = current.openedAt
      ? Math.round(
          (now.getTime() - new Date(current.openedAt).getTime()) / 1000,
        )
      : null;
    const slot = await patchSlot(id, {
      active: false,
      lastCheckAt: now,
      lastMessage: "Slot oynasi tugadi — monitoring to'xtadi",
    });
    await logSlotEvent(id, "expired", {
      slotAt: current.slotAt,
      message: slot.lastMessage,
      durationSec,
      source: "system",
    });
    return { slot, checked: false, slotOpen: false, message: slot.lastMessage };
  }

  // Slotni tekshiramiz.
  const open = await checkSlotOpen();
  if (!open.open) {
    const slot = await patchSlot(id, {
      lastCheckAt: now,
      lastMessage: `Slot yopiq: ${open.note}`,
    });
    return { slot, checked: true, slotOpen: false, message: slot.lastMessage };
  }

  // Slot ochildi — shu slot guruhlarini navbatga.
  const queued = await enqueueSlotRegisteredGroups(id, "system");
  const slot = await patchSlot(id, {
    active: false,
    openedAt: now,
    lastCheckAt: now,
    lastMessage:
      `Slot ochildi: ${queued.queuedJobs} user order navbatiga yuborildi ` +
      `(skip: ${queued.skippedJobs})`,
  });
  await logSlotEvent(id, "open", {
    slotAt: current.slotAt,
    message: slot.lastMessage,
    usersQueued: queued.queuedJobs,
    groupsCount: queued.totalGroups,
    source: "system",
  });
  return { slot, checked: true, slotOpen: true, message: slot.lastMessage };
}
