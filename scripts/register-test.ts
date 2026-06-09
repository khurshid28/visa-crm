// Booking saytida REGISTER (yangi akkaunt) testi — login:test'ning aynan
// o'xshashi, lekin ro'yxatdan o'tish formasi uchun. Chiroyli, bosqichma-bosqich log.
//
// DIQQAT: bu test "Register" tugmasini BOSMAYDI — formani to'liq to'ldirib,
// tugma bosishga TAYYOR holatgacha olib boradi (so'rovga ko'ra). Bosish uchun
// oxirida 4-argument sifatida "submit" bering (pastga qarang).
//
// Ishga tushirish:
//   npm run register:test
//   npm run register:test -- yangi@gmail.com Parol123@ 901234567
//   npm run register:test -- yangi@gmail.com Parol123@ 901234567 submit   (BOSADI)
//   npx tsx scripts/register-test.ts
//
// Argumentlar:
//   1) email   — ro'yxatdan o'tkaziladigan gmail (bo'sh bo'lsa default)
//   2) parol   — bo'sh bo'lsa AVTOMATIK kuchli parol yaratiladi va chop etiladi
//   3) telefon — +998siz lokal raqam (901234567) yoki to'liq (+998901234567)
//   4) "submit"— faqat shu so'z berilsa Register BOSILADI (default: bosilmaydi)
//
// .env dan ishlatadigan narsalar:
//   BOOKING_REGISTER_URL       — register sahifasi
//   PROXY_*                    — sticky residential IP (har user o'z IP'si)
//   BOOKING_HEADLESS=false     — brauzerni ko'rib turish (debug)
//   BOOKING_CAPTCHA_TIMEOUT_MS — Turnstile token kutish vaqti
//   BOOKING_KEEP_OPEN_MS       — natijani ko'rish uchun brauzerni ushlab turish (ms)

import "dotenv/config";
import { registerToBooking } from "../lib/automation";

// Windows konsolini UTF-8 ga o'tkazamiz — aks holda emoji (📝) va chiziqlar (─)
// Cyrillic kod sahifasida "тФА / ЁЯУЭ" bo'lib buziladi. chcp 65001 + Node stream
// kodlashini UTF-8 qilamiz (chiroyli chiqishi uchun).
if (process.platform === "win32") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("child_process").execSync("chcp 65001", {
      stdio: "ignore",
      shell: "cmd.exe",
    });
  } catch {
    /* chcp bo'lmasa ham davom etamiz */
  }
}
try {
  (process.stdout as NodeJS.WriteStream).setDefaultEncoding?.("utf8");
  (process.stderr as NodeJS.WriteStream).setDefaultEncoding?.("utf8");
} catch {
  /* jim */
}

const DEFAULT_EMAIL = "khurshidi2827@gmail.com";
const DEFAULT_PHONE = "901234567";

// Kuchli parol yaratadi (katta/kichik harf + raqam + maxsus belgi, VFS talabi).
function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digit = "23456789";
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  const body = Array.from({ length: 5 }, () => pick(lower)).join("");
  const nums = Array.from({ length: 3 }, () => pick(digit)).join("");
  return pick(upper) + body + nums + "@"; // masalan: "Xmkprt284@"
}

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
  const ok =
    /✓|o'tdi|kiritildi|ochildi|bosildi|tanlandi|tayyor|belgilandi/i.test(msg);
  const bad = /✗|topilmadi|o'tmadi|xato|chala|nofaol/i.test(msg);
  const icon = bad ? red("✗") : ok ? green("✓") : cyan("•");
  const num = gray(`#${String(stepNo).padStart(2, "0")}`);
  console.log(
    `  ${num} ${gray(`[${elapsed}s]`)} ${icon} ${bad ? red(msg) : msg}`,
  );
}

function row(label: string, value: string, good?: boolean) {
  const v = good === true ? green(value) : good === false ? red(value) : value;
  console.log(`  ${gray(label.padEnd(18))} ${v}`);
}

async function main() {
  const email = process.argv[2] || DEFAULT_EMAIL;
  const password = process.argv[3] || generatePassword();
  const phone = process.argv[4] || DEFAULT_PHONE;
  const submit = (process.argv[5] || "").toLowerCase() === "submit";
  const generated = !process.argv[3];

  console.log("");
  hr();
  console.log("  " + bold("📝  BOOKING REGISTER TEST"));
  hr();
  row("Vaqt", now());
  row("Email", email);
  row(
    "Parol",
    bold(password) + (generated ? gray("  (avtomatik yaratildi)") : ""),
  );
  row("Telefon", "+998 " + phone.replace(/^\+?998/, ""));
  row("URL", process.env.BOOKING_REGISTER_URL || red("(.env yo'q!)"));
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
  row(
    "Register bosish",
    submit ? red("HA (submit) — BOSILADI") : green("YO'Q — tayyorgacha"),
  );
  hr();
  console.log("  " + bold("Bosqichlar:"));

  const res = await registerToBooking(email, password, phone, {
    profileKey: email,
    onStep: logStep,
    submit,
  });

  const ms = Date.now() - startedAt;

  hr();
  console.log(
    "  " + bold("📋  NATIJA") + gray(`  (${(ms / 1000).toFixed(1)}s)`),
  );
  hr();
  row("Holat", res.ok ? "TAYYOR ✓" : "BO'LMADI ✗", res.ok);
  row("Izoh", res.note);
  row("Email to'ldi", res.filledEmail ? "ha" : "yo'q", res.filledEmail);
  row("Parol to'ldi", res.filledPassword ? "ha" : "yo'q", res.filledPassword);
  row("Confirm to'ldi", res.filledConfirm ? "ha" : "yo'q", res.filledConfirm);
  row(
    "Dial code (+998)",
    res.dialCodeSelected ? "tanlandi" : "yo'q",
    res.dialCodeSelected,
  );
  row("Telefon to'ldi", res.filledPhone ? "ha" : "yo'q", res.filledPhone);
  row(
    "Checkboxlar",
    `${res.checkboxesChecked}/${res.checkboxesTotal} belgilandi`,
    res.checkboxesTotal > 0 && res.checkboxesChecked === res.checkboxesTotal,
  );
  row(
    "Captcha",
    res.captchaPresent ? (res.captchaSolved ? "o'tdi ✓" : "o'tmadi ✗") : "yo'q",
    res.captchaPresent ? res.captchaSolved : undefined,
  );
  row(
    "Register tugma",
    res.registerButtonFound
      ? res.registerButtonEnabled
        ? "TAYYOR (faol) ✓"
        : "nofaol ✗"
      : "topilmadi ✗",
    res.registerButtonFound ? res.registerButtonEnabled : false,
  );
  row("Bosildi", res.submitted ? "ha" : "yo'q (so'rovga ko'ra)");
  row("Exit IP", res.exitIp || dim("—"));
  row("HTTP status", String(res.statusCode ?? "—"));
  row("Final URL", res.finalUrl || dim("—"));
  if (res.pageError) row("Xatolar", yellow(res.pageError));
  hr();
  console.log(
    "  " +
      dim("Ishlatilgan parol: ") +
      bold(password) +
      dim("  (gmail kodini keyin tekshiramiz)"),
  );
  hr();
  console.log("");

  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(red("Test xatosi:"), e);
  process.exit(1);
});
