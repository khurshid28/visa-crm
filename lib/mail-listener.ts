import "dotenv/config";

/**
 * ====================================================================
 *  MAIL LISTENER — Gmail/IMAP orqali aktivatsiya xatini kutadi
 * ====================================================================
 *  Register'dan keyin VFS (donotreply@vfsglobal.com) userning
 *  {ism}{id}@uzbekviza.uz manziliga "Welcome" xati yuboradi. Barcha
 *  xatlar catch-all bo'lib info@uzbekvisa.uz qutisiga tushadi.
 *
 *  Bu modul IMAP qutiga ulanib, "To" maydoni userning email'i bo'lgan
 *  xatni topadi va ichidan aktivatsiya linkini (activateemail?q=...)
 *  ajratib beradi. Link keyin userning Playwright profilida ochiladi —
 *  shundagina register to'liq tugagan hisoblanadi.
 * ====================================================================
 */

export type ActivationMail = {
  link: string;
  to: string;
  from: string;
  subject: string;
  date: Date;
};

export type ImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  mailbox: string;
};

export function isMailListenerEnabled(): boolean {
  return Boolean(
    process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASSWORD,
  );
}

export function getImapConfig(): ImapConfig | null {
  const host = process.env.IMAP_HOST?.trim();
  const user = process.env.IMAP_USER?.trim();
  const pass = process.env.IMAP_PASSWORD;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.IMAP_PORT || 993);
  return {
    host,
    port,
    secure: String(process.env.IMAP_SECURE ?? "true") !== "false",
    user,
    pass,
    mailbox: process.env.IMAP_MAILBOX?.trim() || "INBOX",
  };
}

// Aktivatsiya linkini aniqlovchi regex (.env bilan o'zgartirsa bo'ladi).
// DIQQAT: ACTIVATION_LINK_PATTERN ni .env da HADDAN TASHQARI escape QILMANG.
// dotenv `\\` ni `\` ga aylantirmaydi, shuning uchun `[^\\s...]` regexda
// "backslash yoki s" degani bo'lib qoladi (whitespace EMAS) va URL dagi `s`
// (viSa/vfSglobal) tufayli link TOPILMAY qoladi. To'g'risi: oddiy `\s`, `\?`.
const CANONICAL_ACTIVATION_URL =
  "https://visa.vfsglobal.com/uzb/en/lva/activateemail?q=AbC123+/=";
const DEFAULT_ACTIVATION_RE =
  /https?:\/\/[^\s"'<>]*activateemail\?q=[^\s"'<>]+/i;

function activationLinkRegex(): RegExp {
  const custom = process.env.ACTIVATION_LINK_PATTERN?.trim();
  if (custom) {
    try {
      const re = new RegExp(custom, "i");
      // Custom pattern haqiqiy VFS aktivatsiya URL'iga MOS kelmasa (masalan,
      // haddan tashqari escape qilingan bo'lsa) — jimgina yutib yuborishdan
      // ko'ra ishonchli default'ga qaytamiz (aks holda xat TOPILMAY qoladi).
      if (re.test(CANONICAL_ACTIVATION_URL)) return re;
      console.warn(
        "[mail] ACTIVATION_LINK_PATTERN namunaviy URL'ga mos kelmadi — default ishlatilmoqda. " +
          "Pattern'da `\\s`/`\\?` ni HADDAN TASHQARI escape qilmang (`\\\\s` EMAS).",
      );
    } catch {
      /* noto'g'ri regex — default'ga qaytamiz */
    }
  }
  // VFS Global: .../activateemail?q=...
  return DEFAULT_ACTIVATION_RE;
}

// Jo'natuvchi filtri (bo'sh bo'lsa hammasi qabul qilinadi).
function senderFilter(): string[] {
  return (process.env.ACTIVATION_FROM || "vfsglobal.com|donotreply")
    .split("|")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEmail(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

// HTML/matn ichidan birinchi aktivatsiya linkini topadi.
export function extractActivationLink(
  html: string,
  text: string,
): string | null {
  const re = activationLinkRegex();
  const hay = `${text || ""}\n${html || ""}`;
  const m = hay.match(re);
  if (!m) return null;
  // HTML entity (&amp;) ni tozalaymiz.
  return m[0].replace(/&amp;/g, "&").trim();
}

// Xatning BARCHA qabul qiluvchi manzillarini yig'adi (envelope to/cc/bcc +
// parse qilingan To/Cc + Delivered-To/X-Original-To/X-Forwarded-To header'lari).
// Catch-all forward'da envelope/Delivered-To = info@uzbekvisa.uz bo'lib qoladi,
// lekin ASL "To:" header userning manzilini (bekzod...@uzbekvisa.uz) saqlaydi —
// shuning uchun HAMMA manbadan yig'amiz, aks holda catch-all xat TOPILMAYDI.
function collectRecipients(
  parsed: import("mailparser").ParsedMail,
  env: { to?: unknown; cc?: unknown; bcc?: unknown } | undefined,
): string[] {
  const out: string[] = [];
  const pushOne = (addr: string | null | undefined) => {
    const n = normalizeEmail(addr);
    if (n && n.includes("@")) out.push(n);
  };
  const pushText = (text: string | null | undefined) => {
    for (const part of String(text || "").split(/[\s,;<>]+/))
      if (part.includes("@")) pushOne(part);
  };
  // Envelope to/cc/bcc (catch-all'da info@... bo'lishi mumkin).
  for (const grp of [env?.to, env?.cc, env?.bcc]) {
    if (Array.isArray(grp))
      for (const a of grp) pushOne((a as { address?: string } | null)?.address);
  }
  // Parse qilingan To/Cc (AddressObject) — ASL recipient ko'pincha shu yerda.
  for (const ao of [parsed.to, parsed.cc]) {
    if (!ao) continue;
    const obj = ao as { value?: { address?: string }[]; text?: string };
    if (Array.isArray(obj.value) && obj.value.length)
      for (const a of obj.value) pushOne(a?.address);
    else pushText(obj.text);
  }
  // Forward/catch-all header'lari (odatda string ko'rinishida keladi).
  for (const h of ["delivered-to", "x-original-to", "x-forwarded-to"]) {
    const v = parsed.headers.get(h);
    if (!v) continue;
    const arr = Array.isArray(v) ? v : [v];
    for (const item of arr) {
      if (typeof item === "string") pushText(item);
      else pushText((item as { text?: string } | null)?.text);
    }
  }
  return out;
}

/**
 * Berilgan email manziliga kelgan aktivatsiya xatini kutadi.
 * Topilmasa null qaytaradi (timeout). Xat topilganda link bilan qaytaradi.
 *
 *  @param toEmail   userning generated email'i (To maydoni shu bo'lishi kerak)
 *  @param opts.timeoutMs  jami kutish (default 3 daqiqa)
 *  @param opts.pollMs     har necha ms da qayta tekshirish (default 4s)
 *  @param opts.sinceMs    necha ms oldingacha xatlarni qaraydi (default 30 daqiqa)
 *  @param opts.onPoll     har poll'da chaqiriladi (jonli progress ko'rsatish uchun)
 */
export async function waitForActivationMail(
  toEmail: string,
  opts: {
    timeoutMs?: number;
    pollMs?: number;
    sinceMs?: number;
    onPoll?: (info: {
      attempt: number;
      elapsedMs: number;
      remainingMs: number;
      newScanned: number;
    }) => void;
  } = {},
): Promise<ActivationMail | null> {
  const cfg = getImapConfig();
  if (!cfg) return null;

  const want = normalizeEmail(toEmail);
  if (!want) return null;
  // Cross-domen yo'naltirish uchun: "@" dan oldingi local-part ham
  // solishtiriladi. Masalan generatsiya qilingan sardor@uzbekviza.uz (z bilan)
  // xati info@uzbekvisa.uz (s bilan) qutisiga kelsa ham, "To" local-part
  // bo'yicha topiladi (forward domenni almashtirsa ham ishlaydi).
  const wantLocal = want.split("@")[0] || "";

  const timeoutMs =
    opts.timeoutMs ?? Number(process.env.ACTIVATION_TIMEOUT_MS || 180000);
  const pollMs = opts.pollMs ?? Number(process.env.ACTIVATION_POLL_MS || 4000);
  const sinceMs =
    opts.sinceMs ?? Number(process.env.ACTIVATION_SINCE_MS || 30 * 60000);
  const senders = senderFilter();
  const re = activationLinkRegex();

  const startedAt = Date.now();
  const deadline = startedAt + Math.max(timeoutMs, pollMs);

  // imapflow + mailparser'ni dinamik import (build'ni yengillashtirish uchun).
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  // Tekshirilgan UID'lar — qayta parse qilmaslik uchun (tez poll).
  const seen = new Set<number>();
  // Bitta ulanishni OCHIQ saqlaymiz: har poll'da qayta ulanmaymiz (connect+login
  // ~1-2s) => tez "kuzatuv" rejimi. Ulanish uzilsa keyingi siklda qayta ulanadi.
  let client: InstanceType<typeof ImapFlow> | null = null;
  const closeClient = async () => {
    if (!client) return;
    try {
      await client.logout();
    } catch {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
    client = null;
  };

  let attempt = 0;
  try {
    while (Date.now() < deadline) {
      attempt += 1;
      let newScanned = 0;
      try {
        if (!client || client.usable === false) {
          await closeClient();
          client = new ImapFlow({
            host: cfg.host,
            port: cfg.port,
            secure: cfg.secure,
            auth: { user: cfg.user, pass: cfg.pass },
            logger: false,
          });
          await client.connect();
          await client.mailboxOpen(cfg.mailbox);
        }
        // Serverdagi yangi xatlarni yangilab olamiz (push o'rniga ishonchli).
        try {
          await client.noop();
        } catch {
          /* ignore */
        }

        const since = new Date(Date.now() - sinceMs);
        const uids = await client.search({ since }, { uid: true });
        // Yangi birinchi (teskari) — aktivatsiya xati odatda eng so'nggisi.
        const list = Array.isArray(uids) ? uids.slice().reverse() : [];

        for (const uid of list) {
          if (seen.has(uid)) continue;
          seen.add(uid);
          newScanned += 1;

          const msg = await client.fetchOne(
            String(uid),
            { source: true, envelope: true },
            { uid: true },
          );
          if (!msg || !msg.source) continue;

          const parsed = await simpleParser(msg.source as Buffer);
          // Catch-all forward'da envelope/Delivered-To = info@... bo'lib qoladi,
          // ASL "To:" esa userning manzilini saqlaydi — BARCHA manbalardan
          // yig'amiz (aks holda catch-all xat topilmaydi — eski `||` bug'i).
          const toAddrs = collectRecipients(parsed, msg.envelope);

          const matchesTo =
            toAddrs.includes(want) ||
            (wantLocal.length >= 3 &&
              toAddrs.some((a) => (a.split("@")[0] || "") === wantLocal));
          if (!matchesTo) continue;

          // Jo'natuvchi filtri.
          const from = normalizeEmail(
            parsed.from?.text || msg.envelope?.from?.[0]?.address || "",
          );
          if (senders.length && !senders.some((s) => from.includes(s)))
            continue;

          // Link.
          const link = extractActivationLink(
            parsed.html || "",
            parsed.text || "",
          );
          if (!link || !re.test(link)) continue;

          return {
            link,
            to: want,
            from,
            subject: parsed.subject || msg.envelope?.subject || "",
            date: parsed.date || msg.envelope?.date || new Date(),
          };
        }
      } catch {
        // Ulanish/parse xatosi — ulanishni tashlab keyingi siklda qayta ulanadi.
        await closeClient();
      }

      // Jonli progress (register-full shu orqali "kutilmoqda... Ns" chiqaradi).
      try {
        opts.onPoll?.({
          attempt,
          elapsedMs: Date.now() - startedAt,
          remainingMs: Math.max(0, deadline - Date.now()),
          newScanned,
        });
      } catch {
        /* ignore */
      }

      if (Date.now() + pollMs >= deadline) break;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  } finally {
    await closeClient();
  }

  return null;
}
