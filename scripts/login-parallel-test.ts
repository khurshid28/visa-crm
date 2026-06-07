// Booking LOGIN — PARALLEL test (5 worker, xuddi order-worker'dek).
// Har worker alohida brauzer (CDP + proxy + fresh profil) ochib, AYNAN
// hozirgi `loginToBooking` oqimi bilan login qiladi. Bitta user yetarli:
// har worker o'z profileKey'ini oladi (email#1, email#2 ...) — shunda har biri
// ALOHIDA profil va ALOHIDA sticky IP oladi (bir-biriga xalal bermaydi).
//
// Ishga tushirish:
//   npm run login:test:parallel
//   npm run login:test:parallel -- 5 boshqa@email.com Parol123
//   $env:LOGIN_WORKERS="5"; npm run login:test:parallel
//
// Asosiy kodga TEGMAYDI — faqat shu test. Login mantiqi o'zgarmaydi
// (loginToBooking'ni chaqiradi).

import "dotenv/config";
import { loginToBooking, type LoginResult } from "../lib/automation";

const DEFAULT_EMAIL = "alpdiametr@gmail.com";
const DEFAULT_PASSWORD = "Alpdiametr2827@";

// ── Rang yordamchilari (LOG_COLOR=false bo'lsa o'chadi) ──
const COLOR = (process.env.LOG_COLOR || "true").toLowerCase() !== "false";
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c("1", s);
const dim = (s: string) => c("2", s);
const green = (s: string) => c("32", s);
const red = (s: string) => c("31", s);
const yellow = (s: string) => c("33", s);
const cyan = (s: string) => c("36", s);
const gray = (s: string) => c("90", s);
// Har worker uchun alohida rang (ko'rinishini ajratish uchun).
const WCOL = ["36", "35", "33", "32", "34", "95", "96", "93"];

const hr = () => console.log(gray("─".repeat(60)));
const now = () => new Date().toTimeString().slice(0, 8);

const startedAt = Date.now();
const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(1).padStart(5);

/** Bitta worker'ni ishga tushiradi. */
async function runWorker(
  id: number,
  email: string,
  password: string,
): Promise<{ id: number; res: LoginResult; ms: number }> {
  const tag = c(WCOL[(id - 1) % WCOL.length], `[W${id}]`);
  const onStep = (msg: string) => {
    const bad = /✗|topilmadi|o'tmadi|xato|uzildi|bloklandi/i.test(msg);
    const ok = /✓|o'tdi|kiritildi|ochildi|bosildi/i.test(msg);
    const icon = bad ? red("✗") : ok ? green("✓") : cyan("•");
    console.log(`${tag} ${gray(`[${elapsed()}s]`)} ${icon} ${msg}`);
  };

  const t0 = Date.now();
  // Har worker o'z profileKey'i — alohida profil + alohida sticky IP.
  const profileKey = `${email}#${id}`;
  const res = await loginToBooking(email, password, { profileKey, onStep });
  return { id, res, ms: Date.now() - t0 };
}

async function main() {
  const workers = Math.max(
    1,
    Number(process.argv[2] || process.env.LOGIN_WORKERS || "5"),
  );
  const email = process.argv[3] || DEFAULT_EMAIL;
  const password = process.argv[4] || DEFAULT_PASSWORD;

  console.log("");
  hr();
  console.log("  " + bold(`🔐  PARALLEL LOGIN TEST — ${workers} worker`));
  hr();
  console.log(`  ${gray("Vaqt".padEnd(16))} ${now()}`);
  console.log(`  ${gray("Email".padEnd(16))} ${email}`);
  console.log(
    `  ${gray("URL".padEnd(16))} ${process.env.BOOKING_LOGIN_URL || red("(.env yo'q!)")}`,
  );
  console.log(
    `  ${gray("Proxy".padEnd(16))} ${
      process.env.PROXY_ENABLED === "true" ? green("ON (sticky)") : dim("off")
    }`,
  );
  console.log(
    `  ${gray("Davlatlar".padEnd(16))} ${process.env.PROXY_COUNTRIES || dim("—")}`,
  );
  console.log(
    `  ${gray("Headless".padEnd(16))} ${
      (process.env.BOOKING_HEADLESS ?? "true") === "false"
        ? yellow("false (ko'rinadi)")
        : "true"
    }`,
  );
  hr();
  console.log("  " + bold("Bosqichlar (worker'lar parallel):"));

  // Hamma worker'ni BIR VAQTDA ishga tushiramiz.
  const results = await Promise.all(
    Array.from({ length: workers }, (_, i) =>
      runWorker(i + 1, email, password).catch((e) => ({
        id: i + 1,
        ms: 0,
        res: {
          ok: false,
          note: `Worker xatosi: ${e instanceof Error ? e.message : String(e)}`,
          url: "",
          finalUrl: "",
          captchaPresent: false,
          captchaSolved: false,
          filledEmail: false,
          filledPassword: false,
          submitted: false,
          exitIp: null,
          statusCode: null,
          pageError: null,
        } as LoginResult,
      })),
    ),
  );

  results.sort((a, b) => a.id - b.id);
  const okCount = results.filter((r) => r.res.ok).length;
  const totalMs = Date.now() - startedAt;

  hr();
  console.log(
    "  " +
      bold("📋  NATIJA") +
      gray(`  (${(totalMs / 1000).toFixed(1)}s, ${okCount}/${workers} ✓)`),
  );
  hr();
  // Jadval sarlavhasi.
  console.log(
    gray(
      `  ${"W".padEnd(4)}${"Login".padEnd(10)}${"Capt".padEnd(7)}${"HTTP".padEnd(6)}${"IP".padEnd(17)}${"s".padEnd(6)}Izoh`,
    ),
  );
  for (const { id, res, ms } of results) {
    const login = res.ok ? green("OK ✓".padEnd(10)) : red("FAIL ✗".padEnd(10));
    const capt = res.captchaPresent
      ? res.captchaSolved
        ? green("✓".padEnd(7))
        : red("✗".padEnd(7))
      : dim("—".padEnd(7));
    const http = String(res.statusCode ?? "—").padEnd(6);
    const ip = (res.exitIp || "—").padEnd(17);
    const secs = (ms / 1000).toFixed(1).padEnd(6);
    console.log(
      `  ${`#${id}`.padEnd(4)}${login}${capt}${gray(http)}${gray(ip)}${gray(secs)}${dim(res.note.slice(0, 40))}`,
    );
  }
  hr();
  console.log("");

  process.exit(okCount === workers ? 0 : 1);
}

main().catch((e) => {
  console.error(red("Test xatosi:"), e);
  process.exit(1);
});
