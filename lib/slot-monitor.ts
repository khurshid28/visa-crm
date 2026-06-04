import { promises as fs } from "fs";
import path from "path";
import { ApplicantStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { checkSlotOpen } from "./automation";
import {
  enqueueAllRegisteredGroups,
  enqueueStaleReRegisters,
} from "./order-queue";

const MONITOR_STATE_PATH = path.join(
  process.cwd(),
  "uploads",
  "slot-monitor-state.json",
);

export type SlotMonitorState = {
  active: boolean;
  paused: boolean;
  slotAt: string | null;
  intervalSeconds: number;
  windowMinutes: number;
  registerLeadMinutes: number;
  lastCheckAt: string | null;
  lastMessage: string;
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
  intervalSeconds: 10,
  windowMinutes: 10,
  registerLeadMinutes: 5,
  lastCheckAt: null,
  lastMessage: "Monitoring to'xtagan",
};

async function ensureStateFile() {
  await fs.mkdir(path.dirname(MONITOR_STATE_PATH), { recursive: true });
  try {
    await fs.access(MONITOR_STATE_PATH);
  } catch {
    await fs.writeFile(
      MONITOR_STATE_PATH,
      JSON.stringify(DEFAULT_STATE, null, 2),
      "utf8",
    );
  }
}

async function readState(): Promise<SlotMonitorState> {
  await ensureStateFile();
  try {
    const raw = await fs.readFile(MONITOR_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<SlotMonitorState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      intervalSeconds: 10,
      windowMinutes: 10,
      registerLeadMinutes: 5,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function writeState(next: SlotMonitorState) {
  await ensureStateFile();
  await fs.writeFile(MONITOR_STATE_PATH, JSON.stringify(next, null, 2), "utf8");
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
      "active" | "paused" | "slotAt" | "lastMessage" | "lastCheckAt"
    >
  >,
): Promise<SlotMonitorState> {
  const current = await readState();
  const next: SlotMonitorState = {
    ...current,
    ...patch,
    intervalSeconds: 10,
    windowMinutes: 10,
    registerLeadMinutes: 5,
  };
  await writeState(next);
  return next;
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
      lastMessage: `Slot tekshiruvi hali boshlanmadi (${mins} daq qoldi)`,
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
    const next = await setSlotMonitorState({
      active: false,
      lastCheckAt: now.toISOString(),
      lastMessage: "Slot oynasi tugadi (+10 daqiqa) — monitoring to'xtadi",
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
    lastCheckAt: now.toISOString(),
    lastMessage:
      `Slot ochildi: ${queued.queuedJobs} user order queue'ga yuborildi ` +
      `(skip: ${queued.skippedJobs})`,
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
