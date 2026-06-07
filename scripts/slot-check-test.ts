// VFS KALENDAR (slot) tekshiruvi testi — bitta marta ishlatadi.
// Login -> application-detail -> 3 dropdown -> bo'sh slot bormi.
// Saqlangan token bilan ishlaydi; token 401 bersa qayta login qiladi.
//
// Ishga tushirish:
//   npm run slot:check
//   npm run slot:check -- "VFS GLOBAL SERVICES UBKN" "Latvia Long Stay/Visa D" "Cargo drivers (Visa D) Uzbek, Turkmen"
//
// .env dan: SLOT_MONITOR_EMAIL/PASSWORD, BOOKING_CALENDAR_*, BOOKING_CHROME_CDP,
// SLOT_CHECK_PROXY, SLOT_MONITOR_PROFILE_DIR.

import "dotenv/config";
import { detectCalendar } from "../lib/automation";

const COLOR = (process.env.LOG_COLOR || "true").toLowerCase() !== "false";
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c("32", s);
const red = (s: string) => c("31", s);
const cyan = (s: string) => c("36", s);
const gray = (s: string) => c("90", s);
const bold = (s: string) => c("1", s);
const hr = () => console.log(gray("─".repeat(54)));

function row(label: string, value: string, good?: boolean) {
  const v = good === true ? green(value) : good === false ? red(value) : value;
  console.log(`  ${gray(label.padEnd(16))} ${v}`);
}

async function main() {
  const centre = process.argv[2];
  const category = process.argv[3];
  const subCategory = process.argv[4];

  console.log("");
  hr();
  console.log(`  ${bold("📅  VFS KALENDAR (SLOT) TEKSHIRUVI")}`);
  hr();
  row("Vaqt", new Date().toTimeString().slice(0, 8));
  row("Email", process.env.SLOT_MONITOR_EMAIL || "—");
  row(
    "URL",
    process.env.BOOKING_CALENDAR_URL ||
      "https://visa.vfsglobal.com/uzb/en/lva/application-detail",
  );
  row("CDP", process.env.BOOKING_CHROME_CDP === "true" ? "ON" : "off");
  row(
    "Proxy",
    (process.env.SLOT_CHECK_PROXY || "false").toLowerCase() === "true"
      ? "ON"
      : "off (trafik tejash)",
  );
  hr();

  const t0 = Date.now();
  const r = await detectCalendar({
    centre: centre ?? undefined,
    category: category ?? undefined,
    subCategory: subCategory ?? undefined,
  });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`  ${bold("📋  NATIJA")}  ${gray(`(${sec}s)`)}`);
  hr();
  row("Slot ochiq", r.open ? "HA ✓" : "yo'q", r.open);
  row("Login", r.loggedIn ? "bor ✓" : "yo'q ✗", r.loggedIn);
  row("Izoh", r.note);
  row("Kalendar", r.calendarFound ? "topildi" : "yo'q");
  row("Bo'sh kunlar", String(r.availableDates.length));
  if (r.availableDates.length)
    row("Kunlar", r.availableDates.slice(0, 12).join(", "));
  row("HTTP status", String(r.statusCode ?? "—"));
  row("Exit IP", r.exitIp || "—");
  row("Final URL", r.finalUrl);
  row("Skrinshot", r.screenshotPath || "—");
  hr();

  process.exit(r.open ? 0 : 0);
}

main().catch((e) => {
  console.error(red("Xato:"), e);
  process.exit(1);
});
