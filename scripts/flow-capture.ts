// ====================================================================
//  FLOW CAPTURE CLI — slot ochilgandan keyingi sahifalarni yozib olish
// ====================================================================
//  Brauzer OCHILADI va ochiq turadi. SIZ qo'lda formalarni to'ldirib,
//  3-4 sahifani bosib o'tasiz; tool fonda HAMMASINI yozadi (skrinshot +
//  HTML + tuzilma JSON + network payload/javob + PDF + log + manifest).
//
//  Ishlatish:
//    npm run flow:capture                 # 10 daqiqa, PASSIV (login qo'lda)
//    npm run flow:capture -- 20           # 20 daqiqa ochiq
//    npm run flow:capture -- --restore    # saqlangan token bilan dashboard
//    npm run flow:capture -- --url https://visa.vfsglobal.com/uzb/en/lva/dashboard
//    npm run flow:capture -- --proxy --heartbeat 15
//
//  PASSIV rejim (default): tool HECH NARSANI avtomatik qilmaydi — login va
//  navigatsiyani SIZ qo'lda qilasiz. "Session Expired (401)" chiqsa kutadi
//  (avtomatik login yo'q). Har sahifa tartib bilan yoziladi, brauzer yopilguncha.
//
//  Brauzer ochiq turganda:
//    Enter bosing  -> ayni sahifani qo'lda SNAPSHOT qiladi
//    q + Enter     -> erta tugatadi (manifest saqlanadi)
//
//  Yozuvlar: uploads/flow-capture/<vaqt>/  (screenshots, pages, network,
//  downloads, log.txt, manifest.json)
// ====================================================================

import "dotenv/config";

// Capture uchun brauzer KO'RINISHI shart (qo'lda ishlaysiz). Majburlab yoqamiz.
process.env.BOOKING_HEADLESS = "false";

import {
  runFlowCapture,
  type CaptureLevel,
} from "../lib/automation/flow-capture";

const COLOR = (process.env.LOG_COLOR || "true").toLowerCase() !== "false";
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c("32", s);
const red = (s: string) => c("31", s);
const yellow = (s: string) => c("33", s);
const cyan = (s: string) => c("36", s);
const blue = (s: string) => c("34", s);
const gray = (s: string) => c("90", s);
const bold = (s: string) => c("1", s);
const W = 64;
const rule = (ch = "=") => console.log(gray(ch.repeat(W)));
const center = (s: string) => {
  const len = s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const pad = Math.max(0, Math.floor((W - len) / 2));
  console.log(" ".repeat(pad) + s);
};

function hhmmss(): string {
  return new Date().toTimeString().slice(0, 8);
}

// Daraja -> rang + ASCII tag (emoji YO'Q — PowerShell pipe'da buziladi).
const TAG: Record<CaptureLevel, (s: string) => string> = {
  info: (s) => cyan(s),
  nav: (s) => blue(s),
  snap: (s) => green(s),
  net: (s) => gray(s),
  pdf: (s) => yellow(s),
  warn: (s) => yellow(s),
  err: (s) => red(s),
};
const LABEL: Record<CaptureLevel, string> = {
  info: "[i] ",
  nav: "[>] ",
  snap: "[S] ",
  net: "[n] ",
  pdf: "[PDF]",
  warn: "[!] ",
  err: "[x] ",
};

function logLine(level: CaptureLevel, msg: string) {
  const tag = TAG[level](LABEL[level].padEnd(5));
  console.log(`${gray(hhmmss())} ${tag} ${msg}`);
}

function parseArgs(argv: string[]) {
  let minutes = 10;
  let url: string | null = null;
  let proxy = false;
  // Token tiklash DEFAULT O'CHIQ — passiv rejim (login'ni qo'lda qilasiz).
  // --restore bersangiz, saqlangan token bilan dashboard'ga o'tadi.
  let restore = false;
  let heartbeatSec = 0;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url" || a === "-u") url = argv[++i] || null;
    else if (a === "--proxy") proxy = true;
    else if (a === "--restore") restore = true;
    else if (a === "--no-restore") restore = false;
    else if (a === "--heartbeat" || a === "-h")
      heartbeatSec = Number(argv[++i] || 0);
    else if (a === "--min" || a === "-m")
      minutes = Number(argv[++i] || minutes);
    else if (/^\d+$/.test(a)) minutes = Number(a);
  }
  if (!Number.isFinite(minutes) || minutes <= 0) minutes = 10;
  return { minutes, url, proxy, restore, heartbeatSec };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("");
  rule();
  center(bold("FLOW CAPTURE  ::  sahifa + network yozuvchi"));
  rule();
  console.log(`  ${gray("Vaqt".padEnd(14))} ${hhmmss()}`);
  console.log(`  ${gray("Ochiq turadi".padEnd(14))} ${args.minutes} daqiqa`);
  console.log(
    `  ${gray("Boshlanish".padEnd(14))} ${
      args.url || (args.restore ? "token bo'lsa dashboard" : "login (qo'lda)")
    }`,
  );
  console.log(
    `  ${gray("Proxy".padEnd(14))} ${args.proxy ? "ON" : "off (to'g'ridan-to'g'ri)"}`,
  );
  console.log(
    `  ${gray("Rejim".padEnd(14))} ${
      args.restore ? "token tiklash (--restore)" : "PASSIV (login qo'lda)"
    }`,
  );
  console.log(
    `  ${gray("Profil".padEnd(14))} ${process.env.SLOT_MONITOR_EMAIL || "flow-capture"}`,
  );
  rule("-");
  console.log(
    `  ${green("Enter")} = qo'lda snapshot    ${red("q + Enter")} = tugatish`,
  );
  console.log(
    `  ${gray("Login va formalarni QO'LDA qiling; har qadam avtomatik yoziladi.")}`,
  );
  rule();
  console.log("");

  const res = await runFlowCapture({
    startUrl: args.url,
    openMs: args.minutes * 60_000,
    proxy: args.proxy,
    restore: args.restore,
    heartbeatMs: args.heartbeatSec * 1000,
    interactive: true,
    log: logLine,
  });

  console.log("");
  rule();
  center(bold("YAKUN"));
  rule();
  console.log(`  ${gray("Tablar".padEnd(14))} ${green(String(res.tabs))}`);
  console.log(
    `  ${gray("Snapshotlar".padEnd(14))} ${green(String(res.snapshots))}`,
  );
  console.log(`  ${gray("Network".padEnd(14))} ${String(res.requests)}`);
  console.log(`  ${gray("Yuklab olindi".padEnd(14))} ${String(res.downloads)}`);
  console.log(
    `  ${gray("Davomiyligi".padEnd(14))} ${(res.durationMs / 1000).toFixed(0)}s`,
  );
  console.log(`  ${gray("Papka".padEnd(14))} ${cyan(res.dir)}`);
  console.log(`  ${gray("Manifest".padEnd(14))} ${res.manifestPath}`);
  rule();

  process.exit(0);
}

main().catch((e) => {
  console.error(red("Xato:"), e);
  process.exit(1);
});
