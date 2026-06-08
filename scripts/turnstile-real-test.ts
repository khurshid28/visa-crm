// HAQIQIY TURNSTILE OS-KLIK TESTI — Cloudflare'ning MAJBURIY interaktiv test
// sitekey'ini ishlatadi (3x00000000000000000000FF). Bu HAR DOIM interaktiv
// "Verify you are human" checkbox'ni chiqaradi — VFS akkaunt/IP blokidan
// MUSTAQIL. OS-klik (os-click.ps1) bilan haqiqiy cf-iframe checkbox'ni bosadi
// va token kelganini + HAR BOSQICH VAQTINI o'lchaydi.
//
// Ishga tushirish:
//   npm run turnstile:test
//
// .env: BOOKING_OS_CLICK="true", BOOKING_HEADLESS="false", BOOKING_CHROME_CDP="true".
// Tashqi VFS hammasi shart emas — faqat challenges.cloudflare.com'ga internet.

import "dotenv/config";
import * as http from "http";
import type { ConsoleMessage, Request } from "playwright";
import { openBrowserContext, profileDirFor } from "../lib/automation/browser";
import { forceOsClickTurnstile } from "../lib/automation/turnstile";

const COLOR = (process.env.LOG_COLOR || "true").toLowerCase() !== "false";
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c("32", s);
const red = (s: string) => c("31", s);
const yellow = (s: string) => c("33", s);
const gray = (s: string) => c("90", s);
const bold = (s: string) => c("1", s);
const hr = () => console.log(gray("─".repeat(54)));
const step = (m: string) => console.log(`  ${gray("•")} ${m}`);

// Cloudflare TEST sitekey'lari (docs.cloudflare.com/turnstile/troubleshooting/testing/):
//   1x00000000000000000000AA — har doim o'tadi (interaktiv emas)
//   2x00000000000000000000AB — har doim bloklaydi
//   3x00000000000000000000FF — MAJBURIY interaktiv challenge (bizga shu kerak)
const SITEKEY =
  (process.env.TURNSTILE_TEST_SITEKEY || "").trim() ||
  "3x00000000000000000000FF";

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>Turnstile interaktiv test</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>html,body{margin:0;height:100%;background:#0b1020;color:#fff;
font-family:system-ui,Segoe UI,Arial;display:flex;align-items:center;
justify-content:center;flex-direction:column;gap:22px}
h2{font-weight:700;font-size:22px} .hint{color:#94a3b8;font-size:15px}
#out{font-size:18px;color:#ef4444;font-weight:700}
#out.ok{color:#22c55e}</style></head>
<body>
  <h2>Cloudflare Turnstile — MAJBURIY interaktiv (test)</h2>
  <div class="hint">OS kursori shu katakchani bosishi kerak ↓</div>
  <div class="cf-turnstile" data-sitekey="${SITEKEY}" data-theme="light"></div>
  <div id="out">token: yo'q</div>
  <div class="hint">(fizik klik ishlasa — yashil "token: …" bo'ladi)</div>
  <script>
    setInterval(function(){
      var el=document.querySelector('input[name="cf-turnstile-response"]');
      var out=document.getElementById('out');
      if(el && el.value){ out.textContent='token: '+el.value.slice(0,24)+'…'; out.className='ok'; }
      else { out.textContent="token: yo'q"; out.className=''; }
    },400);
  </script>
</body></html>`;

async function main() {
  const profileKey = "turnstile-test";

  // Mahalliy HTTP server — Turnstile widget'i to'g'ri origin (http://127.0.0.1)
  // talab qiladi (data: URL'da tashqi skript bloklanadi).
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(HTML);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}/`;

  console.log("");
  hr();
  console.log(`  ${bold("🖱  HAQIQIY TURNSTILE OS-KLIK TESTI")}`);
  hr();
  step(`Sitekey: ${SITEKEY} (majburiy interaktiv)`);
  step(`Sahifa: ${url}`);
  step(`BOOKING_OS_CLICK = ${process.env.BOOKING_OS_CLICK || "(yo'q)"}`);
  step(`BOOKING_HEADLESS = ${process.env.BOOKING_HEADLESS || "(yo'q)"}`);
  step(`BOOKING_CHROME_CDP = ${process.env.BOOKING_CHROME_CDP || "(yo'q)"}`);
  hr();

  const session = await openBrowserContext(
    profileDirFor("login", profileKey),
    { profileKey, noProxy: true },
    { cdpProfileBase: undefined, cdpFreshProfile: true },
  );
  const page = await session.context.newPage();

  // Konsol va xatolarni ushlaymiz — skript yuklanmasa bilish uchun.
  page.on("console", (m: ConsoleMessage) => {
    const t = m.type();
    if (t === "error" || t === "warning")
      console.log(gray(`    [console.${t}] ${m.text().slice(0, 140)}`));
  });
  page.on("pageerror", (e: Error) =>
    console.log(gray(`    [pageerror] ${String(e).slice(0, 140)}`)),
  );
  page.on("requestfailed", (req: Request) => {
    const u = req.url();
    if (u.includes("cloudflare") || u.includes("turnstile"))
      console.log(
        gray(
          `    [requestfailed] ${u.slice(0, 90)} — ${req.failure()?.errorText}`,
        ),
      );
  });

  try {
    step("Sahifa ochilmoqda…");
    await page.goto(url, { waitUntil: "load", timeout: 30000 }).catch(() => {});

    // Turnstile cf-iframe (haqiqiy interaktiv widget) render bo'lishini kutamiz.
    // Iframe SHADOW DOM ichida bo'lishi mumkin — shadowRoot'larni ITERATIV
    // (rekursiyasiz, NOMLI funksiyasiz) kezamiz. tsx/esbuild page-funksiya
    // ichidagi nomli funksiyalarga __name qo'shadi va xato beradi.
    step("Turnstile widget render bo'lishini kutamiz…");
    const rendered = await page
      .waitForFunction(
        () => {
          const stack: Array<Document | ShadowRoot> = [document];
          while (stack.length) {
            const root = stack.pop();
            if (!root) continue;
            const hit = Array.from(root.querySelectorAll("iframe")).some(
              (f) => {
                const r = f.getBoundingClientRect();
                return r.width > 10 && r.height > 10;
              },
            );
            if (hit) return true;
            root.querySelectorAll("*").forEach((el) => {
              const sr = (el as HTMLElement).shadowRoot;
              if (sr) stack.push(sr);
            });
          }
          return false;
        },
        { timeout: 20000 },
      )
      .then(() => true)
      .catch(() => false);
    step(
      rendered
        ? "widget (cf-iframe) render bo'ldi ✓"
        : yellow("widget topilmadi (timeout) — baribir urinaman"),
    );

    // DIAGNOSTIKA: Turnstile skripti yuklandimi? Widget bormi?
    const diag = await page
      .evaluate(() => {
        const w = window as unknown as { turnstile?: unknown };
        return {
          turnstileApi: typeof w.turnstile !== "undefined",
          cfDiv: !!document.querySelector(".cf-turnstile"),
          scripts: Array.from(document.querySelectorAll("script"))
            .map((s) => (s.getAttribute("src") || "").slice(-40))
            .filter(Boolean),
          iframes: Array.from(document.querySelectorAll("iframe")).map((f) => {
            const r = f.getBoundingClientRect();
            return {
              src: (f.getAttribute("src") || "").slice(0, 50),
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          }),
        };
      })
      .catch(() => null);
    if (diag) {
      step(
        `turnstile API yuklandi: ${diag.turnstileApi ? "ha ✓" : red("yo'q ✗")}`,
      );
      step(`.cf-turnstile div: ${diag.cfDiv ? "bor" : "yo'q"}`);
      step(`script src'lar: ${diag.scripts.join(", ") || "(yo'q)"}`);
      step(`iframe soni: ${diag.iframes.length}`);
      diag.iframes.forEach(
        (f: { w: number; h: number; src: string }, i: number) =>
          step(`  iframe[${i}] ${f.w}x${f.h}  src="${f.src}"`),
      );
    }
    const shotPath = `uploads/slot-monitor/turnstile-test-${Date.now()}.png`;
    await page.screenshot({ path: shotPath }).catch(() => {});
    step(`skrinshot: ${shotPath}`);

    hr();
    console.log(`  ${bold("→ FIZIK OS-KLIK (vaqt o'lchanmoqda)")}`);
    hr();
    const r = await forceOsClickTurnstile(page, step);

    hr();
    console.log(`  ${bold("📋  NATIJA + VAQT")}`);
    hr();
    console.log(
      `  OS-klik yoqilgan      ${r.enabled ? green("ha ✓") : red("yo'q ✗")}`,
    );
    console.log(
      `  checkbox o'lchandi    ${r.measured ? green("ha ✓") : red("yo'q ✗")}`,
    );
    if (r.measured)
      console.log(`  koordinata            (${r.physX}, ${r.physY})`);
    console.log(
      `  token (klikdan keyin) ${r.tokenAfter ? green("BOR ✓") : red("yo'q ✗")}`,
    );
    hr();
    console.log(`  ${bold("⏱  VAQT TAQSIMOTI")}`);
    console.log(`  checkbox o'lchash     ${(r.measureMs / 1000).toFixed(1)}s`);
    console.log(`  klik bosqichi (jami)  ${(r.clickMs / 1000).toFixed(1)}s`);
    if (r.tokenAfter)
      console.log(
        `  ${bold("klik → token")}          ${green((r.solveMs / 1000).toFixed(1) + "s")}`,
      );
    console.log(
      `  ${bold("JAMI")}                  ${(r.totalMs / 1000).toFixed(1)}s`,
    );
    hr();
    if (r.tokenAfter)
      console.log(`  ${green("✓ HAQIQIY TURNSTILE OS-KLIK BILAN YECHILDI!")}`);
    else
      console.log(
        `  ${red("✗ Token kelmadi — kursor checkbox'ga tegmadimi? Ekranni tekshiring.")}`,
      );
    hr();

    const holdMs = Number(process.env.TURNSTILE_TEST_HOLD_MS || "5000");
    step(
      `Brauzer ${(holdMs / 1000).toFixed(0)}s ochiq qoladi (ko'rish uchun)…`,
    );
    await page.waitForTimeout(holdMs).catch(() => {});
  } finally {
    await session.close().catch(() => {});
    server.close();
  }
}

main().catch((e) => {
  console.error(red("Xato:"), e);
  process.exit(1);
});
