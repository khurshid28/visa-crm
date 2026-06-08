// OS-KLIK ISBOTI — fizik OS kursori HAQIQATAN bosishini ko'rsatadi.
// Cloudflare/VFS'ga BOG'LIQ EMAS: mahalliy HTML sahifada katta checkbox ochadi,
// uning fizik ekran koordinatasini o'lchaydi va OS-klik (os-click.ps1) bilan
// bosadi. Checkbox belgilansa — fizik klik ISHLAYDI degani. Kursor harakatini
// KO'Z bilan ko'rasiz.
//
// Ishga tushirish:
//   npm run osclick:proof
//
// .env: BOOKING_OS_CLICK="true", BOOKING_HEADLESS="false", BOOKING_CHROME_CDP="true".

import "dotenv/config";
import { openBrowserContext, profileDirFor } from "../lib/automation/browser";
import { osPhysicalClickElement } from "../lib/automation/turnstile";

const COLOR = (process.env.LOG_COLOR || "true").toLowerCase() !== "false";
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c("32", s);
const red = (s: string) => c("31", s);
const gray = (s: string) => c("90", s);
const bold = (s: string) => c("1", s);
const hr = () => console.log(gray("─".repeat(54)));
const step = (m: string) => console.log(`  ${gray("•")} ${m}`);

// Katta, markazda turgan checkbox + holat matni bo'lgan mahalliy sahifa.
const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>OS-CLICK PROOF</title>
<style>
  html,body{margin:0;height:100%;background:#0b1020;color:#fff;
    font-family:system-ui,Segoe UI,Arial;display:flex;align-items:center;
    justify-content:center;flex-direction:column;gap:28px}
  #cb{width:90px;height:90px;cursor:pointer;accent-color:#22c55e;transform:scale(2.2)}
  #status{font-size:34px;font-weight:700}
  .off{color:#ef4444} .on{color:#22c55e}
  .hint{color:#94a3b8;font-size:16px}
</style></head><body>
  <div class="hint">OS kursori shu katakchani bosishi kerak ↓</div>
  <input type="checkbox" id="cb">
  <div id="status" class="off">BELGILANMAGAN</div>
  <div class="hint">(fizik klik ishlasa — yashil "BELGILANDI" bo'ladi)</div>
  <script>
    const cb=document.getElementById('cb'),s=document.getElementById('status');
    function upd(){ if(cb.checked){s.textContent='BELGILANDI ✓';s.className='on';}
      else {s.textContent='BELGILANMAGAN';s.className='off';} }
    cb.addEventListener('change',upd); upd();
    // isTrusted (haqiqiy OS klik) ni ko'rsatish uchun:
    cb.addEventListener('click',e=>{ window.__trusted = e.isTrusted; });
  </script>
</body></html>`;

async function main() {
  const profileKey = "osclick-proof";

  console.log("");
  hr();
  console.log(`  ${bold("🖱  OS-KLIK ISBOTI (mahalliy checkbox)")}`);
  hr();
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

  try {
    step("Mahalliy checkbox sahifasi ochilmoqda…");
    await page.setContent(HTML, { waitUntil: "load" }).catch(() => {});
    await page.waitForTimeout(800).catch(() => {});

    const before = await page
      .locator("#cb")
      .isChecked()
      .catch(() => false);
    step(
      `checkbox (klikdan oldin) = ${before ? "belgilangan" : "belgilanmagan"}`,
    );

    hr();
    console.log(`  ${bold("→ FIZIK OS-KLIK")}`);
    hr();
    const r = await osPhysicalClickElement(page, "#cb", step);

    // Klikdan keyin holat o'zgarishini kutamiz.
    let after = before;
    for (let w = 0; w < 12; w++) {
      await page.waitForTimeout(300).catch(() => {});
      after = await page
        .locator("#cb")
        .isChecked()
        .catch(() => false);
      if (after !== before) break;
    }
    const trusted = await page
      .evaluate(() => (window as unknown as { __trusted?: boolean }).__trusted)
      .catch(() => undefined);

    hr();
    console.log(`  ${bold("📋  NATIJA")}`);
    hr();
    console.log(
      `  OS-klik yoqilgan      ${r?.enabled ? green("ha ✓") : red("yo'q ✗")}`,
    );
    if (r) console.log(`  bosilgan koordinata   (${r.physX}, ${r.physY})`);
    console.log(
      `  checkbox belgilandi   ${after && !before ? green("HA ✓") : red("yo'q ✗")}`,
    );
    console.log(
      `  klik isTrusted (OS)   ${
        trusted === true
          ? green("ha ✓ (haqiqiy OS klik)")
          : trusted === false
            ? red("yo'q (CDP klik)")
            : gray("— (klik bo'lmadi)")
      }`,
    );
    hr();
    if (after && !before)
      console.log(
        `  ${green("✓ FIZIK OS-KLIK ISHLAYDI — kursor checkbox'ni bosdi!")}`,
      );
    else
      console.log(
        `  ${red("✗ Klik tegmadi — oyna old planda emasmi yoki koordinata noto'g'rimi.")}`,
      );
    hr();

    const holdMs = Number(process.env.OSCLICK_PROOF_HOLD_MS || "5000");
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
