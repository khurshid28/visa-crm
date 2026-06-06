// Booking saytiga LOGIN testi (bitta user) — chiroyli, bosqichma-bosqich log.
// Ishga tushirish:
//   npm run login:test
//   npm run login:test -- boshqa@email.com Parol123
//   npx tsx scripts/login-test.ts
//
// .env dan ishlatadigan narsalar:
//   BOOKING_LOGIN_URL          — login sahifasi
//   PROXY_*                    — sticky residential IP (har user o'z IP'si)
//   BOOKING_HEADLESS=false     — brauzerni ko'rib turish (debug)
//   BOOKING_CAPTCHA_TIMEOUT_MS — Turnstile token kutish vaqti
//
// Hammasi ishlatiladi: proxy (sticky) + stealth + IP davlatiga mos timezone/til
// + inson kabi yozish + Turnstile token kutish.

import "dotenv/config";
import { loginToBooking } from "../lib/automation";

const DEFAULT_EMAIL = "khurshidi2827@gmail.com";
const DEFAULT_PASSWORD = "Khurshid2827@";

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

const hr = () => console.log(gray("─".repeat(54)));
const now = () => new Date().toTimeString().slice(0, 8);

let stepNo = 0;
const startedAt = Date.now();

function logStep(msg: string) {
  stepNo += 1;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1).padStart(5);
  const ok = /✓|o'tdi|kiritildi|ochildi|bosildi/i.test(msg);
  const bad = /✗|topilmadi|o'tmadi|xato/i.test(msg);
  const icon = bad ? red("✗") : ok ? green("✓") : cyan("•");
  const num = gray(`#${String(stepNo).padStart(2, "0")}`);
  console.log(
    `  ${num} ${gray(`[${elapsed}s]`)} ${icon} ${bad ? red(msg) : msg}`,
  );
}

function row(label: string, value: string, good?: boolean) {
  const v = good === true ? green(value) : good === false ? red(value) : value;
  console.log(`  ${gray(label.padEnd(16))} ${v}`);
}

async function main() {
  const email = process.argv[2] || DEFAULT_EMAIL;
  const password = process.argv[3] || DEFAULT_PASSWORD;

  console.log("");
  hr();
  console.log("  " + bold("🔐  BOOKING LOGIN TEST"));
  hr();
  row("Vaqt", now());
  row("Email", email);
  row("URL", process.env.BOOKING_LOGIN_URL || red("(.env yo'q!)"));
  row(
    "Proxy",
    process.env.PROXY_ENABLED === "true" ? green("ON (sticky)") : dim("off"),
  );
  row("Davlatlar", process.env.PROXY_COUNTRIES || dim("—"));
  row(
    "Headless",
    (process.env.BOOKING_HEADLESS ?? "true") === "false"
      ? yellow("false (ko'rinadi)")
      : "true",
  );
  hr();
  console.log("  " + bold("Bosqichlar:"));

  const res = await loginToBooking(email, password, {
    profileKey: email,
    onStep: logStep,
  });

  const ms = Date.now() - startedAt;

  hr();
  console.log(
    "  " + bold("📋  NATIJA") + gray(`  (${(ms / 1000).toFixed(1)}s)`),
  );
  hr();
  row("Login", res.ok ? "MUVAFFAQIYATLI ✓" : "BO'LMADI ✗", res.ok);
  row("Izoh", res.note);
  row("Email to'ldi", res.filledEmail ? "ha" : "yo'q", res.filledEmail);
  row("Parol to'ldi", res.filledPassword ? "ha" : "yo'q", res.filledPassword);
  row("Submit", res.submitted ? "ha" : "yo'q", res.submitted);
  row(
    "Captcha",
    res.captchaPresent ? (res.captchaSolved ? "o'tdi ✓" : "o'tmadi ✗") : "yo'q",
    res.captchaPresent ? res.captchaSolved : undefined,
  );
  row("Exit IP", res.exitIp || dim("—"));
  row("HTTP status", String(res.statusCode ?? "—"));
  row("Final URL", res.finalUrl || dim("—"));
  if (res.pageError) row("Xatolar", yellow(res.pageError));
  hr();
  console.log("");

  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(red("Test xatosi:"), e);
  process.exit(1);
});
