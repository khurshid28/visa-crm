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
function activationLinkRegex(): RegExp {
  const custom = process.env.ACTIVATION_LINK_PATTERN?.trim();
  if (custom) {
    try {
      return new RegExp(custom, "i");
    } catch {
      /* noto'g'ri regex — default'ga qaytamiz */
    }
  }
  // VFS Global: .../activateemail?q=...
  return /https?:\/\/[^\s"'<>]*activateemail\?q=[^\s"'<>]+/i;
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

/**
 * Berilgan email manziliga kelgan aktivatsiya xatini kutadi.
 * Topilmasa null qaytaradi (timeout). Xat topilganda link bilan qaytaradi.
 *
 *  @param toEmail   userning generated email'i (To maydoni shu bo'lishi kerak)
 *  @param opts.timeoutMs  jami kutish (default 3 daqiqa)
 *  @param opts.pollMs     har necha ms da qayta tekshirish (default 10s)
 *  @param opts.sinceMs    necha ms oldingacha xatlarni qaraydi (default 30 daqiqa)
 */
export async function waitForActivationMail(
  toEmail: string,
  opts: { timeoutMs?: number; pollMs?: number; sinceMs?: number } = {},
): Promise<ActivationMail | null> {
  const cfg = getImapConfig();
  if (!cfg) return null;

  const want = normalizeEmail(toEmail);
  if (!want) return null;

  const timeoutMs =
    opts.timeoutMs ?? Number(process.env.ACTIVATION_TIMEOUT_MS || 180000);
  const pollMs = opts.pollMs ?? Number(process.env.ACTIVATION_POLL_MS || 10000);
  const sinceMs =
    opts.sinceMs ?? Number(process.env.ACTIVATION_SINCE_MS || 30 * 60000);
  const senders = senderFilter();
  const re = activationLinkRegex();

  const deadline = Date.now() + Math.max(timeoutMs, pollMs);

  // imapflow + mailparser'ni dinamik import (build'ni yengillashtirish uchun).
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");

  while (Date.now() < deadline) {
    const since = new Date(Date.now() - sinceMs);
    const client = new ImapFlow({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock(cfg.mailbox);
      try {
        // So'nggi xatlarni teskari tartibda ko'ramiz (yangi birinchi).
        const uids = await client.search({ since }, { uid: true });
        const list = Array.isArray(uids) ? uids.slice().reverse() : [];

        for (const uid of list) {
          const msg = await client.fetchOne(
            String(uid),
            { source: true, envelope: true },
            { uid: true },
          );
          if (!msg || !msg.source) continue;

          // "To" tekshiruvi (catch-all bo'lsa ham aniq userga moslaymiz).
          const env = msg.envelope;
          const toAddrs: string[] = [];
          for (const grp of [
            env?.to,
            env?.cc,
            (env as { bcc?: { address?: string }[] })?.bcc,
          ]) {
            if (Array.isArray(grp)) {
              for (const a of grp)
                if (a?.address) toAddrs.push(normalizeEmail(a.address));
            }
          }

          const parsed = await simpleParser(msg.source as Buffer);
          // Delivered-To / To header'larini ham qo'shamiz (catch-all uchun).
          const headerTo = normalizeEmail(
            (parsed.headers.get("delivered-to") as string) ||
              (typeof parsed.to === "object" && parsed.to && "text" in parsed.to
                ? (parsed.to as { text: string }).text
                : ""),
          );
          if (headerTo)
            toAddrs.push(...headerTo.split(/[,;\s]+/).map(normalizeEmail));

          const matchesTo = toAddrs.includes(want);
          if (!matchesTo) continue;

          // Jo'natuvchi filtri.
          const from = normalizeEmail(
            parsed.from?.text || env?.from?.[0]?.address || "",
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
            subject: parsed.subject || env?.subject || "",
            date: parsed.date || env?.date || new Date(),
          };
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }

    if (Date.now() + pollMs >= deadline) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  return null;
}
