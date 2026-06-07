// Telegram bot moduli (faqat backend).
// Bot admin bot sifatida ishlaydi: hujjatlar (PDF) va info xabarlar
// .env dagi admin chat'larga yuboriladi.
//
// .env sozlamalari:
//   TELEGRAM_BOT_TOKEN       = "123456:ABC-..."        (majburiy)
//   TELEGRAM_ADMIN_CHAT_IDS  = "111111111,222222222"   (vergul bilan ajratilgan)
//
// Bu modul hech qanday tashqi kutubxonaga bog'liq emas — global fetch ishlatadi.

const API_BASE = "https://api.telegram.org";

export function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN .env da topilmadi");
  }
  return token;
}

// Admin chat id'larni .env dan o'qiydi. Vergul/probel/qator bilan ajratilishi mumkin.
export function getAdminChatIds(): string[] {
  const raw = process.env.TELEGRAM_ADMIN_CHAT_IDS?.trim() || "";
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isTelegramConfigured(): boolean {
  return Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() && getAdminChatIds().length,
  );
}

type TgResponse<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

async function callApi<T = unknown>(
  method: string,
  body: FormData | Record<string, unknown>,
): Promise<T> {
  const token = getBotToken();
  const url = `${API_BASE}/bot${token}/${method}`;

  const init: RequestInit =
    body instanceof FormData
      ? { method: "POST", body }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        };

  const res = await fetch(url, init);
  const data = (await res.json().catch(() => null)) as TgResponse<T> | null;

  if (!res.ok || !data || !data.ok) {
    const reason = data?.description || `HTTP ${res.status}`;
    throw new Error(`Telegram ${method} xatosi: ${reason}`);
  }
  return data.result as T;
}

// Inline tugma turi (callback_data ≤ 64 bayt).
export type TgInlineButton = { text: string; callback_data: string };
export type TgInlineKeyboard = TgInlineButton[][];

// Bitta chat'ga matnli xabar yuboradi.
export async function sendMessage(
  chatId: string,
  text: string,
  opts: {
    parseMode?: "HTML" | "MarkdownV2";
    disablePreview?: boolean;
    inlineKeyboard?: TgInlineKeyboard;
  } = {},
): Promise<TgMessage> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: opts.parseMode ?? "HTML",
    disable_web_page_preview: opts.disablePreview ?? true,
  };
  if (opts.inlineKeyboard) {
    body.reply_markup = { inline_keyboard: opts.inlineKeyboard };
  }
  return callApi<TgMessage>("sendMessage", body);
}

// Mavjud xabar matnini (va tugmalarini) tahrirlaydi.
export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
  opts: { inlineKeyboard?: TgInlineKeyboard } = {},
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  // Tugmalarni olib tashlash uchun bo'sh klaviatura yuboriladi.
  body.reply_markup = {
    inline_keyboard: opts.inlineKeyboard ?? [],
  };
  await callApi("editMessageText", body).catch(() => {});
}

// callback tugma bosilganda Telegram'ga javob beradi (yuklanish belgisini yo'qotadi).
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await callApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  }).catch(() => {});
}

// Bitta chat'ga hujjat (PDF, fayl) yuboradi.
export async function sendDocument(
  chatId: string,
  doc: { buffer: Buffer | Uint8Array; filename: string; caption?: string },
): Promise<void> {
  const fd = new FormData();
  fd.append("chat_id", chatId);
  if (doc.caption) {
    fd.append("caption", doc.caption);
    fd.append("parse_mode", "HTML");
  }
  const bytes =
    doc.buffer instanceof Buffer ? new Uint8Array(doc.buffer) : doc.buffer;
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  fd.append(
    "document",
    new Blob([ab], { type: "application/pdf" }),
    doc.filename,
  );
  await callApi("sendDocument", fd);
}

// Bitta chat'ga rasm (skrinshot) yuboradi.
export async function sendPhoto(
  chatId: string,
  photo: { buffer: Buffer | Uint8Array; filename: string; caption?: string },
): Promise<void> {
  const fd = new FormData();
  fd.append("chat_id", chatId);
  if (photo.caption) {
    fd.append("caption", photo.caption);
    fd.append("parse_mode", "HTML");
  }
  const bytes =
    photo.buffer instanceof Buffer
      ? new Uint8Array(photo.buffer)
      : photo.buffer;
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  fd.append("photo", new Blob([ab], { type: "image/png" }), photo.filename);
  await callApi("sendPhoto", fd);
}

// Barcha admin chat'larga matnli xabar tarqatadi.
export async function broadcastMessage(
  text: string,
  opts: Parameters<typeof sendMessage>[2] = {},
): Promise<void> {
  const chatIds = getAdminChatIds();
  for (const chatId of chatIds) {
    await sendMessage(chatId, text, opts);
  }
}

// ---- Long polling (getUpdates) uchun yordamchilar ----

export type TgUser = {
  id: number;
  is_bot: boolean;
  first_name?: string;
  username?: string;
};

export type TgChat = { id: number; type: string };

export type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  document?: { file_id: string; file_name?: string; mime_type?: string };
  photo?: { file_id: string }[];
  date: number;
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
};

export type TgCallbackQuery = {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
};

// getUpdates — long polling. offset = oxirgi qayta ishlangan update_id + 1.
export async function getUpdates(
  offset: number,
  timeoutSec = 30,
): Promise<TgUpdate[]> {
  return callApi<TgUpdate[]>("getUpdates", {
    offset,
    timeout: timeoutSec,
    allowed_updates: ["message", "callback_query"],
  });
}

// Bot menyusidagi komandalar ro'yxatini o'rnatadi.
export async function setMyCommands(
  commands: { command: string; description: string }[],
): Promise<void> {
  await callApi("setMyCommands", { commands });
}

// Bot profilidagi to'liq tavsif (chat ochilganda ko'rinadi, ≤512 belgi).
export async function setMyDescription(description: string): Promise<void> {
  await callApi("setMyDescription", { description });
}

// Bot profilidagi qisqa bio (profil sahifasida ko'rinadi, ≤120 belgi).
export async function setMyShortDescription(
  shortDescription: string,
): Promise<void> {
  await callApi("setMyShortDescription", {
    short_description: shortDescription,
  });
}

export async function getMe(): Promise<TgUser> {
  return callApi<TgUser>("getMe", {});
}

// Telegram'dan fayl yo'lini oladi (getFile) va faylni yuklab Buffer qaytaradi.
export async function downloadFile(fileId: string): Promise<Buffer> {
  const token = getBotToken();
  const file = await callApi<{ file_path?: string }>("getFile", {
    file_id: fileId,
  });
  if (!file.file_path) {
    throw new Error("Telegram fayl yo'li topilmadi");
  }
  const url = `${API_BASE}/file/bot${token}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fayl yuklab bo'lmadi: HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

export type TelegramDocument = {
  buffer: Buffer | Uint8Array;
  filename: string;
  caption?: string;
};

export type GroupDispatchResult = {
  sent: number;
  failed: { filename: string; error: string }[];
};

// Guruh PDF'larini ketma-ket (bittada qator qilib) barcha adminlarga yuboradi:
//   1) avval info xabar
//   2) keyin har bir PDF alohida hujjat sifatida
// Adminlar soni ko'p bo'lsa, har bir admin uchun barcha hujjatlar yuboriladi.
export async function dispatchGroupDocuments(params: {
  infoMessage: string;
  documents: TelegramDocument[];
}): Promise<GroupDispatchResult> {
  const { infoMessage, documents } = params;
  const chatIds = getAdminChatIds();
  if (!chatIds.length) {
    throw new Error("TELEGRAM_ADMIN_CHAT_IDS .env da topilmadi");
  }

  const result: GroupDispatchResult = { sent: 0, failed: [] };

  for (const chatId of chatIds) {
    // 1) Info xabar
    await sendMessage(chatId, infoMessage);

    // 2) Hujjatlarni ketma-ket yuborish
    for (const doc of documents) {
      try {
        await sendDocument(chatId, doc);
        result.sent += 1;
      } catch (e) {
        result.failed.push({
          filename: doc.filename,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return result;
}
