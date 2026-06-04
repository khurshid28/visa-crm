// Telegram bot — komanda handlerlari (faqat backend, long polling).
// Faqat TELEGRAM_ADMIN_CHAT_IDS dagi chat'lar komandalarni ishlatadi.
//
// Komandalar:
//   /start, /help              — yordam
//   /groups                    — barcha guruhlar ro'yxati (son/status)
//   /group <id>                — guruh tafsiloti (urinishlar, PDF gacha yetgan)
//   /newgroup <nom>            — yangi (bo'sh) guruh yaratish
//   /register <id>             — guruhni ro'yxatdan o'tkazish (1-bosqich)
//   /order <id>               — buyurtma berish (2-bosqich, slot tekshiriladi)
//   /slot <id> open [vaqt]     — slot ochish (vaqt: "YYYY-MM-DD HH:MM" yoki daqiqa)
//   /slot <id> close           — slot yopish
//   /slotcheck                 — saytda slot ochiqligini tekshirish
//   /send <id>                 — guruh PDF'larini adminlarga yuborish

import { prisma } from "./prisma";
import {
  getUpdates,
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  setMyCommands,
  setMyDescription,
  setMyShortDescription,
  getMe,
  getAdminChatIds,
  getBotToken,
  downloadFile,
  type TgInlineKeyboard,
} from "./telegram";
import {
  getGroupStats,
  getRecentGroups,
  getApplicantById,
  findApplicantsByPassport,
  savePassportPhotoForApplicant,
  openSlot,
  closeSlot,
  sendGroupPdfsToTelegram,
  importApplicantsToGroup,
  previewApplicantsFile,
  type Stage,
  type ApplicantInfo,
} from "./booking";
import { checkSlotOpen } from "./automation";
import { enqueueGroupOrder, enqueueGroupRegister } from "./order-queue";
import {
  getSlotMonitorState,
  getSlotQueueStats,
  runSlotMonitorTick,
  setSlotMonitorState,
} from "./slot-monitor";
import { readMrzFromImage } from "./passport-ocr";
import { GROUP_STATUS, APPLICANT_STATUS } from "./status";

const COMMANDS = [
  { command: "start", description: "Botni ishga tushirish / menyu" },
  { command: "groups", description: "Barcha guruhlar ro'yxati" },
  { command: "group", description: "Guruh tafsiloti: /group <id>" },
  { command: "newgroup", description: "Yangi guruh: /newgroup <nom>" },
  {
    command: "user",
    description: "Arizachini topish: /user <id>",
  },
  {
    command: "find",
    description: "Passport bo'yicha qidirish: /find <passport>",
  },
  {
    command: "register",
    description: "1-bosqich: ro'yxatdan o'tkazish /register <id>",
  },
  { command: "order", description: "2-bosqich: buyurtma berish /order <id>" },
  { command: "slot", description: "Slot: /slot <id> open|close" },
  { command: "slotcheck", description: "Saytda slot ochiqligini tekshirish" },
  { command: "go", description: "Global monitoringni davom ettirish" },
  { command: "pause", description: "Global monitoringni pauza qilish" },
  {
    command: "monitor",
    description: "Global slot monitoring: /monitor <YYYY-MM-DD HH:MM>",
  },
  { command: "send", description: "PDF yuborish: /send <id>" },
  { command: "help", description: "Yordam" },
];

// BotFather profili — bot ishga tushganda avtomatik o'rnatiladi.
const BOT_SHORT_DESCRIPTION =
  "Visa CRM — guruhlarni ro'yxatdan o'tkazish, buyurtma berish, slot va PDF boshqaruvi.";

const BOT_DESCRIPTION =
  "🛂 Visa CRM — viza arizalarini boshqaruv boti.\n\n" +
  "Bu bot orqali siz:\n" +
  "• 📋 Guruhlar va arizachilar holatini ko'rasiz\n" +
  "• 📎 Excel/CSV fayl yuborib arizachilarni qo'shasiz\n" +
  "• 📝 Guruhni ro'yxatdan o'tkazasiz (1-bosqich)\n" +
  "• ✅ Slot ochilganda buyurtma berasiz (2-bosqich)\n" +
  "• 🕒 Slot vaqtini belgilaysiz va saytda tekshirasiz\n" +
  "• 📄 Tayyor PDF'larni qabul qilasiz\n\n" +
  "Boshlash uchun /help yuboring. Bot faqat ruxsat berilgan adminlar bilan ishlaydi.";

function isAdmin(chatId: number): boolean {
  return getAdminChatIds().includes(String(chatId));
}

function statusLabel(map: Record<string, { label: string }>, key: string) {
  return map[key]?.label ?? key;
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("ru-RU", { hour12: false });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Arizachi (mijoz) ma'lumotlarini chiroyli matnga aylantiradi.
function formatApplicant(a: ApplicantInfo): string {
  return (
    `👤 <b>${esc(a.surname)} ${esc(a.name)}</b> (#${a.id})\n` +
    `Guruh: ${esc(a.groupName)} (#${a.groupId})\n` +
    `Passport: <code>${esc(a.passportNumber)}</code>\n` +
    `Fuqarolik: ${esc(a.nationality || "—")} · Jins: ${esc(a.gender || "—")}\n` +
    `Tug'ilgan: ${esc(a.birthdate || "—")} · Amal: ${esc(a.passportValidity || "—")}\n` +
    `Tel: ${esc(a.phone || "—")}\n` +
    `Email: ${esc(a.generatedEmail || "—")}\n` +
    `Status: ${statusLabel(APPLICANT_STATUS, a.status)} · ` +
    `To'liq: ${a.complete ? "✅" : "❌"} · ` +
    `Rasm: ${a.hasPhoto ? "✅" : "❌"}`
  );
}

// Slot yopilish vaqtini ajratadi.
//   "2026-06-10 14:30"  → aniq sana/vaqt
//   "30"                → hozirdan 30 daqiqa keyin
// Qaytaradi: { closeAt | null, error | null }
function parseSlotCloseAt(args: string[]): {
  closeAt: Date | null;
  error: string | null;
} {
  const raw = args.join(" ").trim();
  if (!raw) return { closeAt: null, error: null };

  // Faqat son bo'lsa — daqiqa sifatida qabul qilamiz.
  if (/^\d+$/.test(raw)) {
    const mins = Number(raw);
    return { closeAt: new Date(Date.now() + mins * 60_000), error: null };
  }

  // "YYYY-MM-DD HH:MM" ko'rinishi.
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) {
    return {
      closeAt: null,
      error:
        "Vaqt formati noto'g'ri. Namuna: <code>2026-06-10 14:30</code> " +
        "(yil-oy-kun soat:daqiqa) yoki shunchaki daqiqa: <code>30</code>.",
    };
  }
  const [, y, mo, d, h, mi] = m;
  const dt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    0,
    0,
  );
  if (Number.isNaN(dt.getTime())) {
    return { closeAt: null, error: "Sana/vaqt noto'g'ri." };
  }
  if (dt.getTime() <= Date.now()) {
    return {
      closeAt: null,
      error: "Slot vaqti o'tib ketgan — kelajakdagi vaqtni kiriting.",
    };
  }
  return { closeAt: dt, error: null };
}

const HELP =
  "<b>🛂 Visa CRM bot</b>\n" +
  "Viza arizalarini boshqaruv boti. Quyidagi bosqichlar bo'yicha ishlang:\n\n" +
  "<b>1️⃣ Guruh yaratish</b>\n" +
  "/newgroup <code>nom</code> — yangi guruh ochish\n\n" +
  "<b>2️⃣ Arizachilarni qo'shish</b>\n" +
  "Excel/CSV faylni shu chatga yuboring, izoh (caption) sifatida guruh id'sini yozing.\n\n" +
  "<b>3️⃣ Ro'yxatdan o'tkazish</b>\n" +
  "/register <code>id</code> — 1-bosqich (arizachilarni saytda ro'yxatdan o'tkazadi)\n\n" +
  "<b>4️⃣ Slot belgilash</b>\n" +
  "/slot <code>id</code> open <code>2026-06-10 14:30</code> — aniq vaqtga ochish\n" +
  "/slot <code>id</code> open <code>30</code> — 30 daqiqaga ochish\n" +
  "/slot <code>id</code> close — yopish\n" +
  "/slotcheck — saytda slot ochiqligini tekshirish\n\n" +
  "<b>5️⃣ Buyurtma berish</b>\n" +
  "/order <code>id</code> — 2-bosqich (avval saytda slot ochiqligini tekshiradi)\n\n" +
  "<b>🕒 Global monitoring</b>\n" +
  "/monitor <code>2026-06-10 14:30</code> — slot vaqtidan -10/+10 daq oynada har 10 soniyada tekshiradi\n" +
  "/pause — monitoringni to'xtatib turadi (slot ochilsa ham buyurtma yubormaydi)\n" +
  "/go — pause'dan chiqarib davom ettiradi\n\n" +
  "<b>6️⃣ PDF olish</b>\n" +
  "/send <code>id</code> — guruh PDF'larini yuborish\n\n" +
  "<b>👤 Arizachi (mijoz):</b>\n" +
  "/user <code>id</code> — arizachi ma'lumotlarini ko'rish\n" +
  "/find <code>passport</code> — passport bo'yicha qidirish\n" +
  "📷 Passport rasmini yuboring, izoh (caption) sifatida arizachi id'sini yozing — " +
  "rasm saqlanadi va MRZ tekshiriladi.\n\n" +
  "<b>Boshqa:</b> /groups — ro'yxat · /group <code>id</code> — tafsilot";

// Bitta matnli komandani qayta ishlaydi va javob matnini qaytaradi.
async function handleCommand(text: string): Promise<string> {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0].replace(/^\//, "").replace(/@.*$/, "").toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case "start":
    case "help":
      return HELP;

    case "groups": {
      const groups = await prisma.group.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { applicants: true } } },
        take: 30,
      });
      if (!groups.length) return "Guruhlar yo'q.";
      const lines = groups.map(
        (g) =>
          `#${g.id} <b>${esc(g.name)}</b> — ${g._count.applicants} ta · ${statusLabel(GROUP_STATUS, g.status)}`,
      );
      return "<b>Guruhlar</b>\n" + lines.join("\n");
    }

    case "group": {
      const id = Number(args[0]);
      if (!id) return "Foydalanish: /group <id>";
      const s = await getGroupStats(id);
      if (!s) return "Guruh topilmadi.";
      return (
        `<b>${esc(s.name)}</b> (#${s.id})\n` +
        `Status: ${statusLabel(GROUP_STATUS, s.status)}\n` +
        `Jami: ${s.total} · To'liq: ${s.complete}\n` +
        `Ro'yxatdan o'tgan: ${s.registered}\n` +
        `PDF gacha yetgan: ${s.ordered}\n` +
        `Xato: ${s.failed}\n` +
        `Urinishlar: ${s.attempts} (ro'yxat: ${s.registerRuns}, buyurtma: ${s.orderRuns})\n` +
        `Slot: ${fmtDate(s.slotOpenAt)} → ${fmtDate(s.slotCloseAt)}`
      );
    }

    case "user": {
      const id = Number(args[0]);
      if (!id) return "Foydalanish: /user <id>";
      const a = await getApplicantById(id);
      if (!a) return `Arizachi #${id} topilmadi.`;
      return formatApplicant(a);
    }

    case "find": {
      const q = args.join("").trim().toUpperCase();
      if (!q) return "Foydalanish: /find <passport>";
      const list = await findApplicantsByPassport(q);
      if (!list.length) return `"${esc(q)}" bo'yicha arizachi topilmadi.`;
      if (list.length === 1) return formatApplicant(list[0]);
      return (
        `<b>${list.length} ta natija</b> — "${esc(q)}":\n` +
        list
          .map(
            (a) =>
              `#${a.id} ${esc(a.surname)} ${esc(a.name)} · ${esc(a.passportNumber)} · ${statusLabel(APPLICANT_STATUS, a.status)}`,
          )
          .join("\n") +
        `\n\nBatafsil: /user <id>`
      );
    }

    case "newgroup": {
      const name = args.join(" ").trim();
      if (!name) return "Foydalanish: /newgroup <nom>";
      const g = await prisma.group.create({ data: { name } });
      return (
        `✅ Guruh yaratildi: #${g.id} <b>${esc(g.name)}</b>\n\n` +
        `<b>Keyingi qadam — arizachilarni qo'shish:</b>\n` +
        `📎 Excel (.xlsx/.xls) yoki CSV faylni shu chatga yuboring.\n` +
        `Faylni yuborishda <b>izoh (caption)</b> maydoniga guruh raqamini yozing:\n\n` +
        `<code>${g.id}</code>\n\n` +
        `Men faylni qabul qilib, arizachilarni avtomatik qo'shaman. ⏳`
      );
    }

    case "run":
    case "register":
    case "order": {
      const id = Number(args[0]);
      if (!id)
        return `Foydalanish: /${cmd === "run" ? "register|order" : cmd} <id>`;
      let stage: Stage;
      if (cmd === "register") stage = "register";
      else if (cmd === "order") stage = "order";
      else stage = args[1] === "order" ? "order" : "register";

      if (stage === "order") {
        const slot = await checkSlotOpen();
        if (!slot.open) {
          return (
            `⛔ Buyurtma navbatga qo'shilmadi — saytda slot ochiq emas.\n` +
            `Sabab: ${esc(slot.note)}\n\n` +
            `Slot ochilishini kuting yoki /slotcheck bilan tekshiring.`
          );
        }

        const queued = await enqueueGroupOrder({
          groupId: id,
          source: "bot",
          reason: "bot-order",
        });
        if (!queued.queuedJobs) {
          return `ℹ️ Order navbatga qo'shilmadi (skip: ${queued.skippedJobs}). REGISTERED user yo'q yoki allaqachon navbatda.`;
        }
        return (
          `✅ Buyurtma navbatga qo'shildi (#${id})\n` +
          `Userlar: <b>${queued.queuedJobs}</b> ta (skip: ${queued.skippedJobs})\n` +
          `10 ta worker alohida Playwright profile'da parallel bajaradi.`
        );
      }

      // register — guruhdagi userlar navbatga, 10 worker parallel bajaradi.
      const queued = await enqueueGroupRegister({
        groupId: id,
        source: "bot",
        reason: "bot-register",
      });
      if (!queued.queuedJobs) {
        return `ℹ️ Register navbatga qo'shilmadi (skip: ${queued.skippedJobs}). Register kutayotgan user yo'q yoki allaqachon navbatda.`;
      }
      return (
        `✅ Ro'yxatdan o'tkazish navbatga qo'shildi (#${id})\n` +
        `Userlar: <b>${queued.queuedJobs}</b> ta (skip: ${queued.skippedJobs})\n` +
        `10 ta worker alohida Playwright profile'da parallel bajaradi.`
      );
    }

    case "slot": {
      const id = Number(args[0]);
      const action = (args[1] || "").toLowerCase();
      if (!id || !["open", "close"].includes(action))
        return (
          "Foydalanish:\n" +
          "/slot <code>id</code> open <code>2026-06-10 14:30</code> — aniq vaqtga\n" +
          "/slot <code>id</code> open <code>30</code> — 30 daqiqaga\n" +
          "/slot <code>id</code> close — yopish"
        );
      if (action === "open") {
        const { closeAt, error } = parseSlotCloseAt(args.slice(2));
        if (error) return error;
        const g = await openSlot(id, closeAt, { source: "bot" });
        return (
          `🟢 Slot ochildi: <b>${esc(g.name)}</b> (#${id})\n` +
          (closeAt
            ? `Yopilish vaqti: <b>${fmtDate(closeAt)}</b>\n\nEndi /order ${id} bilan buyurtma bering.`
            : `\nEndi /order ${id} bilan buyurtma bering.`)
        );
      }
      const g = await closeSlot(id, { source: "bot" });
      return `🔴 Slot yopildi: <b>${esc(g.name)}</b> (#${id})`;
    }

    case "slotcheck": {
      const slot = await checkSlotOpen();
      return (
        `Sayt slot holati: ${slot.open ? "🟢 OCHIQ" : "🔴 YOPIQ"}\n` +
        `${esc(slot.note)}`
      );
    }

    case "monitor": {
      const raw = args.join(" ").trim();
      if (!raw) {
        const [state, queue] = await Promise.all([
          getSlotMonitorState(),
          getSlotQueueStats(),
        ]);
        return (
          `<b>Global monitoring holati</b>\n` +
          `Faol: ${state.active ? "✅" : "❌"} · Pause: ${state.paused ? "✅" : "❌"}\n` +
          `Slot vaqti: ${state.slotAt ? esc(fmtDate(new Date(state.slotAt))) : "—"}\n` +
          `Navbat (REGISTERED): ${queue.registeredTotal} ta (${queue.registeredComplete} ta to'liq), guruhlar: ${queue.groups}\n` +
          `Oxirgi holat: ${esc(state.lastMessage)}`
        );
      }
      const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
      if (!m) {
        return (
          "Foydalanish: /monitor <code>YYYY-MM-DD HH:MM</code>\n" +
          "Masalan: /monitor <code>2026-06-10 14:30</code>"
        );
      }
      const [, y, mo, d, h, mi] = m;
      const slotAt = new Date(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h),
        Number(mi),
        0,
        0,
      );
      if (Number.isNaN(slotAt.getTime()) || slotAt.getTime() <= Date.now()) {
        return "Kelajakdagi to'g'ri vaqt kiriting.";
      }
      const state = await setSlotMonitorState({
        active: true,
        paused: false,
        slotAt: slotAt.toISOString(),
        lastCheckAt: null,
        lastMessage: "Monitoring ishga tushdi (har 10 soniya)",
      });
      return (
        `✅ Monitoring yoqildi. Slot vaqti: <b>${esc(fmtDate(slotAt))}</b>\n` +
        "Tizim -10/+10 daqiqa oynada har 10 soniyada slotni tekshiradi."
      );
    }

    case "pause": {
      const state = await setSlotMonitorState({
        paused: true,
        lastMessage: "PAUSE: slot monitoring vaqtincha to'xtadi",
      });
      return `⏸ Pause yoqildi. Oxirgi holat: ${esc(state.lastMessage)}`;
    }

    case "go": {
      const state = await setSlotMonitorState({
        paused: false,
        active: true,
        lastMessage: "GO: monitoring davom etadi",
      });
      return `▶️ GO. Monitoring davom etadi. Slot vaqti: ${state.slotAt ? esc(fmtDate(new Date(state.slotAt))) : "—"}`;
    }

    case "send": {
      const id = Number(args[0]);
      if (!id) return "Foydalanish: /send <id>";
      const out = await sendGroupPdfsToTelegram(id);
      if (!out) return "Guruh topilmadi.";
      if (out.count === 0) return "PDF gacha yetgan arizachi yo'q.";
      return `Yuborildi: ${out.dispatch.sent} hujjat${out.dispatch.failed.length ? `, xato: ${out.dispatch.failed.length}` : ""}`;
    }

    default:
      return "Noma'lum komanda. /help";
  }
}

// Telegram xabar turini aniqlaydi (tarix uchun).
function detectType(msg: import("./telegram").TgMessage): string {
  if (msg.document) return "document";
  if (msg.photo) return "photo";
  if (msg.text) return msg.text.startsWith("/") ? "command" : "text";
  if (msg.caption) return "caption";
  return "other";
}

// Har bir xabarni bazaga yozadi (kim, qachon, nima, type, success, response).
async function logMessage(params: {
  msg: import("./telegram").TgMessage;
  isAdmin: boolean;
  type: string;
  text: string | null;
  success: boolean;
  response: string | null;
}) {
  const { msg, isAdmin, type, text, success, response } = params;
  try {
    await prisma.botMessage.create({
      data: {
        chatId: String(msg.chat.id),
        userId: msg.from ? String(msg.from.id) : null,
        username: msg.from?.username ?? null,
        firstName: msg.from?.first_name ?? null,
        isAdmin,
        type,
        text,
        success,
        response: response ? response.slice(0, 4000) : null,
      },
    });
  } catch {
    // tarix yozuvi muvaffaqiyatsiz bo'lsa ham bot ishlashda davom etadi.
  }
}

// Excel/CSV hujjatini qabul qiladi. To'g'ridan-to'g'ri import qilmaydi:
// avval guruhni tanlatadi (yoki caption'dagi guruh), keyin preview + tasdiq.
//
// Kutilayotgan (hali tasdiqlanmagan) fayllar xotirada vaqtinchalik saqlanadi.
type PendingFile = {
  buf: Buffer;
  fileName: string;
  chatId: number;
  createdAt: number;
};
const pendingFiles = new Map<string, PendingFile>();
let pendingSeq = 0;

function newPendingToken(): string {
  pendingSeq = (pendingSeq + 1) % 100000;
  return `${Date.now().toString(36)}${pendingSeq.toString(36)}`;
}

// 30 daqiqadan eski kutilayotgan fayllarni tozalaydi.
function gcPendingFiles() {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [k, v] of pendingFiles) {
    if (v.createdAt < cutoff) pendingFiles.delete(k);
  }
}

// Preview (oldindan ko'rish) xabari + tasdiq tugmalarini tayyorlaydi.
async function buildPreviewMessage(
  token: string,
  groupId: number,
): Promise<{ text: string; keyboard: TgInlineKeyboard }> {
  const pending = pendingFiles.get(token);
  if (!pending) {
    return {
      text: "⏳ Bu fayl muddati o'tdi yoki topilmadi. Iltimos, faylni qayta yuboring.",
      keyboard: [],
    };
  }
  const pv = await previewApplicantsFile(groupId, pending.buf);
  if (!pv) {
    return { text: `❌ Guruh #${groupId} topilmadi.`, keyboard: [] };
  }
  if (pv.total === 0) {
    pendingFiles.delete(token);
    return {
      text:
        "⚠️ Faylda yaroqli qator topilmadi.\n" +
        "Har bir qatorda <b>familiya, ism va passport</b> bo'lishi kerak.",
      keyboard: [],
    };
  }
  if (pv.willAdd === 0) {
    return {
      text:
        `ℹ️ <b>${esc(pv.groupName)}</b> (#${pv.groupId}) guruhiga qo'shadigan yangi arizachi yo'q.\n` +
        `Fayldagi ${pv.total} ta arizachi allaqachon guruhda mavjud.`,
      keyboard: [[{ text: "❌ Yopish", callback_data: `no:${token}` }]],
    };
  }

  const namesPreview = pv.names.length
    ? "\n\n<b>Qo'shiladiganlar:</b>\n• " +
      pv.names.map((n) => esc(n)).join("\n• ") +
      (pv.willAdd > pv.names.length
        ? `\n…va yana ${pv.willAdd - pv.names.length} ta`
        : "")
    : "";

  // Chala (majburiy maydonlari yetishmaydigan) qatorlarni ogohlantirib ko'rsatamiz.
  let incompleteNote = "";
  if (pv.incomplete.length) {
    const shown = pv.incomplete.slice(0, 10);
    incompleteNote =
      `\n\n⚠️ <b>Chala ma'lumotli: ${pv.incomplete.length} ta</b>\n` +
      "Quyidagilarda majburiy maydonlar yo'q:\n" +
      shown
        .map(
          (r) =>
            `• ${esc(r.name || r.passportNumber)} — yo'q: ${esc(
              r.missing.join(", "),
            )}`,
        )
        .join("\n") +
      (pv.incomplete.length > shown.length
        ? `\n…va yana ${pv.incomplete.length - shown.length} ta`
        : "") +
      "\n<i>Bu arizachilar qo'shiladi, lekin booking uchun to'liq emas.</i>";
  }

  const text =
    `📋 <b>Tasdiqlang</b> — <b>${esc(pv.groupName)}</b> (#${pv.groupId})\n\n` +
    `📂 Fayl: ${esc(pending.fileName)}\n` +
    `➕ Qo'shiladi: <b>${pv.willAdd}</b> ta\n` +
    `✔️ To'liq ma'lumotli: ${pv.complete}\n` +
    (pv.skipped ? `⏭ Tashlanadi (guruhda bor): ${pv.skipped}\n` : "") +
    namesPreview +
    incompleteNote +
    `\n\nQo'shishni tasdiqlaysizmi?`;

  const keyboard: TgInlineKeyboard = [
    [
      { text: "✅ Tasdiqlash", callback_data: `ok:${token}:${groupId}` },
      { text: "❌ Bekor", callback_data: `no:${token}` },
    ],
  ];
  return { text, keyboard };
}

// Faylni qaysi guruhga qo'shishni so'raydi — oxirgi guruhlar tugma sifatida.
async function buildGroupPicker(
  token: string,
): Promise<{ text: string; keyboard: TgInlineKeyboard }> {
  const groups = await getRecentGroups(8);
  if (!groups.length) {
    return {
      text:
        "📎 Faylni qabul qildim, lekin hali birorta guruh yo'q.\n" +
        "Avval /newgroup <nom> bilan guruh yarating, so'ng faylni qayta yuboring.",
      keyboard: [],
    };
  }
  const keyboard: TgInlineKeyboard = groups.map((g) => [
    {
      text: `#${g.id} ${g.name} (${g.count})`,
      callback_data: `pg:${token}:${g.id}`,
    },
  ]);
  keyboard.push([{ text: "❌ Bekor", callback_data: `no:${token}` }]);
  return {
    text:
      "📎 Faylni qabul qildim. Qaysi guruhga qo'shay?\n" +
      "Quyidagidan tanlang yoki keyingi safar faylni yuborishda izoh (caption) " +
      "maydoniga guruh raqamini yozing.",
    keyboard,
  };
}

// Hujjat kelganda: faylni yuklab oladi, kutish ro'yxatiga qo'yadi va
// guruh tanlash yoki to'g'ridan-to'g'ri preview ko'rsatadi.
async function handleDocument(
  msg: import("./telegram").TgMessage,
): Promise<{ text: string; keyboard: TgInlineKeyboard }> {
  const doc = msg.document;
  if (!doc) return { text: "Hujjat topilmadi.", keyboard: [] };

  const fname = (doc.file_name || "").toLowerCase();
  if (!/\.(xlsx|xls|csv)$/.test(fname)) {
    return {
      text:
        "❌ Bu fayl turini qabul qila olmayman.\n" +
        "Faqat <b>Excel (.xlsx, .xls)</b> yoki <b>CSV</b> fayl yuboring.",
      keyboard: [],
    };
  }

  gcPendingFiles();
  const buf = await downloadFile(doc.file_id);
  const token = newPendingToken();
  pendingFiles.set(token, {
    buf,
    fileName: doc.file_name || "fayl",
    chatId: msg.chat.id,
    createdAt: Date.now(),
  });

  // caption'da guruh raqami bo'lsa — to'g'ridan-to'g'ri preview.
  const idMatch = (msg.caption || "").match(/(\d+)/);
  if (idMatch) {
    return buildPreviewMessage(token, Number(idMatch[1]));
  }
  return buildGroupPicker(token);
}

// Passport rasmi yuborilsa — saqlaymiz va MRZ'ni tekshiramiz.
// Izoh (caption) ichida arizachi id'si bo'lishi shart.
async function handlePhoto(
  msg: import("./telegram").TgMessage,
): Promise<string> {
  const photos = msg.photo || [];
  if (!photos.length) return "Rasm topilmadi.";

  const caption = (msg.caption || "").trim();
  const idMatch = caption.match(/(\d+)/);
  if (!idMatch) {
    return (
      "📷 Passport rasmini qabul qildim, lekin <b>arizachi id'si</b> ko'rsatilmagan.\n" +
      "Rasmni yuborishda izoh (caption) sifatida arizachi id'sini yozing.\n" +
      "Masalan: <code>123</code>"
    );
  }

  const applicantId = Number(idMatch[1]);
  const applicant = await getApplicantById(applicantId);
  if (!applicant) return `Arizachi #${applicantId} topilmadi.`;

  // Eng katta o'lchamdagi rasmni yuklab olamiz.
  const fileId = photos[photos.length - 1].file_id;
  const buf = await downloadFile(fileId);

  // Rasmni shaxsga saqlaymiz.
  const saved = await savePassportPhotoForApplicant(
    applicantId,
    buf,
    "image/jpeg",
  );
  const savedNote = saved ? "✅ Rasm saqlandi" : "⚠️ Rasm saqlanmadi";

  // MRZ'ni o'qiymiz.
  const mrz = await readMrzFromImage(buf);
  const head = `👤 <b>${esc(applicant.surname)} ${esc(applicant.name)}</b> (#${applicant.id})\n`;

  if (!mrz) {
    return (
      head +
      savedNote +
      "\n⚠️ MRZ o'qilmadi — rasm sifati past yoki passport sahifasi to'liq emas.\n" +
      "Iltimos, passportning pastki ikki qatori (MRZ) aniq ko'rinadigan rasm yuboring."
    );
  }

  const ocrPassport = (mrz.passportNumber || "").toUpperCase();
  const stored = (applicant.passportNumber || "").toUpperCase();
  const match = ocrPassport && stored && ocrPassport === stored;

  const checks =
    `Passport raqami: ${mrz.checks?.passportNumber ? "✅" : "❌"} · ` +
    `Tug'ilgan sana: ${mrz.checks?.birthdate ? "✅" : "❌"} · ` +
    `Amal muddati: ${mrz.checks?.expiry ? "✅" : "❌"}`;

  return (
    head +
    savedNote +
    "\n\n<b>MRZ tekshiruvi:</b>\n" +
    `O'qilgan passport: <code>${esc(ocrPassport || "—")}</code>\n` +
    `Bazadagi passport: <code>${esc(stored || "—")}</code>\n` +
    `Moslik: ${match ? "✅ Mos keldi" : "⚠️ Mos kelmadi"}\n` +
    `Nazorat raqamlari: ${checks}`
  );
}

// Inline tugma (callback) bosilganda ishlaydi.
async function handleCallback(cb: import("./telegram").TgCallbackQuery) {
  const data = cb.data || "";
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  const admin = chatId != null && isAdmin(chatId);

  // Admin bo'lmaganlarga javob yo'q.
  if (!admin || chatId == null || messageId == null) {
    await answerCallbackQuery(cb.id);
    return;
  }

  const [action, token, gidRaw] = data.split(":");
  let response = "";
  let success = true;

  try {
    if (action === "no") {
      pendingFiles.delete(token);
      response = "❌ Bekor qilindi.";
      await answerCallbackQuery(cb.id, "Bekor qilindi");
      await editMessageText(chatId, messageId, response);
    } else if (action === "pg") {
      await answerCallbackQuery(cb.id);
      const { text, keyboard } = await buildPreviewMessage(
        token,
        Number(gidRaw),
      );
      response = text;
      await editMessageText(chatId, messageId, text, {
        inlineKeyboard: keyboard,
      });
    } else if (action === "ok") {
      const pending = pendingFiles.get(token);
      if (!pending) {
        response = "⏳ Fayl muddati o'tdi. Iltimos, qayta yuboring.";
        await answerCallbackQuery(cb.id);
        await editMessageText(chatId, messageId, response);
      } else {
        await answerCallbackQuery(cb.id, "Qo'shilmoqda…");
        const groupId = Number(gidRaw);
        const res = await importApplicantsToGroup(groupId, pending.buf, {
          fileName: pending.fileName,
          source: "bot",
          userId: String(cb.from.id),
          username: cb.from.username ?? null,
        });
        pendingFiles.delete(token);
        if (!res) {
          response = `❌ Guruh #${groupId} topilmadi.`;
          await editMessageText(chatId, messageId, response);
        } else if (res.imported === 0) {
          response =
            `⚠️ <b>Hech narsa qo'shilmadi</b> — guruh #${groupId}\n` +
            (res.skipped
              ? `Barcha ${res.skipped} ta arizachi allaqachon guruhda bor edi.`
              : "Faylda yaroqli qator topilmadi (familiya, ism, passport kerak).");
          await editMessageText(chatId, messageId, response);
        } else {
          response =
            `✅ <b>Qo'shildi</b> — guruh #${groupId}\n\n` +
            `➕ Qo'shildi: <b>${res.imported}</b>\n` +
            `✔️ To'liq ma'lumotli: ${res.complete}\n` +
            `🔁 Mavjud shaxs (boshqa guruhdan): ${res.reused}\n` +
            (res.skipped ? `⏭ Tashlandi: ${res.skipped}\n` : "") +
            `\nKeyingi qadam — ro'yxatdan o'tkazish:`;
          await editMessageText(chatId, messageId, response, {
            inlineKeyboard: [
              [
                {
                  text: "📝 Ro'yxatdan o'tkazish",
                  callback_data: `reg:${groupId}`,
                },
              ],
            ],
          });
        }
      }
    } else if (action === "reg") {
      await answerCallbackQuery(cb.id, "Navbatga qo'shilmoqda…");
      const groupId = Number(token); // reg:<gid> — token o'rnida gid
      const queued = await enqueueGroupRegister({
        groupId,
        source: "bot",
        reason: "bot-register-callback",
      });
      response = queued.queuedJobs
        ? `✅ Ro'yxatdan o'tkazish navbatga qo'shildi — guruh #${groupId}\n` +
          `Userlar: <b>${queued.queuedJobs}</b> ta (skip: ${queued.skippedJobs})\n` +
          `10 ta worker parallel bajaradi.`
        : `ℹ️ Navbatga qo'shilmadi (skip: ${queued.skippedJobs}). Register kutayotgan user yo'q.`;
      await editMessageText(chatId, messageId, response);
    } else {
      await answerCallbackQuery(cb.id);
      return;
    }
  } catch (e) {
    success = false;
    response = `Xato: ${esc(e instanceof Error ? e.message : String(e))}`;
    await answerCallbackQuery(cb.id, "Xato yuz berdi");
    await editMessageText(chatId, messageId, response).catch(() => {});
  }

  // Callback'ni tarixga yozamiz.
  try {
    await prisma.botMessage.create({
      data: {
        chatId: String(chatId),
        userId: String(cb.from.id),
        username: cb.from.username ?? null,
        firstName: cb.from.first_name ?? null,
        isAdmin: true,
        type: "callback",
        text: data,
        success,
        response: response.slice(0, 4000),
      },
    });
  } catch {
    // tarix yozilmasa ham davom etamiz.
  }
}

// Bitta update'ni qayta ishlaydi. Faqat adminlarga javob qaytaradi.
// Har bir xabar (admin yoki yo'q) bazaga yoziladi.
async function handleUpdate(update: import("./telegram").TgUpdate) {
  // Inline tugma bosilsa — alohida ishlanadi.
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;
  const admin = isAdmin(chatId);
  const type = detectType(msg);
  const text = msg.text ?? msg.caption ?? null;

  // Admin bo'lmaganlarga javob qaytarilmaydi — faqat tarixga yoziladi.
  if (!admin) {
    await logMessage({
      msg,
      isAdmin: false,
      type,
      text,
      success: true,
      response: null,
    });
    return;
  }

  // Hujjat (Excel/CSV) yuborilsa — guruh tanlash / tasdiqlash oqimini boshlaymiz.
  if (type === "document") {
    let response = "";
    let keyboard: TgInlineKeyboard = [];
    let success = true;
    try {
      const out = await handleDocument(msg);
      response = out.text;
      keyboard = out.keyboard;
    } catch (e) {
      success = false;
      response = `Xato: ${esc(e instanceof Error ? e.message : String(e))}`;
    }
    await sendMessage(String(chatId), response, {
      inlineKeyboard: keyboard.length ? keyboard : undefined,
    }).catch(() => {});
    await logMessage({ msg, isAdmin: true, type, text, success, response });
    return;
  }

  // Passport rasmi yuborilsa — saqlash + MRZ tekshiruvi.
  if (type === "photo") {
    let response: string;
    let success = true;
    try {
      response = await handlePhoto(msg);
    } catch (e) {
      success = false;
      response = `Xato: ${esc(e instanceof Error ? e.message : String(e))}`;
    }
    await sendMessage(String(chatId), response).catch(() => {});
    await logMessage({ msg, isAdmin: true, type, text, success, response });
    return;
  }

  // Faqat komandalar qayta ishlanadi. Boshqa matnga yumshoq yo'naltiruvchi javob.
  if (type !== "command") {
    const hint =
      "🤖 Men komandalar bilan ishlayman.\n" +
      "Buyruqlar ro'yxati uchun /help yuboring yoki Excel/CSV faylni " +
      "guruh raqami bilan (caption) yuboring.";
    await sendMessage(String(chatId), hint).catch(() => {});
    await logMessage({
      msg,
      isAdmin: true,
      type,
      text,
      success: true,
      response: hint,
    });
    return;
  }

  let response: string;
  let success = true;
  try {
    response = await handleCommand(msg.text as string);
  } catch (e) {
    success = false;
    response = `Xato: ${esc(e instanceof Error ? e.message : String(e))}`;
  }

  await sendMessage(String(chatId), response).catch(() => {});
  await logMessage({ msg, isAdmin: true, type, text, success, response });
}

// Long polling tsikli — bot to'xtatilguncha ishlaydi.
export async function runBotPolling(): Promise<void> {
  getBotToken(); // token yo'q bo'lsa shu yerda xato beradi
  const me = await getMe();
  await setMyCommands(COMMANDS).catch(() => {});
  await setMyShortDescription(BOT_SHORT_DESCRIPTION).catch(() => {});
  await setMyDescription(BOT_DESCRIPTION).catch(() => {});
  // eslint-disable-next-line no-console
  console.log(
    `Bot ishga tushdi: @${me.username} (admins: ${getAdminChatIds().join(", ") || "yo'q!"})`,
  );

  let offset = 0;
  let lastMonitorTick = 0;
  let lastMonitorBroadcast = "";
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const now = Date.now();
      if (now - lastMonitorTick >= 10_000) {
        lastMonitorTick = now;
        const tick = await runSlotMonitorTick();
        if (tick.queued) {
          const msg =
            `🟢 Slot ochildi va global order queue ishladi\n` +
            `Guruhlar: ${tick.queued.groups}\n` +
            `Queue'ga yuborildi: ${tick.queued.queued}, skip: ${tick.queued.skipped}`;
          if (msg !== lastMonitorBroadcast) {
            lastMonitorBroadcast = msg;
            for (const adminId of getAdminChatIds()) {
              await sendMessage(adminId, msg).catch(() => {});
            }
          }
        }
      }

      const updates = await getUpdates(offset, 30);
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u);
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.error("Polling xatosi:", err);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
