import { prisma } from "./prisma";
import { countryFlag, countryName } from "./options";

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

function toView(row: SlotRow, applicantsCount = 0): SlotView {
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
  return rows.map((r) => toView(r as SlotRow, perSlot.get(r.id) ?? 0));
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
  return toView(row as SlotRow);
}
