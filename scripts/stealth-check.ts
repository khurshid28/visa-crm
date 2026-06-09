// STEALTH / ANTI-DETECT runtime tekshiruvi (VFS'ga TEGMAYDI — about:blank).
// Phase 13 ning 3 o'zgarishini HAQIQIY brauzerda (CDP yo'li, xuddi login kabi)
// tekshiradi va spoof qiymatlarni KUTILGAN bilan solishtiradi:
//   1) WebGL renderer/vendor spoof (UNMASKED 37445/37446, WebGL + WebGL2)
//   2) CPU yadrolari (hardwareConcurrency) + RAM (deviceMemory) spoof
//   3) WebRTC guard (RTCPeerConnection patch BUZILMAGAN — __name fix ishlaydi)
//   + navigator.webdriver=false (stealth) + "ideal" darajadagi signallar (toString).
//
// Ishga tushirish:
//   npm run stealth:check
//   npm run stealth:check -- boshqa@email.com
//
// VFS'ga TEGMAYDI: faqat about:blank ochadi, navigator/WebGL/RTC o'qiydi.
// Akkauntni bloklamaydi, proxy trafigini sarflamaydi (noProxy).

import "dotenv/config";
import * as http from "http";
import { execSync } from "child_process";
import { openBrowserContext, hardwareFp } from "../lib/automation/browser";

// Windows konsolida UTF-8 majburlaymiz — aks holda ✓ ─ ▸ belgilar "тЬУ тАФ"
// bo'lib buziladi (konsol kod-sahifasi UTF-8 emas).
if (process.platform === "win32") {
  try {
    execSync("chcp 65001", { stdio: "ignore" });
  } catch {
    /* ignore */
  }
}

const COLOR = (process.env.LOG_COLOR || "true").toLowerCase() !== "false";
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c("1", s);
const dim = (s: string) => c("2", s);
const green = (s: string) => c("32", s);
const red = (s: string) => c("31", s);
const yellow = (s: string) => c("33", s);
const cyan = (s: string) => c("36", s);
const gray = (s: string) => c("90", s);

// ── Quti chizish (UTF-8 majburlangani uchun toza ko'rinadi) ──
const BOX_W = 60; // quti ichki kengligi
// Ba'zi belgilar (✔ ✖ ⚠ ·) terminalda 2 ustun chiziladi — quti chegarasi
// teng bo'lishi uchun ularni 2 deb sanaymiz (ANSI rang kodlari esa 0).
const WIDE = /[\u00B7\u2714\u2716\u26A0\u2139]/g;
const visLen = (s: string) => {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, "");
  const wide = (plain.match(WIDE) || []).length;
  return [...plain].length + wide;
};
const boxTop = () => console.log(cyan("  ╭" + "─".repeat(BOX_W) + "╮"));
const boxBottom = () => console.log(cyan("  ╰" + "─".repeat(BOX_W) + "╯"));
const boxLine = (s: string) => {
  const pad = Math.max(0, BOX_W - 1 - visLen(s));
  console.log(cyan("  │ ") + s + " ".repeat(pad) + cyan("│"));
};

let pass = 0;
let fail = 0;
let warn = 0;

// Bo'lim sarlavhasi + bir qatorli sodda izoh (oddiy tilda — tushunarli bo'lsin).
function section(title: string, desc: string) {
  console.log("");
  console.log("  " + cyan("▸ ") + bold(title));
  console.log("    " + gray(desc));
}

// Bitta tekshiruv qatori: ✔ / ✖ / ⚠ + nom + qiymat (+ kutilgan farqi).
function check(
  label: string,
  ok: boolean | "warn",
  got: string,
  want?: string,
) {
  const tag = ok === "warn" ? yellow("⚠") : ok ? green("✔") : red("✖");
  if (ok === "warn") warn++;
  else if (ok) pass++;
  else fail++;
  const wantStr =
    want != null && want !== got ? gray(`  ≠ kutilgan: ${want}`) : "";
  const gotStr = ok === "warn" ? yellow(got) : ok ? bold(got) : red(got);
  console.log(`    ${tag} ${gray(label.padEnd(24))} ${gotStr}${wantStr}`);
}

async function main() {
  const email =
    process.argv.find((a) => !a.startsWith("-") && a.includes("@")) ||
    "khurshidi2827@gmail.com";

  const expected = hardwareFp(email);

  const cdpOn = (process.env.BOOKING_CHROME_CDP || "").toLowerCase() === "true";

  console.log("");
  boxTop();
  boxLine(bold("STEALTH / ANTI-DETECT") + gray("  ·  runtime tekshiruv"));
  boxLine(gray("brauzer izini real Chrome'da tekshiradi (VFS'ga tegmaydi)"));
  boxBottom();
  console.log("");
  console.log(`  ${gray("Akkaunt".padEnd(13))} ${cyan(email)}`);
  console.log(
    `  ${gray("Rejim".padEnd(13))} ${
      cdpOn ? green("CDP · real Chrome") : yellow("launch (CDP o'chiq)")
    } ${gray("(xuddi login kabi)")}`,
  );
  console.log(`  ${gray("Kutilgan GPU".padEnd(13))} ${dim(expected.renderer)}`);
  console.log(
    `  ${gray("Kutilgan HW".padEnd(13))} ${dim(
      `${expected.cores} yadro · ${expected.memory} GB RAM`,
    )}`,
  );

  // Proxy SHART EMAS (about:blank) — noProxy bilan tez ochamiz.
  const session = await openBrowserContext("", {
    profileKey: email,
    noProxy: true,
  });
  // Init-skriptlar ISHGA TUSHISHI uchun REAL origin kerak (about:blank ularni
  // ishga tushirmaydi — Playwright cheti). Lokal HTTP server ochamiz (VFS emas).
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      "<!doctype html><html><head><title>stealth</title></head><body>ok</body></html>",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const localUrl =
    addr && typeof addr === "object"
      ? `http://127.0.0.1:${addr.port}/`
      : "http://127.0.0.1/";
  try {
    const page = await session.context.newPage();
    await page
      .goto(localUrl, { waitUntil: "domcontentloaded" })
      .catch(() => {});

    // ── Hammasini bitta evaluate'da o'qiymiz (__name gotcha'dan qochish uchun
    //    FAQAT anonim inline callback, ichida named/const-funksiya YO'Q). ──
    const out: any = await page.evaluate(() => {
      const o: any = {};
      o.webdriver = navigator.webdriver;
      o.cores = navigator.hardwareConcurrency;
      o.memory = (navigator as any).deviceMemory;
      o.ua = navigator.userAgent;
      o.langs = navigator.languages ? navigator.languages.join(",") : "";
      o.platform = navigator.platform;
      o.coresOwnProp = Object.prototype.hasOwnProperty.call(
        navigator,
        "hardwareConcurrency",
      );
      try {
        // Descriptor PROTOTIP zanjirida (native: Navigator.prototype da turadi,
        // instansiyada EMAS). Zanjirni aylanib topamiz (named-funksiya YO'Q —
        // __name gotcha'dan qochish uchun oddiy while + var).
        let desc: any = null;
        let walk: any = navigator;
        while (walk) {
          desc = Object.getOwnPropertyDescriptor(walk, "hardwareConcurrency");
          if (desc) break;
          walk = Object.getPrototypeOf(walk);
        }
        o.coresGetterNative =
          desc && desc.get ? /\[native code\]/.test(desc.get.toString()) : null;
      } catch (e) {
        o.coresGetterNative = null;
      }
      // WebGL 1 — UNMASKED qiymatlar uchun WEBGL_debug_renderer_info kerak
      // (extension yoqilmasa getParameter(37445/37446) NULL qaytaradi). Override
      // qo'llangan bo'lsa, baribir spoof qiymat qaytadi (extension'dan qat'i nazar).
      try {
        const cv = document.createElement("canvas");
        const gl: any =
          cv.getContext("webgl") || cv.getContext("experimental-webgl");
        if (gl) {
          try {
            gl.getExtension("WEBGL_debug_renderer_info");
          } catch (e) {
            /* ignore */
          }
          o.glVendor = gl.getParameter(37445);
          o.glRenderer = gl.getParameter(37446);
          o.glToStringNative = /\[native code\]/.test(
            gl.getParameter.toString(),
          );
        }
      } catch (e) {
        o.glError = String(e);
      }
      // WebGL 2
      try {
        const cv2 = document.createElement("canvas");
        const gl2: any = cv2.getContext("webgl2");
        if (gl2) {
          try {
            gl2.getExtension("WEBGL_debug_renderer_info");
          } catch (e) {
            /* ignore */
          }
          o.gl2Vendor = gl2.getParameter(37445);
          o.gl2Renderer = gl2.getParameter(37446);
        }
      } catch (e) {
        o.gl2Error = String(e);
      }
      // WebRTC guard — patch BUZMAGANINI tekshiramiz (RTC hali ham ishlaydi).
      try {
        o.rtcExists = typeof (window as any).RTCPeerConnection === "function";
        const pc: any = new (window as any).RTCPeerConnection();
        o.rtcConstructs = !!pc;
        if (pc && pc.close) pc.close();
      } catch (e) {
        o.rtcError = String(e);
        o.rtcConstructs = false;
      }
      return o;
    });

    // ── 1) STEALTH: navigator.webdriver ──
    section(
      "Bot izi (stealth)",
      "avtomatlashtirilgan brauzer belgisi yashirilganmi",
    );
    check(
      "navigator.webdriver",
      out.webdriver === false || out.webdriver === undefined,
      String(out.webdriver),
      "false",
    );

    // ── 2) CPU / RAM spoof ──
    section(
      "CPU / RAM niqobi",
      "yadro soni va xotira uy-kompyuter qiymatiga moslanganmi",
    );
    check(
      "hardwareConcurrency",
      out.cores === expected.cores,
      String(out.cores),
      String(expected.cores),
    );
    check(
      "deviceMemory",
      out.memory === expected.memory,
      String(out.memory),
      String(expected.memory),
    );

    // ── 3) WebGL renderer spoof ──
    section(
      "Video-karta (WebGL) niqobi",
      "server GPU (SwiftShader) o'rniga real GPU ko'rinadimi",
    );
    check(
      "WebGL vendor (37445)",
      out.glVendor === expected.vendor,
      String(out.glVendor),
      expected.vendor,
    );
    check(
      "WebGL renderer (37446)",
      out.glRenderer === expected.renderer,
      String(out.glRenderer),
      expected.renderer,
    );
    if (out.gl2Renderer != null) {
      check(
        "WebGL2 renderer",
        out.gl2Renderer === expected.renderer,
        String(out.gl2Renderer),
        expected.renderer,
      );
    } else {
      check("WebGL2 renderer", "warn", "WebGL2 yo'q (kontekst ochilmadi)");
    }

    // ── 4) WebRTC guard (__name fix) ──
    section(
      "WebRTC himoyasi",
      "RTCPeerConnection buzilmagan (__name xatosi yo'q)",
    );
    check(
      "RTCPeerConnection mavjud",
      out.rtcExists === true,
      String(out.rtcExists),
      "true",
    );
    check(
      "RTC konstruktor ishlaydi",
      out.rtcConstructs === true,
      out.rtcError ? `XATO: ${out.rtcError}` : String(out.rtcConstructs),
      "true",
    );

    // ── 5) "IDEAL" darajadagi nozik signallar (WARN — blok emas) ──
    section(
      "Ideal-daraja (nozik signal)",
      "blok qilmaydi — faqat ilg'or skript sezadigan iz",
    );
    check(
      "getParameter toString native",
      out.glToStringNative === true ? true : "warn",
      out.glToStringNative === true ? "native ✓" : "JS (override ko'rinadi)",
    );
    check(
      "hwConcurrency getter native",
      out.coresGetterNative === true ? true : "warn",
      out.coresGetterNative === true
        ? "native ✓"
        : "JS getter (override ko'rinadi)",
    );
    check(
      "hwConcurrency own-prop",
      out.coresOwnProp === false ? true : "warn",
      out.coresOwnProp === false
        ? "prototip (normal)"
        : "instansiya (g'ayritabiiy)",
    );

    // ── Kontekst ma'lumotlari ──
    section("Kontekst", "brauzer o'zini qanday tanishtiryapti");
    console.log(
      `    ${gray("UA".padEnd(11))} ${dim((out.ua || "").slice(0, 60))}`,
    );
    console.log(`    ${gray("languages".padEnd(11))} ${dim(out.langs || "—")}`);
    console.log(
      `    ${gray("platform".padEnd(11))} ${dim(out.platform || "—")}`,
    );

    console.log("");
    const okAll = fail === 0;
    const verdictText = okAll
      ? warn === 0
        ? green("IDEAL ✔")
        : green("TO'G'RI ✔")
      : red("MUAMMO ✖");
    const sub = okAll
      ? warn === 0
        ? "hammasi to'g'ri — nozik signal ham yo'q"
        : "asosiy tekshiruvlar o'tdi · nozik signallar blok emas"
      : "ba'zi tekshiruvlar o'tmadi — yuqoridagi ✖ qatorlarga qarang";
    boxTop();
    boxLine(bold("NATIJA") + "   " + verdictText);
    boxLine(gray(sub));
    boxLine(
      green(`✔ ${pass} o'tdi`) +
        "   " +
        yellow(`⚠ ${warn} signal`) +
        "   " +
        (fail ? red(`✖ ${fail} xato`) : gray("✖ 0 xato")),
    );
    boxBottom();

    if (warn > 0) {
      console.log("");
      console.log("  " + cyan("ℹ ") + bold("Nozik signal nima?"));
      console.log(
        dim(
          "    getParameter/getter override qilingani uchun toString() endi\n" +
            '    "native code" emas. Buni FAQAT spoofing\'ni MAXSUS tekshiradigan\n' +
            "    ilg'or skript sezadi. Cloudflare esa spoofing'ni HAM jazolaydi —\n" +
            "    toString'ni yashirish ikki tomonlama xavf. Bizda (real Chrome CDP)\n" +
            "    Cloudflare AVTOMATIK o'tkazyapti, demak bu daraja YETARLI.\n" +
            "    Maslahat: LOKAL Windows'da real GPU allaqachon haqiqiy =>\n" +
            "    BOOKING_HW_SPOOF=false qo'ysangiz toString native qoladi (spoof\n" +
            "    faqat SERVER/Docker'da SwiftShader izini yashirish uchun kerak).",
        ),
      );
    }
    console.log("");
  } finally {
    await session.close().catch(() => {});
    server.close();
  }

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(red("Tekshiruv xatosi:"), e);
  process.exit(1);
});
