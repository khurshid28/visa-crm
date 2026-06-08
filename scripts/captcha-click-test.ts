// CAPTCHA OS-KLIK TESTI — Turnstile checkbox'ga FIZIK OS-klikni sinaydi.
// Auto-pass'ni KUTMAYDI: brauzerni ochib, login sahifasiga o'tib, Turnstile
// widget render bo'lishi bilan kursorni checkbox ustiga olib borib BOSADI.
// Kursor harakatini KO'Z bilan ko'rasiz va klik ishlayotganini tekshirasiz.
//
// Ishga tushirish:
//   npm run captcha:click
//
// .env: BOOKING_OS_CLICK="true", BOOKING_HEADLESS="false", BOOKING_CHROME_CDP="true".
// Alohida "captcha-test" profil ishlatadi (toza cookie => interaktiv "Verify you
// are human" checkbox chiqish ehtimoli yuqori). Slot-monitor profiliga tegmaydi.

import "dotenv/config";
import * as path from "path";
import { openBrowserContext, profileDirFor } from "../lib/automation/browser";
import {
  waitForCloudflareClear,
  forceOsClickTurnstile,
} from "../lib/automation/turnstile";
import { acceptCookies, fillFieldReliably } from "../lib/automation/page-utils";

const COLOR = (process.env.LOG_COLOR || "true").toLowerCase() !== "false";
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c("32", s);
const red = (s: string) => c("31", s);
const yellow = (s: string) => c("33", s);
const gray = (s: string) => c("90", s);
const bold = (s: string) => c("1", s);
const hr = () => console.log(gray("─".repeat(54)));
const step = (m: string) => console.log(`  ${gray("•")} ${m}`);

function loginUrl(): string {
  return (
    (process.env.BOOKING_LOGIN_URL || "").trim() ||
    "https://visa.vfsglobal.com/uzb/en/lva/login"
  );
}

function slotMonitorProfileBase(): string {
  const rel =
    (process.env.SLOT_MONITOR_PROFILE_DIR || "").trim() ||
    path.join("uploads", "slot-monitor-profiles");
  return path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
}

async function main() {
  // Alohida profil — slot-monitor profiliga tegmaydi. Toza cookie bilan ochsa
  // Cloudflare interaktiv "Verify you are human" checkbox ko'rsatishi ehtimoli
  // yuqori (aynan shuni test qilmoqchimiz).
  const profileKey = "captcha-test";

  // VFS Turnstile INVISIBLE rejimda — checkbox sahifa ochilganda EMAS, balki
  // Sign In bosilgandan KEYIN (Cloudflare challenge qilsa) chiqadi. Shu sababli
  // formani to'ldirib, Sign In bosib, KEYIN OS-klik qilamiz.
  const email = (process.env.SLOT_MONITOR_EMAIL || "").trim();
  const password = (process.env.SLOT_MONITOR_PASSWORD || "").trim();

  console.log("");
  hr();
  console.log(`  ${bold("🖱  CAPTCHA OS-KLIK TESTI")}`);
  hr();
  step(`URL: ${loginUrl()}`);
  step(`Email: ${email || red("(.env SLOT_MONITOR_EMAIL yo'q)")}`);
  step(
    `Parol: ${password ? "•".repeat(8) : red("(.env SLOT_MONITOR_PASSWORD yo'q)")}`,
  );
  step(`BOOKING_OS_CLICK = ${process.env.BOOKING_OS_CLICK || "(yo'q)"}`);
  step(`BOOKING_HEADLESS = ${process.env.BOOKING_HEADLESS || "(yo'q)"}`);
  step(`BOOKING_CHROME_CDP = ${process.env.BOOKING_CHROME_CDP || "(yo'q)"}`);
  step("Profil: captcha-test (toza cookie — interaktiv checkbox uchun)");
  hr();

  if (!email || !password) {
    console.log(
      red(
        "  .env'da SLOT_MONITOR_EMAIL va SLOT_MONITOR_PASSWORD bo'lishi shart — to'xtatildi.",
      ),
    );
    process.exit(1);
  }

  const session = await openBrowserContext(
    profileDirFor("login", profileKey),
    { profileKey, noProxy: true },
    { cdpProfileBase: slotMonitorProfileBase(), cdpFreshProfile: true },
  );
  const page = await session.context.newPage();

  try {
    step("Login sahifasi ochilmoqda…");
    await page
      .goto(loginUrl(), { waitUntil: "domcontentloaded", timeout: 45000 })
      .catch(() => {});

    step('Cloudflare "Just a moment" hal bo\'lishini kutamiz…');
    await waitForCloudflareClear(page).catch(() => {});

    if (await acceptCookies(page)) step("Cookie banner yopildi.");

    // Email/parolni to'ldiramiz — Sign In tugmasi faollashishi uchun.
    const emailSel = '#email, input[formcontrolname="username"]';
    await page
      .waitForSelector(emailSel, { state: "visible", timeout: 20000 })
      .catch(() => {});
    const emailEl = page.locator(emailSel).first();
    if ((await emailEl.count()) > 0) {
      await fillFieldReliably(page, emailEl, email);
      step("Email to'ldirildi.");
    } else {
      step(yellow("Email maydoni topilmadi."));
    }
    const passSel = '#password, input[formcontrolname="password"]';
    const passEl = page.locator(passSel).first();
    if ((await passEl.count()) > 0) {
      await fillFieldReliably(page, passEl, password);
      step("Parol to'ldirildi.");
    } else {
      step(yellow("Parol maydoni topilmadi."));
    }

    // Cookie banner Sign In'ni to'smasin.
    if (await acceptCookies(page)) step("Cookie banner yopildi (qayta).");

    // Sign In bosamiz — shundan KEYIN Cloudflare interaktiv challenge chiqaradi.
    step("Sign In bosilmoqda…");
    const signInBtn = page
      .locator(
        'button:has-text("Sign In"), button:has-text("Sign in"), button[type="submit"]',
      )
      .first();
    if ((await signInBtn.count()) > 0) {
      await signInBtn.click({ timeout: 8000 }).catch(() => {});
    } else {
      step(yellow("Sign In tugmasi topilmadi."));
    }

    // Sign In'dan keyin Turnstile widget (iframe) RENDER bo'lishini kutamiz —
    // token EMAS (auto-pass'ni kutmaymiz). Widget chiqishi bilan darrov bosamiz.
    step("Turnstile widget (Sign In'dan keyin) render bo'lishini kutamiz…");
    await page
      .waitForFunction(
        () => {
          const ifr = Array.from(document.querySelectorAll("iframe")).some(
            (f) => {
              const r = f.getBoundingClientRect();
              const cf = (f.getAttribute("src") || "")
                .toLowerCase()
                .includes("challenges.cloudflare");
              return cf && r.width > 10 && r.height > 10;
            },
          );
          return ifr;
        },
        { timeout: 20000 },
      )
      .catch(() =>
        step(yellow("widget topilmadi (timeout) — baribir urinaman")),
      );

    // DIAGNOSTIKA: sahifada aslida nima bor? (iframe / konteyner / input)
    const diag = await page
      .evaluate(() => {
        const iframes = Array.from(document.querySelectorAll("iframe")).map(
          (f) => {
            const r = f.getBoundingClientRect();
            return {
              src: (f.getAttribute("src") || "").slice(0, 60),
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          },
        );
        return {
          url: location.href,
          title: document.title,
          iframes,
          cfTurnstile: !!document.querySelector(".cf-turnstile"),
          widgetId: !!document.querySelector("#widgetId"),
          chlWidget: !!document.querySelector('[id^="cf-chl-widget"]'),
          tokenInput: !!document.querySelector(
            'input[name="cf-turnstile-response"]',
          ),
          emailField: !!document.querySelector(
            '#email, input[formcontrolname="username"]',
          ),
        };
      })
      .catch(() => null);
    if (diag) {
      step(`sahifa: ${diag.title || "(no title)"}`);
      step(`email maydoni: ${diag.emailField ? "bor" : "yo'q"}`);
      step(
        `cf-turnstile=${diag.cfTurnstile} #widgetId=${diag.widgetId} cf-chl-widget=${diag.chlWidget} tokenInput=${diag.tokenInput}`,
      );
      step(`iframe soni: ${diag.iframes.length}`);
      diag.iframes.forEach(
        (f: { w: number; h: number; src: string }, i: number) =>
          step(`  iframe[${i}] ${f.w}x${f.h}  src="${f.src}"`),
      );
    }

    // Skrinshot — ekranda nima borligini KO'RISH uchun.
    const shotDir = path.join(process.cwd(), "uploads", "slot-monitor");
    const shotPath = path.join(shotDir, `captcha-test-${Date.now()}.png`);
    await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {});
    step(`skrinshot: ${shotPath}`);

    hr();
    console.log(`  ${bold("→ FIZIK OS-KLIK boshlanmoqda")}`);
    hr();
    const r = await forceOsClickTurnstile(page, step);

    hr();
    console.log(`  ${bold("📋  NATIJA")}`);
    hr();
    console.log(
      `  OS-klik yoqilgan   ${r.enabled ? green("ha ✓") : red("yo'q ✗")}`,
    );
    console.log(
      `  checkbox o'lchandi ${r.measured ? green("ha ✓") : red("yo'q ✗")}`,
    );
    if (r.measured)
      console.log(`  koordinata         (${r.physX}, ${r.physY})`);
    console.log(`  token (klikdan oldin) ${r.tokenBefore ? "bor" : "yo'q"}`);
    console.log(
      `  token (klikdan keyin) ${
        r.tokenAfter ? green("BOR ✓") : red("yo'q ✗")
      }`,
    );
    if (!r.tokenBefore && r.tokenAfter)
      console.log(`  ${green("✓ KLIK ISHLADI — token klikdan keyin keldi!")}`);
    else if (r.tokenBefore)
      console.log(
        `  ${yellow("ℹ Auto-pass bo'ldi — kursor harakatini ko'rdingiz (klik mexanikasi OK).")}`,
      );
    else
      console.log(
        `  ${red("✗ Token kelmadi — skrinshot/kursorni tekshiring.")}`,
      );
    hr();

    // Brauzerni biroz ochiq qoldiramiz — natijani KO'Z bilan ko'rish uchun.
    const holdMs = Number(process.env.CAPTCHA_TEST_HOLD_MS || "6000");
    step(
      `Brauzer ${(holdMs / 1000).toFixed(0)}s ochiq qoladi (ko'rish uchun)…`,
    );
    await page.waitForTimeout(holdMs).catch(() => {});
  } finally {
    await session.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(red("Xato:"), e);
  process.exit(1);
});
