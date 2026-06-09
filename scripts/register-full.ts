// ====================================================================
//  REGISTER FULL — to'liq ro'yxatdan o'tish oqimi (generate -> submit -> activate)
// ====================================================================
//  register:test formani faqat TO'LDIRADI (bosmaydi). Bu skript esa TO'LIQ
//  oqimni bajaradi:
//    1) YANGI email + parol + telefon generatsiya qiladi (lib/identity.ts).
//       Email catch-all domen (uzbekvisa.uz) — aktivatsiya xati
//       info@uzbekvisa.uz qutiga tushadi.
//    2) registerToBooking(..., { submit: true }) — formani to'ldirib, Register
//       tugmasini BOSADI (yangi VFS akkaunt yaratiladi).
//    3) mail-listener (IMAP) orqali aktivatsiya xatini kutadi va linkni
//       userning SHU register profilida (bir xil sticky IP) ochadi — register
//       to'liq tugaydi.
//    4) LOGIN (tekshiruv) — o'sha email/parol bilan booking saytiga kiradi
//       (SHU gmail profili + sticky IP). Login kirsa => akkaunt TASDIQLANDI.
//
//  Ishga tushirish:
//    npm run register:full                 (hammasini generatsiya qiladi, TO'LIQ)
//    npm run register:full -- dry          (faqat to'ldiradi, BOSMAYDI — xavfsiz)
//    npm run register:full -- nologin      (register+aktivatsiya, login tekshiruvisiz)
//    npm run register:full -- a@b.uz P@ss 901234567   (o'z ma'lumotlaringiz bilan)
//
//  DIQQAT: "dry" bo'lmasa HAQIQIY akkaunt yaratiladi va VFS email yuboradi.
//  Ortiqcha urinmang — IP/akkaunt rate-limit (429) bo'lishi mumkin.
// ====================================================================

import "dotenv/config";
import path from "path";
import {
  registerToBooking,
  runActivation,
  loginToBooking,
} from "../lib/automation";
import { sanitizeProfileKey } from "../lib/automation";
import { generateIdentity } from "../lib/identity";
import { isMailListenerEnabled, getImapConfig } from "../lib/mail-listener";

// registerToBooking natijasi turi (alohida import qilmasdan olamiz).
type RegResult = Awaited<ReturnType<typeof registerToBooking>>;

// Vaqtinchalik (qayta urinsa bo'ladigan) blokmi? VFS config API 429 bo'lsa
// forma o'rniga page-not-found ("Session Expired") sahifasini chiqaradi — boshqa
// IP bilan qayta urinib ko'rishga arziydi. Akkaunt yaratilgan (submitted) — yo'q.
function isTransientBlock(r: RegResult): boolean {
  if (r.submitted) return false;
  const hay =
    `${r.note} ${r.pageError || ""} ${r.finalUrl || ""}`.toLowerCase();
  return /page-not-found|rate-limit|429|nosuchkey|boshqa ip|yangi ip|config api|tunnel|proxy|ulanmadi|uzild/.test(
    hay,
  );
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ── Rang yordamchilari (LOG_COLOR=false bo'lsa o'chadi). ANSI kodlari pipe'da
//    ham ishlaydi (ASCII). Belgilar FAQAT ASCII — PowerShell pipe UTF-8 ni
//    buzadi (box-drawing/emoji "тФА" bo'lib ketadi), shuning uchun [OK]/->/= .
const COLOR = (process.env.LOG_COLOR || "true").toLowerCase() !== "false";
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c("1", s);
const dim = (s: string) => c("2", s);
const green = (s: string) => c("32", s);
const red = (s: string) => c("31", s);
const yellow = (s: string) => c("33", s);
const cyan = (s: string) => c("36", s);
const gray = (s: string) => c("90", s);

const W = 60;
const rule = (ch = "=") => console.log(gray(ch.repeat(W)));
const now = () => new Date().toTimeString().slice(0, 8);

function row(label: string, value: string, good?: boolean) {
  const v = good === true ? green(value) : good === false ? red(value) : value;
  console.log(`  ${gray((label + ":").padEnd(18))} ${v}`);
}

let stepNo = 0;
const startedAt = Date.now();
function logStep(msg: string) {
  stepNo += 1;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1).padStart(5);
  const ok =
    /✓|o'tdi|kiritildi|ochildi|bosildi|tanlandi|tayyor|belgilandi/i.test(msg);
  const bad = /✗|topilmadi|o'tmadi|xato|chala|nofaol|bloklandi/i.test(msg);
  const icon = bad ? red("[x]") : ok ? green("[OK]") : cyan("[..]");
  const num = gray(`#${String(stepNo).padStart(2, "0")}`);
  // ASCII-ga moslash: matn ichidagi ✓/✗ ni almashtiramiz (pipe buzmasin).
  const clean = msg.replace(/✓/g, "(ok)").replace(/✗/g, "(x)");
  console.log(
    `  ${num} ${gray(`[${elapsed}s]`)} ${icon} ${bad ? red(clean) : clean}`,
  );
}

function parseArgs(argv: string[]): {
  dry: boolean;
  noLogin: boolean;
  email?: string;
  password?: string;
  phone?: string;
} {
  const rest: string[] = [];
  let dry = false;
  let noLogin = false;
  for (const a of argv) {
    const low = a.toLowerCase();
    if (low === "dry" || low === "--dry" || low === "nosubmit") dry = true;
    else if (low === "nologin" || low === "--nologin" || low === "skiplogin")
      noLogin = true;
    else rest.push(a);
  }
  return { dry, noLogin, email: rest[0], password: rest[1], phone: rest[2] };
}

async function main() {
  const {
    dry,
    noLogin,
    email: argEmail,
    password: argPass,
    phone: argPhone,
  } = parseArgs(process.argv.slice(2));

  // Ma'lumotlar: argument berilsa o'shani, aks holda generatsiya qilamiz.
  // Generatsiya rejimida vaqtinchalik blokda har urinishda YANGI shaxs (=> yangi
  // sticky IP) olamiz — shu sabab let.
  let gen = generateIdentity();
  let email = argEmail || gen.email;
  let password = argPass || gen.password;
  let phone = argPhone || gen.phone;
  let fullPhone = argPhone
    ? `+998${argPhone.replace(/^\+?998/, "")}`
    : gen.fullPhone;
  const allGenerated = !argEmail && !argPass && !argPhone;

  // Har bir yaratilgan gmail O'ZINING alohida Chrome profilida ochiladi —
  // ko'rinadigan (loyiha ichidagi) papka: uploads/register-profiles/<gmail>.
  // (Standart holatda profil Windows temp ichida yashirin bo'lardi.)
  const profileBase = path.resolve(
    process.cwd(),
    "uploads",
    "register-profiles",
  );
  const profileDirOf = (mail: string) =>
    path.join(profileBase, sanitizeProfileKey(mail));

  const imap = getImapConfig();
  const listenerOn = isMailListenerEnabled();

  console.log("");
  rule();
  console.log(
    "  " + bold("REGISTER FULL — to'liq oqim (generate -> submit -> activate)"),
  );
  rule();
  row("Vaqt", now());
  row("Register URL", process.env.BOOKING_REGISTER_URL || red("(.env yo'q!)"));
  row(
    "Gmail listener",
    listenerOn ? green(`ON (${imap?.user})`) : red("OFF (IMAP sozlanmagan)"),
    listenerOn,
  );
  row(
    "Proxy",
    process.env.PROXY_ENABLED === "true"
      ? green(`ON (${process.env.PROXY_COUNTRIES || "—"}, sticky)`)
      : dim("off"),
  );
  row("Chrome profil", dim(profileBase + path.sep + "<gmail>"));
  row(
    "Rejim",
    dry
      ? yellow("DRY — faqat to'ldiradi (BOSMAYDI)")
      : red("FUL — Register BOSILADI"),
  );
  rule("-");

  // ── 1-BOSQICH: REGISTER ──────────────────────────────────────────
  console.log("  " + bold("1) Register formasi:"));
  // VFS config API 429 bo'lsa forma o'rniga page-not-found ("Session Expired")
  // chiqaradi — YANGI shaxs (=> yangi sticky IP) bilan qayta urinamiz (faqat
  // generatsiya rejimida; o'z ma'lumotlaringizda IP o'zgarmaydi).
  const maxAttempts = allGenerated
    ? Math.max(1, Number(process.env.REGISTER_FULL_RETRIES || "3"))
    : 1;
  let reg!: RegResult;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    row(
      `Urinish #${attempt}/${maxAttempts}`,
      `${bold(email)}  ${gray("|")}  ${fullPhone}` +
        (allGenerated ? gray("  (generatsiya)") : ""),
    );
    row("Chrome profil", dim(profileDirOf(email)));
    reg = await registerToBooking(email, password, phone, {
      profileKey: email,
      submit: !dry,
      onStep: logStep,
      cdpProfileBase: profileBase,
      cdpFreshProfile: true,
    });
    const success = dry ? reg.ok : reg.submitted;
    if (success || attempt >= maxAttempts || !isTransientBlock(reg)) break;
    // Vaqtinchalik blok — biroz kutib, yangi IP (yangi email) bilan qayta.
    console.log(
      "  " +
        yellow(
          `[..] Blok aniqlandi (${reg.note.slice(0, 40)}) — yangi IP bilan qayta urinish (${attempt + 1}/${maxAttempts})...`,
        ),
    );
    await sleep(Number(process.env.REGISTER_FULL_RETRY_PAUSE_MS || "4000"));
    stepNo = 0; // qadam raqamlari yangi urinishda 1 dan boshlansin
    gen = generateIdentity();
    email = gen.email;
    password = gen.password;
    phone = gen.phone;
    fullPhone = gen.fullPhone;
  }

  rule("-");
  console.log("  " + bold("Register natijasi:"));
  row("Holat", reg.ok ? "TAYYOR" : "BO'LMADI", reg.ok);
  row("Izoh", reg.note);
  row(
    "Email/parol/confirm",
    `${reg.filledEmail ? "ok" : "x"}/${reg.filledPassword ? "ok" : "x"}/${reg.filledConfirm ? "ok" : "x"}`,
  );
  row(
    "Dial+telefon",
    `${reg.dialCodeSelected ? "+998 ok" : "x"} / ${reg.filledPhone ? "ok" : "x"}`,
  );
  row("Checkboxlar", `${reg.checkboxesChecked}/${reg.checkboxesTotal}`);
  row(
    "Captcha",
    reg.captchaPresent ? (reg.captchaSolved ? "o'tdi" : "o'tmadi") : "yo'q",
    reg.captchaPresent ? reg.captchaSolved : undefined,
  );
  row(
    "Register tugma",
    reg.registerButtonFound
      ? reg.registerButtonEnabled
        ? "faol"
        : "nofaol"
      : "topilmadi",
    reg.registerButtonFound ? reg.registerButtonEnabled : false,
  );
  row("Bosildi (submit)", reg.submitted ? "ha" : "yo'q", reg.submitted);
  row("HTTP status", String(reg.statusCode ?? "—"));
  if (reg.pageError) row("Xatolar", yellow(reg.pageError));

  // ── 2-BOSQICH: AKTIVATSIYA (faqat submit bo'lsa) ─────────────────
  let activated = false;
  let activationNote = "";
  if (dry) {
    rule("-");
    console.log(
      "  " + dim("DRY rejim — submit yo'q, aktivatsiya o'tkazib yuborildi."),
    );
  } else if (!reg.submitted) {
    rule("-");
    console.log(
      "  " + yellow("Register bosilmadi — aktivatsiya o'tkazib yuborilmaydi."),
    );
    activationNote = "Register submit bo'lmadi";
  } else if (!listenerOn) {
    rule("-");
    console.log(
      "  " + yellow("IMAP sozlanmagan — aktivatsiya xatini kutib bo'lmaydi."),
    );
    activationNote = "IMAP sozlanmagan";
  } else {
    rule("-");
    console.log("  " + bold("2) Aktivatsiya (gmail listener):"));
    const waitMin = Math.round(
      Number(process.env.ACTIVATION_TIMEOUT_MS || 180000) / 60000,
    );
    logStep(
      `Aktivatsiya xati kutilmoqda (${email}, ~${waitMin} daqiqagacha)...`,
    );
    let mailPolled = false;
    const act = await runActivation(
      {
        surname: gen.surname,
        name: gen.name,
        passportNumber: "",
        generatedEmail: email,
      },
      {
        profileKey: email,
        cdpProfileBase: profileBase,
        onMailPoll: ({ elapsedMs, remainingMs, newScanned }) => {
          mailPolled = true;
          const sec = String(Math.round(elapsedMs / 1000)).padStart(3);
          const rem = Math.round(remainingMs / 1000);
          const extra = newScanned ? `, ${newScanned} yangi xat` : "";
          process.stdout.write(
            `\r  ${gray(`[${sec}s]`)} ${cyan("[..]")} ` +
              `Pochta tekshirilmoqda... (${rem}s qoldi${extra})        `,
          );
        },
      },
    );
    if (mailPolled) process.stdout.write("\n");
    activated = act.ok && !!act.link;
    activationNote = act.note;
    logStep(
      act.ok
        ? act.link
          ? "Aktivatsiya linki ochildi (ok)"
          : "Aktivatsiya o'tkazib yuborildi"
        : "Aktivatsiya bo'lmadi (x)",
    );
    rule("-");
    console.log("  " + bold("Aktivatsiya natijasi:"));
    row(
      "Holat",
      act.ok ? (act.link ? "AKTIVLASHDI" : "O'TKAZILDI") : "BO'LMADI",
      act.ok,
    );
    row("Izoh", act.note);
    row("Xat keldi", act.link ? "ha" : "yo'q", !!act.link);
    if (act.link)
      row(
        "Link",
        dim(act.link.slice(0, 70) + (act.link.length > 70 ? "..." : "")),
      );
    row("HTTP status", String(act.statusCode ?? "—"));
    row("Exit IP", act.exitIp || dim("—"));
    if (act.pageError) row("Xatolar", yellow(act.pageError));
  }
  // ── 3-BOSQICH: LOGIN (tekshiruv) ──────────────────────────────
  // Aktivatsiyadan keyin O'SHA email/parol bilan booking saytiga kiramiz —
  // SHU gmail profili (uploads/register-profiles/<gmail>) + sticky IP qayta
  // ishlatiladi (toza, izolyatsiyalangan sessiya). Login kirsa => akkaunt
  // HAQIQATAN ishlayapti (TASDIQLANDI). 429201 chiqsa — akkaunt bor, lekin
  // vaqtincha cooldownsda (boshqa IP yordam bermaydi).
  let loginAttempted = false;
  let loggedIn = false;
  let loginNote = "";
  const loginUrlSet = !!(process.env.BOOKING_LOGIN_URL || "").trim();
  if (!dry && reg.submitted && activated) {
    if (noLogin) {
      rule("-");
      console.log(
        "  " + dim("Login tekshiruvi o'tkazib yuborildi (--nologin)."),
      );
    } else if (!loginUrlSet) {
      rule("-");
      console.log(
        "  " +
          yellow(
            "BOOKING_LOGIN_URL sozlanmagan — login tekshiruvi o'tkazib yuborildi.",
          ),
      );
      loginNote = "BOOKING_LOGIN_URL yo'q";
    } else {
      rule("-");
      console.log("  " + bold("3) Login (tekshiruv):"));
      stepNo = 0; // qadam raqamlari login uchun 1 dan boshlansin
      loginAttempted = true;
      const login = await loginToBooking(email, password, {
        profileKey: email,
        // Register/aktivatsiya bilan BIR XIL profil + sticky IP (izolyatsiya).
        cdpProfileBase: profileBase,
        cdpFreshProfile: false,
        onStep: logStep,
      });
      loggedIn = login.ok;
      loginNote = login.note;
      logStep(
        login.ok
          ? "Login kirdi — akkaunt TASDIQLANDI (ok)"
          : "Login bo'lmadi (x)",
      );
      rule("-");
      console.log("  " + bold("Login natijasi:"));
      row("Holat", login.ok ? "KIRDI — TASDIQLANDI" : "BO'LMADI", login.ok);
      row("Izoh", login.note);
      row(
        "Email/parol",
        `${login.filledEmail ? "ok" : "x"} / ${login.filledPassword ? "ok" : "x"}`,
      );
      row(
        "Bosildi (Sign In)",
        login.submitted ? "ha" : "yo'q",
        login.submitted,
      );
      row("HTTP status", String(login.statusCode ?? "—"));
      if (login.finalUrl)
        row(
          "Final URL",
          dim(
            login.finalUrl.slice(0, 70) +
              (login.finalUrl.length > 70 ? "..." : ""),
          ),
        );
      row(
        "Token",
        login.token ? `ha (${login.tokenSource})` : dim("yo'q"),
        !!login.token,
      );
      row("Exit IP", login.exitIp || dim("—"));
      if (login.pageError) row("Xatolar", yellow(login.pageError));
    }
  }
  // ── YAKUNIY XULOSA ───────────────────────────────────────────────
  const ms = Date.now() - startedAt;
  const fullOk = dry ? reg.ok : reg.submitted && activated;
  rule();
  console.log("  " + bold("XULOSA") + gray(`  (${(ms / 1000).toFixed(1)}s)`));
  rule();
  row("Email", email);
  row("Parol", bold(password));
  row("Telefon", fullPhone);
  if (dry) {
    row("Natija", reg.ok ? "FORMA TAYYOR (dry)" : "FORMA CHALA", reg.ok);
  } else {
    row("Register bosildi", reg.submitted ? "ha" : "yo'q", reg.submitted);
    row("Aktivatsiya", activated ? "tugadi" : "tugamadi", activated);
    if (loginAttempted)
      row(
        "Login tekshiruvi",
        loggedIn ? "KIRDI — TASDIQLANDI" : "kira olmadi",
        loggedIn,
      );
    row(
      "To'liq register",
      fullOk ? (loggedIn ? "HA — TASDIQLANDI (login)" : "HA — TUGADI") : "YO'Q",
      fullOk,
    );
    if (!fullOk && activationNote) row("Sabab", yellow(activationNote));
    if (fullOk && loginAttempted && !loggedIn && loginNote)
      row("Login izoh", yellow(loginNote));
  }
  rule();
  console.log(
    "  " + dim("Email/parol yuqorida — kerak bo'lsa saqlab qo'ying."),
  );
  rule();
  console.log("");

  process.exit(fullOk ? 0 : 1);
}

main().catch((e) => {
  console.error(red("Test xatosi:"), e);
  process.exit(1);
});
