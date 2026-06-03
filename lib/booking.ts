// Booking (zakas) bilan bog'liq umumiy logika.
// API route'lar ham, Telegram bot ham shu funksiyalarni chaqiradi.
// Shu sabab Next.js'ga bog'liq narsalar (NextResponse) bu yerda yo'q.

import { promises as fs } from "fs";
import path from "path";
import { prisma } from "./prisma";
import { ApplicantStatus, GroupStatus } from "@prisma/client";
import {
  runBooking,
  checkSlotOpen,
  type AutomationApplicant,
} from "./automation";
import { buildApplicantPdf } from "./pdf";
import {
  parseApplicantsFromBuffer,
  isComplete,
  missingFieldLabels,
  type ParsedApplicant,
} from "./excel";
import { buildEmail } from "./email";
import {
  dispatchGroupDocuments,
  isTelegramConfigured,
  type TelegramDocument,
} from "./telegram";

// Yuklangan Excel/CSV fayllar saqlanadigan papka (loyiha ildizida).
const IMPORTS_DIR = path.join(process.cwd(), "uploads", "imports");

// Yuklangan faylni diskka saqlaydi va nisbiy yo'lini qaytaradi.
// Nom: <groupId>-<vaqt>-<asl-nom>. Yozish muvaffaqiyatsiz bo'lsa relPath = null.
async function saveImportFile(
  groupId: number,
  buf: Buffer,
  fileName?: string,
): Promise<{ relPath: string | null }> {
  try {
    await fs.mkdir(IMPORTS_DIR, { recursive: true });
    const safe = (fileName || "fayl.xlsx")
      .replace(/[^\w.\-]+/g, "_")
      .slice(-80);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const diskName = `${groupId}-${stamp}-${safe}`;
    await fs.writeFile(path.join(IMPORTS_DIR, diskName), buf);
    return { relPath: `uploads/imports/${diskName}` };
  } catch {
    // Fayl saqlanmasa ham import davom etadi (DB yozuvi muhimroq).
    return { relPath: null };
  }
}

// Manba (kim/qayerdan) — tarix yozuvlari uchun umumiy meta.
export type ActionMeta = {
  source?: "web" | "bot" | "system";
  userId?: string | null;
  username?: string | null;
  note?: string | null;
};

// Guruh statusini o'zgartiradi va o'zgarishni GroupStatusLog'ga yozadi.
// Hech qaysi status o'zgarishi yo'qolmaydi.
async function changeGroupStatus(
  groupId: number,
  toStatus: GroupStatus,
  extra: Record<string, unknown>,
  meta: ActionMeta = {},
) {
  const current = await prisma.group.findUnique({
    where: { id: groupId },
    select: { status: true },
  });
  const updated = await prisma.group.update({
    where: { id: groupId },
    data: { status: toStatus, ...extra },
  });
  await prisma.groupStatusLog.create({
    data: {
      groupId,
      fromStatus: current?.status ?? null,
      toStatus,
      source: meta.source ?? "web",
      note: meta.note ?? null,
      userId: meta.userId ?? null,
      username: meta.username ?? null,
    },
  });
  return updated;
}

export type Stage = "register" | "order";

export function toAutomationInput(a: {
  surname: string;
  name: string;
  passportNumber: string;
  nationality: string | null;
  gender: string | null;
  birthdate: string | null;
  passportValidity: string | null;
  phone: string | null;
  email: string | null;
  generatedEmail: string | null;
}): AutomationApplicant {
  return {
    surname: a.surname,
    name: a.name,
    passportNumber: a.passportNumber,
    nationality: a.nationality,
    gender: a.gender,
    birthdate: a.birthdate,
    passportValidity: a.passportValidity,
    phone: a.phone,
    email: a.email,
    generatedEmail: a.generatedEmail,
  };
}

function nextStatusFor(stage: Stage): ApplicantStatus {
  return stage === "order"
    ? ApplicantStatus.ORDERED
    : ApplicantStatus.REGISTERED;
}

// Bitta arizachini bitta bosqichdan o'tkazadi.
export async function bookApplicant(applicantId: number, stage: Stage) {
  const applicant = await prisma.applicant.findUnique({
    where: { id: applicantId },
  });
  if (!applicant) return null;

  const result = await runBooking(stage, toAutomationInput(applicant));
  const updated = await prisma.applicant.update({
    where: { id: applicantId },
    data: {
      status: result.ok ? nextStatusFor(stage) : ApplicantStatus.FAILED,
      appointmentRef: result.ref ?? applicant.appointmentRef,
      resultNote: result.note,
    },
  });
  return { result, applicant: updated };
}

export type GroupBookingResult = {
  stage: Stage;
  attempt: number;
  processed: number;
  succeeded: number;
  failedCount: number;
  slotBlocked?: string; // "order" bo'lib, saytda slot ochiq bo'lmasa — sabab
  failed: { id: number; name: string; passportNumber: string; note: string }[];
  results: {
    id: number;
    name: string;
    passportNumber: string;
    ok: boolean;
    note: string;
  }[];
};

// Butun guruhni bitta bosqichdan o'tkazadi va RunAttempt yozuvini yaratadi.
// `source` — "web" yoki "bot".
export async function bookGroup(
  groupId: number,
  stage: Stage,
  source: "web" | "bot" = "web",
): Promise<GroupBookingResult | null> {
  const group = await prisma.group.findUnique({ where: { id: groupId } });
  if (!group) return null;

  // "order" (buyurtma / run-2) — avval saytda slot ochiqligini Playwright
  // bilan tekshiramiz. Ochiq bo'lmasa, hech qanday buyurtma yuborilmaydi.
  if (stage === "order") {
    const slot = await checkSlotOpen();
    if (!slot.open) {
      await prisma.runAttempt.create({
        data: {
          groupId,
          attempt:
            (await prisma.runAttempt.count({ where: { groupId, stage } })) + 1,
          stage,
          total: 0,
          succeeded: 0,
          failed: 0,
          source,
          note: `Slot ochiq emas: ${slot.note}`,
        },
      });
      return {
        stage,
        attempt: await prisma.runAttempt.count({ where: { groupId, stage } }),
        processed: 0,
        succeeded: 0,
        failedCount: 0,
        slotBlocked: slot.note,
        failed: [],
        results: [],
      };
    }
  }

  const applicants = await prisma.applicant.findMany({
    where: { groupId, status: { notIn: [ApplicantStatus.ARCHIVED] } },
  });

  const results: GroupBookingResult["results"] = [];
  for (const a of applicants) {
    const result = await runBooking(stage, toAutomationInput(a));
    await prisma.applicant.update({
      where: { id: a.id },
      data: {
        status: result.ok ? nextStatusFor(stage) : ApplicantStatus.FAILED,
        appointmentRef: result.ref ?? a.appointmentRef,
        resultNote: result.note,
      },
    });
    results.push({
      id: a.id,
      name: `${a.surname} ${a.name}`,
      passportNumber: a.passportNumber,
      ok: result.ok,
      note: result.note,
    });
  }

  const failed = results.filter((r) => !r.ok);
  const succeeded = results.length - failed.length;

  // Shu guruh + bosqich bo'yicha urinish tartib raqami (run-1, run-2...).
  const prior = await prisma.runAttempt.count({
    where: { groupId, stage },
  });
  const attempt = prior + 1;

  await prisma.runAttempt.create({
    data: {
      groupId,
      attempt,
      stage,
      total: results.length,
      succeeded,
      failed: failed.length,
      source,
      note: failed.length
        ? `Xato: ${failed
            .map((f) => f.name)
            .slice(0, 10)
            .join(", ")}`
        : "Barchasi muvaffaqiyatli",
    },
  });

  await changeGroupStatus(
    groupId,
    GroupStatus.BOOKING,
    {},
    {
      source,
      note: `${stage === "order" ? "Buyurtma" : "Ro'yxat"} (${attempt}-urinish): ${succeeded}/${results.length} muvaffaqiyatli`,
    },
  );

  return {
    stage,
    attempt,
    processed: results.length,
    succeeded,
    failedCount: failed.length,
    failed: failed.map((f) => ({
      id: f.id,
      name: f.name,
      passportNumber: f.passportNumber,
      note: f.note,
    })),
    results,
  };
}

// ---- Slot (vaqt oynasi) boshqaruvi ----

export async function openSlot(
  groupId: number,
  closeAt?: Date | null,
  meta: ActionMeta = {},
) {
  return changeGroupStatus(
    groupId,
    GroupStatus.SLOT_OPEN,
    { slotOpenAt: new Date(), slotCloseAt: closeAt ?? null },
    {
      ...meta,
      note:
        meta.note ??
        (closeAt
          ? `Slot ochildi, yopilish: ${closeAt.toISOString()}`
          : "Slot ochildi"),
    },
  );
}

export async function closeSlot(groupId: number, meta: ActionMeta = {}) {
  return changeGroupStatus(
    groupId,
    GroupStatus.SLOT_CLOSED,
    { slotCloseAt: new Date() },
    { ...meta, note: meta.note ?? "Slot yopildi" },
  );
}

// ---- Excel/CSV import (web + bot uchun umumiy) ----

export type ImportResult = {
  imported: number;
  complete: number;
  reused: number; // bazada (boshqa guruhda) mavjud shaxslar
  skipped: number; // shu guruhda passport allaqachon bor — tashlandi
};

// Excel/CSV buffer'dan arizachilarni guruhga qo'shadi.
// Passport bo'yicha Person mavjud bo'lsa ulanadi, bo'lmasa yaratiladi.
// Shu guruhda allaqachon bor passportlar takror qo'shilmaydi.
// `meta` — import tarixini (ImportLog) yozish uchun manba ma'lumotlari.
export async function importApplicantsToGroup(
  groupId: number,
  buf: Buffer,
  meta: {
    fileName?: string;
    source?: "web" | "bot";
    userId?: string | null;
    username?: string | null;
  } = {},
): Promise<ImportResult | null> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { applicants: { select: { passportNumber: true } } },
  });
  if (!group) return null;

  // Yuklangan faylni diskda saqlaymiz (hech narsa yo'qolmasin).
  const saved = await saveImportFile(groupId, buf, meta.fileName);

  const parsed: ParsedApplicant[] = parseApplicantsFromBuffer(buf);
  if (parsed.length === 0) {
    await prisma.importLog.create({
      data: {
        groupId,
        fileName: meta.fileName ?? null,
        filePath: saved.relPath,
        fileSize: buf.byteLength,
        total: 0,
        imported: 0,
        complete: 0,
        reused: 0,
        skipped: 0,
        source: meta.source ?? "web",
        userId: meta.userId ?? null,
        username: meta.username ?? null,
      },
    });
    return { imported: 0, complete: 0, reused: 0, skipped: 0 };
  }

  const existingInGroup = new Set(
    group.applicants.map((a) => a.passportNumber),
  );
  const toCreate = parsed.filter(
    (a) => a.passportNumber && !existingInGroup.has(a.passportNumber),
  );
  const skipped = parsed.length - toCreate.length;

  const passports = toCreate.map((a) => a.passportNumber);
  const existingPersons = await prisma.person.findMany({
    where: { passportNumber: { in: passports } },
    select: { passportNumber: true },
  });
  const existingByPassport = new Set(
    existingPersons.map((p) => p.passportNumber),
  );

  for (const a of toCreate) {
    const created = await prisma.applicant.create({
      data: {
        group: { connect: { id: groupId } },
        surname: a.surname,
        name: a.name,
        passportNumber: a.passportNumber,
        nationality: a.nationality,
        gender: a.gender,
        birthdate: a.birthdate,
        passportValidity: a.passportValidity,
        phone: a.phone,
        email: a.email,
        source: a.source,
        subcategory: a.subcategory,
        city: a.city,
        category: a.category,
        price: a.price,
        bookDateFrom: a.bookDateFrom,
        bookDateTo: a.bookDateTo,
        regDaysBefore: a.regDaysBefore,
        groupLabel: a.groupLabel,
        complete: isComplete(a),
        person: {
          connectOrCreate: {
            where: { passportNumber: a.passportNumber },
            create: {
              passportNumber: a.passportNumber,
              surname: a.surname,
              name: a.name,
              nationality: a.nationality,
              gender: a.gender,
              birthdate: a.birthdate,
              passportValidity: a.passportValidity,
              phone: a.phone,
            },
          },
        },
      },
    });
    await prisma.applicant.update({
      where: { id: created.id },
      data: { generatedEmail: buildEmail(a.name, a.surname, created.id) },
    });
  }

  const result: ImportResult = {
    imported: toCreate.length,
    complete: toCreate.filter((a) => isComplete(a)).length,
    reused: toCreate.filter((a) => existingByPassport.has(a.passportNumber))
      .length,
    skipped,
  };

  await prisma.importLog.create({
    data: {
      groupId,
      fileName: meta.fileName ?? null,
      filePath: saved.relPath,
      fileSize: buf.byteLength,
      total: parsed.length,
      imported: result.imported,
      complete: result.complete,
      reused: result.reused,
      skipped: result.skipped,
      source: meta.source ?? "web",
      userId: meta.userId ?? null,
      username: meta.username ?? null,
    },
  });

  return result;
}

export type ImportPreview = {
  groupId: number;
  groupName: string;
  total: number; // fayldagi yaroqli qatorlar
  complete: number; // to'liq ma'lumotli
  willAdd: number; // qo'shiladigan (guruhda yo'q)
  skipped: number; // guruhda allaqachon bor
  names: string[]; // dastlabki bir nechta ism (ko'rsatish uchun)
  incomplete: { name: string; passportNumber: string; missing: string[] }[]; // chala qatorlar
};

// Faylni import qilMASDAN, faqat oldindan ko'rish (preview) ma'lumotini qaytaradi.
// Tasdiqlash bosqichida foydalanuvchiga nima qo'shilishini ko'rsatish uchun.
export async function previewApplicantsFile(
  groupId: number,
  buf: Buffer,
): Promise<ImportPreview | null> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { applicants: { select: { passportNumber: true } } },
  });
  if (!group) return null;

  const parsed: ParsedApplicant[] = parseApplicantsFromBuffer(buf);
  const existingInGroup = new Set(
    group.applicants.map((a) => a.passportNumber),
  );
  const toAdd = parsed.filter(
    (a) => a.passportNumber && !existingInGroup.has(a.passportNumber),
  );

  // Chala (majburiy maydonlari yetishmaydigan) qatorlarni aniqlaymiz.
  const incomplete = toAdd
    .filter((a) => !isComplete(a))
    .map((a) => ({
      name: `${a.surname} ${a.name}`.trim(),
      passportNumber: a.passportNumber,
      missing: missingFieldLabels(a),
    }));

  return {
    groupId,
    groupName: group.name,
    total: parsed.length,
    complete: parsed.filter((a) => isComplete(a)).length,
    willAdd: toAdd.length,
    skipped: parsed.length - toAdd.length,
    names: toAdd
      .slice(0, 8)
      .map((a) => `${a.surname} ${a.name}`.trim())
      .filter(Boolean),
    incomplete,
  };
}

// Oxirgi guruhlarni (inline tugmalar uchun) qaytaradi.
export async function getRecentGroups(
  take = 8,
): Promise<{ id: number; name: string; count: number }[]> {
  const groups = await prisma.group.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { applicants: true } } },
    take,
  });
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    count: g._count.applicants,
  }));
}

// ---- Arizachi (user/mijoz) qidirish va passport ----

export type ApplicantInfo = {
  id: number;
  groupId: number;
  groupName: string;
  surname: string;
  name: string;
  passportNumber: string;
  nationality: string | null;
  gender: string | null;
  birthdate: string | null;
  passportValidity: string | null;
  phone: string | null;
  generatedEmail: string | null;
  status: string;
  complete: boolean;
  hasPhoto: boolean;
};

// Arizachini id bo'yicha topadi (bot/web qidiruvi uchun).
export async function getApplicantById(
  id: number,
): Promise<ApplicantInfo | null> {
  const a = await prisma.applicant.findUnique({
    where: { id },
    include: {
      group: { select: { name: true } },
      person: { select: { photo: true } },
    },
  });
  if (!a) return null;
  return {
    id: a.id,
    groupId: a.groupId,
    groupName: a.group.name,
    surname: a.surname,
    name: a.name,
    passportNumber: a.passportNumber,
    nationality: a.nationality,
    gender: a.gender,
    birthdate: a.birthdate,
    passportValidity: a.passportValidity,
    phone: a.phone,
    generatedEmail: a.generatedEmail,
    status: a.status,
    complete: a.complete,
    hasPhoto: Boolean(a.person?.photo),
  };
}

// Arizachining passport raqami bo'yicha qidiradi (bir nechta natija bo'lishi mumkin).
export async function findApplicantsByPassport(
  passport: string,
): Promise<ApplicantInfo[]> {
  const list = await prisma.applicant.findMany({
    where: { passportNumber: { contains: passport } },
    include: {
      group: { select: { name: true } },
      person: { select: { photo: true } },
    },
    take: 10,
  });
  return list.map((a) => ({
    id: a.id,
    groupId: a.groupId,
    groupName: a.group.name,
    surname: a.surname,
    name: a.name,
    passportNumber: a.passportNumber,
    nationality: a.nationality,
    gender: a.gender,
    birthdate: a.birthdate,
    passportValidity: a.passportValidity,
    phone: a.phone,
    generatedEmail: a.generatedEmail,
    status: a.status,
    complete: a.complete,
    hasPhoto: Boolean(a.person?.photo),
  }));
}

// Arizachiga bog'langan shaxsga passport rasmini saqlaydi.
// Shaxs bo'lmasa, passport raqami bo'yicha ulaydi/yaratadi.
export async function savePassportPhotoForApplicant(
  applicantId: number,
  buf: Buffer,
  mime = "image/jpeg",
): Promise<{ personId: number } | null> {
  const applicant = await prisma.applicant.findUnique({
    where: { id: applicantId },
    select: { id: true, personId: true, passportNumber: true },
  });
  if (!applicant) return null;

  let personId = applicant.personId;
  if (!personId) {
    const person = await prisma.person.upsert({
      where: { passportNumber: applicant.passportNumber },
      update: {},
      create: {
        passportNumber: applicant.passportNumber,
        surname: "",
        name: "",
      },
    });
    personId = person.id;
    await prisma.applicant.update({
      where: { id: applicantId },
      data: { personId },
    });
  }

  await prisma.person.update({
    where: { id: personId },
    data: { photo: buf, photoMime: mime },
  });
  return { personId };
}

// ---- Statistika ----

export type GroupStats = {
  id: number;
  name: string;
  status: string;
  total: number;
  complete: number;
  registered: number;
  ordered: number; // ORDERED + BOOKED (PDF gacha yetgan)
  failed: number;
  attempts: number; // jami run soni
  registerRuns: number;
  orderRuns: number;
  slotOpenAt: Date | null;
  slotCloseAt: Date | null;
};

export async function getGroupStats(
  groupId: number,
): Promise<GroupStats | null> {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { applicants: true, runs: true },
  });
  if (!group) return null;

  const total = group.applicants.length;
  const complete = group.applicants.filter((a) => a.complete).length;
  const registered = group.applicants.filter(
    (a) => a.status === "REGISTERED",
  ).length;
  const ordered = group.applicants.filter(
    (a) => a.status === "ORDERED" || a.status === "BOOKED",
  ).length;
  const failed = group.applicants.filter((a) => a.status === "FAILED").length;

  return {
    id: group.id,
    name: group.name,
    status: group.status,
    total,
    complete,
    registered,
    ordered,
    failed,
    attempts: group.runs.length,
    registerRuns: group.runs.filter((r) => r.stage === "register").length,
    orderRuns: group.runs.filter((r) => r.stage === "order").length,
    slotOpenAt: group.slotOpenAt,
    slotCloseAt: group.slotCloseAt,
  };
}

// ---- Guruh PDF'larini Telegram'ga yuborish ----
// PDF gacha yetgan (ORDERED/BOOKED) arizachilar uchun PDF yaratib,
// info xabar bilan birga adminlarga ketma-ket (bittada qator) yuboradi.
export async function sendGroupPdfsToTelegram(groupId: number) {
  if (!isTelegramConfigured()) {
    throw new Error(
      "Telegram sozlanmagan (.env: TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_IDS)",
    );
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      applicants: {
        where: {
          status: { in: [ApplicantStatus.ORDERED, ApplicantStatus.BOOKED] },
        },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!group) return null;

  const documents: TelegramDocument[] = [];
  for (const a of group.applicants) {
    const bytes = await buildApplicantPdf({
      ...a,
      group: { name: group.name },
    });
    documents.push({
      buffer: bytes,
      filename: `appointment-${a.id}.pdf`,
      caption: `${a.surname} ${a.name} · ${a.passportNumber}`,
    });
  }

  const infoMessage =
    `<b>${group.name}</b>\n` +
    `PDF tayyor: ${documents.length} ta arizachi\n` +
    `Status: ${group.status}`;

  const dispatch = await dispatchGroupDocuments({ infoMessage, documents });
  return { count: documents.length, dispatch };
}
