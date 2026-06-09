import "dotenv/config";

/**
 * ====================================================================
 *  MAIL TEST — IMAP ulanishini va so'nggi xatlarni tekshiradi
 * ====================================================================
 *  Ishlatish:
 *    npm run mail:test                 -> ulanadi, so'nggi 10 xat sarlavhasini ko'rsatadi
 *    npm run mail:test -- sardor@uzbekvisa.uz
 *                                       -> shu manzilga (yoki local-part) kelgan
 *                                          aktivatsiya xatini ham qidiradi
 *
 *  .env: IMAP_HOST / IMAP_USER / IMAP_PASSWORD (App Password) / IMAP_MAILBOX
 *
 *  Eslatma: barcha belgilar ASCII — PowerShell pipe (| Select-Object) orqali
 *  o'tkazilganda ham log buzilmaydi (UTF-8 box/emoji belgilari buziladi).
 * ====================================================================
 */

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[90m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  white: "\x1b[97m",
};

const W = 64;

// ANSI ranglarini hisobga olmagan holda matn uzunligi.
function plainLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function rule(color = C.dim, ch = "="): string {
  return color + ch.repeat(W) + C.reset;
}

function center(text: string): string {
  const pad = Math.max(0, Math.floor((W - plainLen(text)) / 2));
  return " ".repeat(pad) + text;
}

function kv(label: string, value: string, color = C.white): string {
  return (
    "  " + C.dim + (label + ":").padEnd(9) + C.reset + color + value + C.reset
  );
}

function fmtDate(d: Date | null): string {
  if (!d || isNaN(d.getTime())) return "  --  --   ";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

type MailEnvelope = {
  subject?: string;
  from?: { address?: string }[];
  to?: { address?: string }[];
  date?: Date;
};

function looksLikeVfs(sender: string, subj: string): boolean {
  return (
    /vfsglobal|donotreply/i.test(sender) ||
    /activat|welcome|booking|appointment|visa/i.test(subj)
  );
}

// Jonli (watch) rejimda yangi kelgan xatni chiroyli ko'rsatadi.
function printLiveRow(env: MailEnvelope): void {
  const subj = env.subject || "(mavzusiz)";
  const sender = env.from?.[0]?.address || "?";
  const to = env.to?.[0]?.address || "?";
  const now = fmtDate(new Date());
  const isVfs = looksLikeVfs(sender, subj);
  const tag = isVfs ? C.green + "[VFS]" + C.reset : C.cyan + "[NEW]" + C.reset;
  console.log("");
  console.log("  " + tag + C.dim + `  ${now}` + C.reset);
  console.log("  " + C.dim + "from: " + C.reset + C.cyan + sender + C.reset);
  console.log(
    "  " +
      C.dim +
      "to:   " +
      C.reset +
      C.bold +
      C.white +
      to +
      C.reset +
      (isVfs ? C.green + "  <-- catch-all!" + C.reset : ""),
  );
  console.log("  " + C.dim + "subj: " + C.reset + subj.slice(0, 56));
}

// Doimiy listener: har MAIL_WATCH_POLL_MS (default 10s) da qutini tekshiradi,
// yangi kelgan xatlarni jonli chiqaradi. Ctrl+C bilan to'xtatiladi.
async function watchMailbox(cfg: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  mailbox: string;
}): Promise<void> {
  const { ImapFlow } = await import("imapflow");
  const pollMs = Number(process.env.MAIL_WATCH_POLL_MS || 10000);
  const seen = new Set<number>();
  let first = true;
  let lastErr = "";

  console.log(rule(C.cyan));
  console.log(
    "  " +
      C.bold +
      C.green +
      "LISTENER yoqildi" +
      C.reset +
      C.dim +
      `  (har ${Math.round(pollMs / 1000)}s tekshiradi, Ctrl+C to'xtatadi)` +
      C.reset,
  );
  console.log(
    "  " +
      C.dim +
      "Soxta manzilga xat yuboring (masalan test123@uzbekvisa.uz) — shu yerda jonli chiqadi." +
      C.reset,
  );
  console.log(rule());

  for (;;) {
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
        const status = await client.status(cfg.mailbox, { messages: true });
        const total = status.messages ?? 0;
        if (total > 0) {
          const from = Math.max(1, total - 29);
          const fresh: MailEnvelope[] = [];
          for await (const msg of client.fetch(
            `${from}:*`,
            { envelope: true },
            { uid: true },
          )) {
            const uid = msg.uid;
            if (seen.has(uid)) continue;
            seen.add(uid);
            if (!first) fresh.push(msg.envelope as MailEnvelope);
          }
          for (const env of fresh) printLiveRow(env);
        }
        first = false;
        lastErr = "";
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (e) {
      const m = (e as Error)?.message || String(e);
      if (m !== lastErr) {
        console.log(
          "  " +
            C.red +
            "[x] watch xato: " +
            C.reset +
            m +
            C.dim +
            " (qayta urinadi)" +
            C.reset,
        );
        lastErr = m;
      }
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function main() {
  const { getImapConfig, isMailListenerEnabled, waitForActivationMail } =
    await import("../lib/mail-listener");

  // Argumentlar: flaglar (--watch/-w) va target email.
  const args = process.argv.slice(2);
  const wantWatch = args.includes("--watch") || args.includes("-w");
  const target = args.find((a) => !a.startsWith("-"))?.trim();

  console.log("");
  console.log(rule(C.cyan));
  console.log(center(C.bold + C.cyan + "MAIL  ::  IMAP TEST" + C.reset));
  console.log(rule(C.cyan));

  if (!isMailListenerEnabled()) {
    console.log(
      "  " +
        C.red +
        "[x] IMAP sozlanmagan" +
        C.reset +
        C.dim +
        " - .env da IMAP_HOST / IMAP_USER / IMAP_PASSWORD to'ldiring." +
        C.reset,
    );
    process.exit(1);
  }

  const cfg = getImapConfig();
  if (!cfg) {
    console.log("  " + C.red + "[x] IMAP config o'qib bo'lmadi" + C.reset);
    process.exit(1);
  }

  console.log(kv("host", `${cfg.host}:${cfg.port}`, C.white));
  console.log(kv("user", cfg.user, C.cyan));
  console.log(kv("box", cfg.mailbox, C.white));
  console.log(rule());

  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });

  const t0 = Date.now();
  try {
    await client.connect();
    console.log(
      "  " +
        C.green +
        "[OK] Ulandi" +
        C.reset +
        C.dim +
        `  (+${Date.now() - t0}ms)` +
        C.reset,
    );
  } catch (e) {
    console.log(
      "  " +
        C.red +
        "[x] Ulanmadi: " +
        C.reset +
        ((e as Error)?.message || String(e)),
    );
    console.log(
      "  " +
        C.yellow +
        "Eslatma: " +
        C.reset +
        C.dim +
        "Gmail uchun oddiy parol emas, App Password (16 belgi, probelsiz) kerak;\n" +
        "           hamda akkauntda IMAP yoqilgan bo'lishi shart." +
        C.reset,
    );
    process.exit(1);
  }

  const lock = await client.getMailboxLock(cfg.mailbox);
  try {
    const status = await client.status(cfg.mailbox, {
      messages: true,
      unseen: true,
    });
    console.log(
      "  " +
        C.dim +
        "Jami: " +
        C.reset +
        C.bold +
        `${status.messages ?? "?"}` +
        C.reset +
        C.dim +
        "   o'qilmagan: " +
        C.reset +
        C.yellow +
        `${status.unseen ?? "?"}` +
        C.reset,
    );
    console.log(rule());
    console.log("  " + C.bold + C.white + "So'nggi 10 xat" + C.reset);
    console.log("");

    const total = status.messages ?? 0;
    if (total > 0) {
      const from = Math.max(1, total - 9);
      const rows: { env: NonNullable<unknown> & Record<string, unknown> }[] =
        [];
      for await (const msg of client.fetch(`${from}:*`, { envelope: true })) {
        rows.push({ env: msg.envelope as never });
      }
      // Yangi xat birinchi.
      rows.reverse();
      let i = 0;
      for (const { env } of rows) {
        i++;
        const e = env as {
          subject?: string;
          from?: { address?: string }[];
          to?: { address?: string }[];
          date?: Date;
        };
        const subj = e.subject || "(mavzusiz)";
        const sender = e.from?.[0]?.address || "?";
        const to = e.to?.[0]?.address || "?";
        const date = fmtDate(e.date ? new Date(e.date) : null);
        const isVfs =
          /vfsglobal|donotreply/i.test(sender) ||
          /activat|welcome|booking|appointment|visa/i.test(subj);
        const mark = isVfs ? C.yellow + " *" + C.reset : "  ";
        const num = C.dim + String(i).padStart(2, "0") + C.reset;

        console.log(
          `  ${num}${mark} ${C.dim}${date}${C.reset}  ${C.cyan}${sender}${C.reset}`,
        );
        console.log(`        ${C.dim}->${C.reset} ${to}`);
        console.log(
          `        ${isVfs ? C.bold + C.white : C.dim}${subj.slice(0, 56)}${
            C.reset
          }`,
        );
        if (i < rows.length) console.log("");
      }
    } else {
      console.log("  " + C.dim + "(qutida xat yo'q)" + C.reset);
    }
  } finally {
    lock.release();
  }
  await client.logout();

  // Ixtiyoriy: berilgan manzilga aktivatsiya xatini qidirish.
  if (target) {
    console.log(rule());
    console.log(
      "  " +
        C.bold +
        C.white +
        "Aktivatsiya xati qidirilyapti" +
        C.reset +
        C.dim +
        "  (local-part bo'yicha ham, ~20s)" +
        C.reset,
    );
    console.log(kv("target", target, C.cyan));
    const mail = await waitForActivationMail(target, {
      timeoutMs: 20000,
      pollMs: 5000,
    });
    if (mail) {
      console.log("  " + C.green + "[OK] Topildi!" + C.reset);
      console.log(kv("To", mail.to, C.white));
      console.log(kv("From", mail.from, C.cyan));
      console.log(kv("Subject", mail.subject || "(yo'q)", C.white));
      console.log(kv("Link", mail.link, C.green));
    } else {
      console.log(
        "  " +
          C.yellow +
          "[!] Topilmadi" +
          C.reset +
          C.dim +
          " (bu manzilga aktivatsiya xati hali kelmagan bo'lishi mumkin)" +
          C.reset,
      );
    }
  }

  // Doimiy listener rejimi (--watch / -w).
  if (wantWatch) {
    const cfg2 = getImapConfig();
    if (cfg2) await watchMailbox(cfg2);
    return;
  }

  console.log(rule(C.cyan));
  console.log("");
}

main().catch((e) => {
  console.error(C.red + "[x] Xato: " + C.reset + (e?.message || e));
  process.exit(1);
});
