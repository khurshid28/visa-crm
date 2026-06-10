import { prisma } from "./prisma";
import { countryFlag, countryName } from "./options";
import { detectCalendar } from "./automation";
import type { CalendarDetectResult } from "./automation";
import { runWithProxyAttribution } from "./proxy-usage";
import {
  enqueueSlotRegisteredGroups,
  enqueueSlotStaleReRegisters,
} from "./order-queue";
import {
  isTelegramConfigured,
  getAdminChatIds,
  sendMessage,
  sendPhoto,
} from "./telegram";
import * as fs from "fs";

// ===========================================================================
//  KO'P SLOTLI TEKSHIRUV — bir vaqtda 2-3 slot monitoring qilinganda Chrome
//  ust-ustiga ochilmasligi uchun nazorat (concurrency control).
//
//  Muammo: client har 5 soniyada har bir faol slot uchun "tick" yuboradi, lekin
//  bitta tekshiruv (detectCalendar => haqiqiy Chrome) 15-20 soniya davom etadi.
//  Nazoratsiz holatda: (a) bitta slot uchun oldingisi tugamasdan yangi Chrome
//  ochiladi; (b) 3 ta faol slot bir paytda 3 ta Chrome ochib, CPU/proksini
//  bo'g'adi. Quyidagi ikki himoya buni bartaraf etadi:
//   1) checkingSlots — bitta slot bir vaqtda faqat BITTA Chrome ochadi (qayta
//      kirishni bloklaydi). Tugamaguncha yangi tick "davom etmoqda" deydi.
//   2) activeChecks  — global bir vaqtdagi tekshiruvlar soni cheklanadi
//      (SLOT_CHECK_CONCURRENCY, default 1 = ketma-ket). Ortiqchasi "navbatda".
//
//  Eslatma: bu in-memory (jarayon ichida) himoya — client polling barchasi
//  bitta Next jarayonida bajariladi, shuning uchun yetarli. (slot-worker.ts
//  alohida jarayon bo'lsa, u kamdan-kam, ~10 daqiqada bir marta tekshiradi.)
// ===========================================================================
const checkingSlots = new Set<number>();
const SLOT_CHECK_CONCURRENCY = Math.max(
  1,
  Math.floor(Number(process.env.SLOT_CHECK_CONCURRENCY || 1)),
);
let activeChecks = 0;

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
  centre: string | null;
  category: string | null;
  subCategory: string | null;
  active: boolean;
  paused: boolean;
  lastCheckAt: string | null;
  lastMessage: string;
  openedAt: string | null;
  lastShotPath: string | null;
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
  centre: string | null;
  category: string | null;
  subCategory: string | null;
  active: boolean;
  paused: boolean;
  lastCheckAt: Date | null;
  lastMessage: string;
  openedAt: Date | null;
  lastShotPath: string | null;
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
    centre: row.centre ?? null,
    category: row.category ?? null,
    subCategory: row.subCategory ?? null,
    active: row.active,
    paused: row.paused,
    lastCheckAt: row.lastCheckAt ? row.lastCheckAt.toISOString() : null,
    lastMessage: row.lastMessage,
    openedAt: row.openedAt ? row.openedAt.toISOString() : null,
    lastShotPath: row.lastShotPath ?? null,
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
  centre?: string | null;
  category?: string | null;
  subCategory?: string | null;
}): Promise<SlotView> {
  const row = await prisma.slot.create({
    data: {
      name: input.name.trim() || "Yangi slot",
      fromCountry: (input.fromCountry || "UZB").toUpperCase(),
      toCountry: (input.toCountry || "LVA").toUpperCase(),
      slotAt: input.slotAt ? new Date(input.slotAt) : null,
      windowMinutes: input.windowMinutes ?? 10,
      registerLeadMinutes: input.registerLeadMinutes ?? 5,
      centre: input.centre?.trim() || null,
      category: input.category?.trim() || null,
      subCategory: input.subCategory?.trim() || null,
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
    centre?: string | null;
    category?: string | null;
    subCategory?: string | null;
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
      ...(input.centre !== undefined
        ? { centre: input.centre?.trim() || null }
        : {}),
      ...(input.category !== undefined
        ? { category: input.category?.trim() || null }
        : {}),
      ...(input.subCategory !== undefined
        ? { subCategory: input.subCategory?.trim() || null }
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

export async function runSlotTick(
  id: number,
  opts?: { notify?: boolean },
): Promise<SlotTickResult> {
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

  // Slotni tekshiramiz — kalendar sahifasini ochib, bo'sh kun bor-yo'qligini
  // aniqlaymiz. Proxy yoqilgan bo'lsa rotating IP orqali o'tadi.
  //
  // KO'P SLOTLI HIMOYA (ko'pincha bir vaqtda 2-3 slot faol):
  //  1) shu slot allaqachon tekshirilmoqda bo'lsa — yangi Chrome ochmaymiz.
  if (checkingSlots.has(id)) {
    const slot = await patchSlot(id, {
      lastCheckAt: now,
      lastMessage: "Tekshiruv davom etmoqda (oldingisi hali tugamadi)",
    });
    return { slot, checked: false, slotOpen: false, message: slot.lastMessage };
  }
  //  2) global bir vaqtdagi tekshiruvlar chegarasi to'lgan bo'lsa — navbatda
  //     kutadi (keyingi tick'da yana uriniladi). Chrome'lar bo'g'ilmaydi.
  if (activeChecks >= SLOT_CHECK_CONCURRENCY) {
    const slot = await patchSlot(id, {
      lastCheckAt: now,
      lastMessage: "Navbatda: boshqa slot tekshirilmoqda",
    });
    return { slot, checked: false, slotOpen: false, message: slot.lastMessage };
  }

  // Qulflab tekshiramiz (faqat Chrome ochiq turgan vaqt qulflanadi).
  checkingSlots.add(id);
  activeChecks++;
  let cal: CalendarDetectResult;
  try {
    cal = await runWithProxyAttribution({ label: "slot", stage: "slot" }, () =>
      detectCalendar({
        slotId: id,
        centre: current.centre,
        category: current.category,
        subCategory: current.subCategory,
      }),
    );
  } finally {
    checkingSlots.delete(id);
    activeChecks--;
  }
  if (!cal.open) {
    const slot = await patchSlot(id, {
      lastCheckAt: now,
      lastMessage: `Kalendar yopiq: ${cal.note}`,
      ...(cal.screenshotPath ? { lastShotPath: cal.screenshotPath } : {}),
    });
    // Davriy holat xabari (slot-worker har ~10 daqiqada) — adminlarga skrinshot
    // + ketgan vaqt bilan. Faqat notify yoqilganda (worker), client polling EMAS.
    if (opts?.notify) notifySlotCheck(slot, cal).catch(() => {});
    return { slot, checked: true, slotOpen: false, message: slot.lastMessage };
  }

  // Slot ochildi — shu slot guruhlarini navbatga.
  const queued = await enqueueSlotRegisteredGroups(id, "system");
  const slot = await patchSlot(id, {
    active: false,
    openedAt: now,
    lastCheckAt: now,
    ...(cal.screenshotPath ? { lastShotPath: cal.screenshotPath } : {}),
    lastMessage:
      `Kalendar ochildi (${cal.availableDates.length} bo'sh kun): ` +
      `${queued.queuedJobs} user order navbatiga yuborildi ` +
      `(skip: ${queued.skippedJobs})`,
  });
  await logSlotEvent(id, "open", {
    slotAt: current.slotAt,
    message: slot.lastMessage,
    usersQueued: queued.queuedJobs,
    groupsCount: queued.totalGroups,
    source: "system",
  });
  // Bot adminlarga xabar bersin (fire-and-forget — asosiy oqimni bloklamaydi).
  notifySlotOpen(slot, cal, queued.queuedJobs).catch(() => {});
  return { slot, checked: true, slotOpen: true, message: slot.lastMessage };
}

// ===========================================================================
//  QO'LDA BRAUZER TEKSHIRUVI (checkSlotNow) — har bir slot kartasidagi
//  "Brauzerda tekshirish" tugmasi uchun. Slotning markaz/kategoriya/
//  subkategoriyasi bo'yicha VFS kalendarini ochib, bo'sh kun bor-yo'qligini
//  DARHOL tekshiradi — vaqt oynasiga BOG'LIQ EMAS (istalgan paytda ishlaydi).
//  Bu faqat DIAGNOSTIKA: order navbatini ISHGA TUSHIRMAYDI va active/openedAt
//  holatini O'ZGARTIRMAYDI (runSlotTick'dan farqi shu). Faqat lastCheckAt +
//  lastMessage (+ skrinshot) yangilanadi. Ko'p slotli himoya
//  (checkingSlots/activeChecks) bu yerda ham qo'llanadi — Chrome'lar
//  ust-ustiga ochilmaydi.
// ===========================================================================
export type SlotCheckNowResult = {
  ok: boolean;
  open: boolean;
  note: string;
  durationMs: number;
  screenshotPath: string | null;
  slot: SlotView | null;
};

export async function checkSlotNow(id: number): Promise<SlotCheckNowResult> {
  const now = new Date();
  const current = await prisma.slot.findUnique({ where: { id } });
  if (!current) {
    return {
      ok: false,
      open: false,
      note: "Slot topilmadi",
      durationMs: 0,
      screenshotPath: null,
      slot: null,
    };
  }

  // Bir slot bir vaqtda faqat BITTA Chrome ochadi (qayta kirishni bloklaydi).
  if (checkingSlots.has(id)) {
    return {
      ok: false,
      open: false,
      note: "Tekshiruv davom etmoqda (oldingisi hali tugamadi)",
      durationMs: 0,
      screenshotPath: null,
      slot: toView(current as SlotRow),
    };
  }
  // Global bir vaqtdagi tekshiruvlar chegarasi to'lgan bo'lsa — navbatda.
  if (activeChecks >= SLOT_CHECK_CONCURRENCY) {
    return {
      ok: false,
      open: false,
      note: "Navbatda: boshqa slot tekshirilmoqda",
      durationMs: 0,
      screenshotPath: null,
      slot: toView(current as SlotRow),
    };
  }

  checkingSlots.add(id);
  activeChecks++;
  let cal: CalendarDetectResult;
  try {
    cal = await runWithProxyAttribution({ label: "slot", stage: "slot" }, () =>
      detectCalendar({
        slotId: id,
        centre: current.centre,
        category: current.category,
        subCategory: current.subCategory,
      }),
    );
  } finally {
    checkingSlots.delete(id);
    activeChecks--;
  }

  const message = cal.open
    ? `Qo'lda tekshiruv: kalendar OCHIQ (${cal.availableDates.length} bo'sh kun)`
    : `Qo'lda tekshiruv: ${cal.note}`;
  const slot = await patchSlot(id, {
    lastCheckAt: now,
    lastMessage: message,
    ...(cal.screenshotPath ? { lastShotPath: cal.screenshotPath } : {}),
  });
  return {
    ok: true,
    open: cal.open,
    note: cal.note,
    durationMs: cal.durationMs,
    screenshotPath: cal.screenshotPath,
    slot,
  };
}

// Slot topilganda (success) adminlarga Telegram orqali xabar + skrinshot yuboradi.
// .env: SLOT_NOTIFY_TELEGRAM=false bo'lsa o'chadi (default: yoqilgan).
async function notifySlotOpen(
  slot: SlotView,
  cal: CalendarDetectResult,
  queuedJobs: number,
): Promise<void> {
  const enabled =
    (process.env.SLOT_NOTIFY_TELEGRAM || "true").trim().toLowerCase() !==
    "false";
  if (!enabled || !isTelegramConfigured()) return;

  const dir = slot.direction;
  const datesPreview = cal.availableDates.slice(0, 8).join(", ");
  const caption =
    `✅ <b>SLOT OCHILDI!</b>\n` +
    `🧭 ${dir.label}\n` +
    `📋 Slot: <b>${escapeHtml(slot.name)}</b>\n` +
    (slot.category ? `🏷 ${escapeHtml(slot.category)}\n` : "") +
    (slot.subCategory ? `↳ ${escapeHtml(slot.subCategory)}\n` : "") +
    `➖➖➖➖➖➖➖➖➖➖\n` +
    `📅 Bo'sh kunlar: <b>${cal.availableDates.length}</b>` +
    (datesPreview ? ` (${escapeHtml(datesPreview)})` : "") +
    `\n🚀 Navbatga yuborildi: <b>${queuedJobs}</b> user` +
    `\n⏱ Davomiyligi: <b>${fmtDuration(cal.durationMs)}</b>` +
    `\n🕐 Vaqt: ${nowTimeStr()}` +
    (cal.exitIp ? `\n🌐 IP: ${escapeHtml(cal.exitIp)}` : "");

  await broadcastSlotPhoto(caption, cal.screenshotPath, `slot-${slot.id}.png`);
}

// Har tekshiruvdan keyin (slot-worker har ~10 daqiqada) adminlarga joriy holatni
// CHIROYLI matn (iconlar bilan) + oxirgi skrinshot + ketgan vaqt bilan yuboradi.
// Slot OCHILGANDA notifySlotOpen alohida shoshilinch xabar beradi — bu esa
// odatdagi "bo'sh slot yo'q" holatini har sikl ko'rsatib turadi.
async function notifySlotCheck(
  slot: SlotView,
  cal: CalendarDetectResult,
): Promise<void> {
  const enabled =
    (process.env.SLOT_NOTIFY_TELEGRAM || "true").trim().toLowerCase() !==
    "false";
  if (!enabled || !isTelegramConfigured()) return;

  const dir = slot.direction;
  // Yopiq holatning aniq turini cal.note bo'yicha aniqlaymiz (3 xil holat):
  //  1) bo'sh slot yo'q (VFS xabari)  2) ochilgan, bo'sh slot tugagan
  //  3) tekshiruv bajarilmadi / holat aniqlanmadi (sahifa yuklanmadi).
  const note = (cal.note || "").toLowerCase();
  let statusLine: string;
  if (!cal.loggedIn) {
    statusLine = "🔒 <b>Login bo'lmadi</b>";
  } else if (note.includes("500") || note.includes("server xatosi")) {
    statusLine = "🛑 <b>VFS server xatosi (500) — qayta urinish</b>";
  } else if (note.includes("qolmadi") || note.includes("tugagan")) {
    statusLine = "🟡 <b>Slot qolmadi — bo'sh slotlar band qilingan</b>";
  } else if (note.includes("aniqlanmadi") || note.includes("yuklanmadi")) {
    statusLine = "⚠️ <b>Tekshiruv bajarilmadi (sahifa yuklanmadi)</b>";
  } else {
    statusLine = "⛔ <b>Slot ochiq emas</b>";
  }
  const caption =
    `🔎 <b>SLOT TEKSHIRUVI</b>\n` +
    `🧭 ${dir.label}\n` +
    `📋 <b>${escapeHtml(slot.name)}</b>\n` +
    (slot.category ? `🏷 ${escapeHtml(slot.category)}\n` : "") +
    (slot.subCategory ? `↳ ${escapeHtml(slot.subCategory)}\n` : "") +
    `➖➖➖➖➖➖➖➖➖➖\n` +
    `${statusLine}\n` +
    `🔑 Login: <b>${cal.loggedIn ? "bor ✓" : "yo'q ✗"}</b>\n` +
    (cal.note ? `📝 ${escapeHtml(cal.note)}\n` : "") +
    `⏱ Davomiyligi: <b>${fmtDuration(cal.durationMs)}</b>\n` +
    `🕐 Vaqt: ${nowTimeStr()}` +
    (cal.exitIp ? `\n🌐 IP: ${escapeHtml(cal.exitIp)}` : "");

  await broadcastSlotPhoto(caption, cal.screenshotPath, `slot-${slot.id}.png`);
}

// Barcha adminlarga skrinshot (bo'lsa) bilan, aks holda oddiy matn yuboradi.
// Bitta adminga yuborilmasa ham qolganlariga davom etadi (throw qilmaydi).
async function broadcastSlotPhoto(
  caption: string,
  screenshotPath: string | null,
  filename: string,
): Promise<void> {
  const chatIds = getAdminChatIds();
  if (!chatIds.length) return;

  let shot: Buffer | null = null;
  if (screenshotPath) {
    try {
      shot = await fs.promises.readFile(screenshotPath);
    } catch {
      shot = null;
    }
  }

  for (const chatId of chatIds) {
    try {
      if (shot) {
        await sendPhoto(chatId, { buffer: shot, filename, caption });
      } else {
        await sendMessage(chatId, caption);
      }
    } catch {
      // Bitta adminga yuborilmasa ham qolganlariga davom etamiz.
    }
  }
}

// Davomiylikni chiroyli ko'rsatadi: <60s => "12.3s", aks holda "2m 5s".
function fmtDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

// Joriy vaqt HH:MM:SS (24 soat).
function nowTimeStr(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
