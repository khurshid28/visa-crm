import { ApplicantStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { checkSlotOpen } from "./automation";
import {
  enqueueAllRegisteredGroups,
  enqueueStaleReRegisters,
} from "./order-queue";

const MONITOR_ID = 1;

export type SlotMonitorState = {
  active: boolean;
  paused: boolean;
  slotAt: string | null;
  intervalSeconds: number;
  windowMinutes: number;
  registerLeadMinutes: number;
  lastCheckAt: string | null;
  lastMessage: string;
  openedAt: string | null;
};

export type SlotEventType =
  | "configure"
  | "open"
  | "close"
  | "pause"
  | "go"
  | "stop"
  | "check"
  | "expired";

export type SlotEvent = {
  id: number;
  type: string;
  slotAt: string | null;
  closeAt: string | null;
  message: string | null;
  usersQueued: number;
  usersDone: number;
  durationSec: number | null;
  source: string;
  username: string | null;
  createdAt: string;
};

export type SlotQueueStats = {
  groups: number;
  registeredTotal: number;
  registeredComplete: number;
};

export type SlotTickResult = {
  state: SlotMonitorState;
  queue: SlotQueueStats;
  checked: boolean;
  slotOpen: boolean;
  message: string;
  queued?: {
    groups: number;
    queued: number;
    skipped: number;
  };
};

const DEFAULT_STATE: SlotMonitorState = {
  active: false,
  paused: false,
  slotAt: null,
  intervalSeconds: 5,
  windowMinutes: 5,
  registerLeadMinutes: 5,
  lastCheckAt: null,
  lastMessage: "Monitoring to'xtagan",
  openedAt: null,
};

type MonitorRow = {
  active: boolean;
  paused: boolean;
  slotAt: Date | null;
  windowMinutes: number;
  registerLeadMinutes: number;
  lastCheckAt: Date | null;
  lastMessage: string;
  openedAt: Date | null;
};

function toState(row: MonitorRow): SlotMonitorState {
  return {
    active: row.active,
    paused: row.paused,
    slotAt: row.slotAt ? row.slotAt.toISOString() : null,
    intervalSeconds: 5,
    windowMinutes: row.windowMinutes,
    registerLeadMinutes: row.registerLeadMinutes,
    lastCheckAt: row.lastCheckAt ? row.lastCheckAt.toISOString() : null,
    lastMessage: row.lastMessage,
    openedAt: row.openedAt ? row.openedAt.toISOString() : null,
  };
}

async function readState(): Promise<SlotMonitorState> {
  const row = await prisma.slotMonitor.upsert({
    where: { id: MONITOR_ID },
    create: { id: MONITOR_ID },
    update: {},
  });
  return toState(row as MonitorRow);
}

export async function getSlotQueueStats(): Promise<SlotQueueStats> {
  const [total, complete, grouped] = await Promise.all([
    prisma.applicant.count({ where: { status: ApplicantStatus.REGISTERED } }),
    prisma.applicant.count({
      where: { status: ApplicantStatus.REGISTERED, complete: true },
    }),
    prisma.applicant.groupBy({
      by: ["groupId"],
      where: { status: ApplicantStatus.REGISTERED },
      _count: { _all: true },
    }),
  ]);

  return {
    groups: grouped.length,
    registeredTotal: total,
    registeredComplete: complete,
  };
}

export async function getSlotMonitorState(): Promise<SlotMonitorState> {
  return readState();
}

export async function setSlotMonitorState(
  patch: Partial<
    Pick<
      SlotMonitorState,
      | "active"
      | "paused"
      | "slotAt"
      | "windowMinutes"
      | "lastMessage"
      | "lastCheckAt"
      | "openedAt"
    >
  >,
): Promise<SlotMonitorState> {
  const data: Record<string, unknown> = {};
  if (patch.active !== undefined) data.active = patch.active;
  if (patch.paused !== undefined) data.paused = patch.paused;
  if (patch.slotAt !== undefined)
    data.slotAt = patch.slotAt ? new Date(patch.slotAt) : null;
  if (patch.windowMinutes !== undefined)
    data.windowMinutes = patch.windowMinutes;
  if (patch.lastMessage !== undefined) data.lastMessage = patch.lastMessage;
  if (patch.lastCheckAt !== undefined)
    data.lastCheckAt = patch.lastCheckAt ? new Date(patch.lastCheckAt) : null;
  if (patch.openedAt !== undefined)
    data.openedAt = patch.openedAt ? new Date(patch.openedAt) : null;

  const row = await prisma.slotMonitor.upsert({
    where: { id: MONITOR_ID },
    create: { id: MONITOR_ID, ...data },
    update: data,
  });
  return toState(row as MonitorRow);
}

// Slot voqeasini tarixga yozadi (kim/qachon/qanday o'zgardi, nechta user o'tdi).
export async function logSlotEvent(
  type: SlotEventType,
  data: {
    slotAt?: string | Date | null;
    closeAt?: string | Date | null;
    message?: string | null;
    usersQueued?: number;
    usersDone?: number;
    durationSec?: number | null;
    source?: "web" | "bot" | "system";
    username?: string | null;
  } = {},
): Promise<void> {
  try {
    await prisma.slotEvent.create({
      data: {
        type,
        slotAt: data.slotAt ? new Date(data.slotAt) : null,
        closeAt: data.closeAt ? new Date(data.closeAt) : null,
        message: data.message ?? null,
        usersQueued: data.usersQueued ?? 0,
        usersDone: data.usersDone ?? 0,
        durationSec: data.durationSec ?? null,
        source: data.source ?? "system",
        username: data.username ?? null,
      },
    });
  } catch {
    // Log yozilmasa ham asosiy oqim buzilmasin.
  }
}

export async function getSlotEvents(limit = 30): Promise<SlotEvent[]> {
  const rows = await prisma.slotEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    slotAt: r.slotAt ? r.slotAt.toISOString() : null,
    closeAt: r.closeAt ? r.closeAt.toISOString() : null,
    message: r.message,
    usersQueued: r.usersQueued,
    usersDone: r.usersDone,
    durationSec: r.durationSec,
    source: r.source,
    username: r.username,
    createdAt: r.createdAt.toISOString(),
  }));
}

// Qolgan daqiqalarni o'zbekcha o'qiladigan ko'rinishga keltiradi:
// 8685 -> "6 kun 0 soat 45 daq", 95 -> "1 soat 35 daq", 7 -> "7 daq".
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

export async function runSlotMonitorTick(): Promise<SlotTickResult> {
  const now = new Date();
  const current = await readState();
  const queue = await getSlotQueueStats();

  if (!current.active) {
    return {
      state: current,
      queue,
      checked: false,
      slotOpen: false,
      message: current.lastMessage || "Monitoring faol emas",
    };
  }

  if (current.paused) {
    const next = await setSlotMonitorState({
      lastCheckAt: now.toISOString(),
      lastMessage: "PAUSE: slot tekshiruvi to'xtatilgan",
    });
    return {
      state: next,
      queue,
      checked: false,
      slotOpen: false,
      message: next.lastMessage,
    };
  }

  if (!current.slotAt) {
    const next = await setSlotMonitorState({
      active: false,
      lastCheckAt: now.toISOString(),
      lastMessage: "Slot vaqti belgilanmagan — monitoring to'xtatildi",
    });
    return {
      state: next,
      queue,
      checked: false,
      slotOpen: false,
      message: next.lastMessage,
    };
  }

  const target = new Date(current.slotAt);
  const windowMs = current.windowMinutes * 60_000;
  const leadMs = current.registerLeadMinutes * 60_000;
  // Register uchun lead: slot vaqtidan (10+5) daqiqa oldin boshlanadi.
  const leadStart = target.getTime() - windowMs - leadMs;
  const checkStart = target.getTime() - windowMs;
  const end = target.getTime() + windowMs;

  if (now.getTime() < leadStart) {
    const mins = Math.ceil((leadStart - now.getTime()) / 60_000);
    const next = await setSlotMonitorState({
      lastCheckAt: now.toISOString(),
      lastMessage: `Slot tekshiruvi hali boshlanmadi (${fmtRemaining(mins)} qoldi)`,
    });
    return {
      state: next,
      queue,
      checked: false,
      slotOpen: false,
      message: next.lastMessage,
    };
  }

  // Lead oyna (slot −15..−10 daq): bir qarab o'tamiz — eskirgan registerlarni
  // qayta register qilish uchun navbatga qo'shamiz, slot hali tekshirilmaydi.
  if (now.getTime() < checkStart) {
    const re = await enqueueStaleReRegisters("system");
    const next = await setSlotMonitorState({
      lastCheckAt: now.toISOString(),
      lastMessage:
        re.queued > 0
          ? `Register oynasi: ${re.queued} ta eskirgan register qayta navbatga qo'shildi`
          : "Register oynasi: barcha registerlar yangi, slot kutilmoqda",
    });
    return {
      state: next,
      queue,
      checked: false,
      slotOpen: false,
      message: next.lastMessage,
    };
  }

  if (now.getTime() > end) {
    const durationSec = current.openedAt
      ? Math.round(
          (now.getTime() - new Date(current.openedAt).getTime()) / 1000,
        )
      : null;
    const next = await setSlotMonitorState({
      active: false,
      openedAt: null,
      lastCheckAt: now.toISOString(),
      lastMessage: "Slot oynasi tugadi (+10 daqiqa) — monitoring to'xtadi",
    });
    await logSlotEvent("expired", {
      slotAt: current.slotAt,
      message: next.lastMessage,
      durationSec,
      source: "system",
    });
    return {
      state: next,
      queue,
      checked: false,
      slotOpen: false,
      message: next.lastMessage,
    };
  }

  const slot = await checkSlotOpen();
  if (!slot.open) {
    const next = await setSlotMonitorState({
      lastCheckAt: now.toISOString(),
      lastMessage: `Slot yopiq: ${slot.note}`,
    });
    return {
      state: next,
      queue,
      checked: true,
      slotOpen: false,
      message: next.lastMessage,
    };
  }

  const queued = await enqueueAllRegisteredGroups("system");
  const next = await setSlotMonitorState({
    active: false,
    openedAt: now.toISOString(),
    lastCheckAt: now.toISOString(),
    lastMessage:
      `Slot ochildi: ${queued.queuedJobs} user order queue'ga yuborildi ` +
      `(skip: ${queued.skippedJobs})`,
  });
  await logSlotEvent("open", {
    slotAt: current.slotAt,
    message: next.lastMessage,
    usersQueued: queued.queuedJobs,
    source: "system",
  });

  return {
    state: next,
    queue,
    checked: true,
    slotOpen: true,
    message: next.lastMessage,
    queued: {
      groups: queued.totalGroups,
      queued: queued.queuedJobs,
      skipped: queued.skippedJobs,
    },
  };
}
