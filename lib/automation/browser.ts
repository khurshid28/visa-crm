// ====================================================================
//  BRAUZER — Playwright context, proxy, fingerprint, CDP, profil
// ====================================================================
//  Bu modul brauzerni ochish bilan bog'liq hamma narsani boshqaradi:
//   - openBrowserContext(): asosiy kirish nuqtasi (CDP / persistent / launch)
//   - connectRealChrome(): haqiqiy chrome.exe + connectOverCDP (Turnstile uchun)
//   - fingerprint, stealth, resource blocking, profil nusxalash
// ====================================================================

import {
  proxyFor,
  proxyMetaFor,
  type ProxyTarget,
  type ProxyConfig,
} from "../proxy";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as net from "net";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import type { Stage } from "./types";

export function envHeadless(): boolean {
  const v = (process.env.BOOKING_HEADLESS || "true").toLowerCase();
  return v !== "false" && v !== "0";
}

// OS-darajasidagi sichqoncha kliki (osClickTurnstile) uchun: oxirgi o'zimiz
// ishga tushirgan chrome.exe ning PID'i. Windows'da oynani foreground'ga
// ko'tarish (SetForegroundWindow) shu PID orqali topiladi.
let lastSpawnedChromePid: number | null = null;
export function getLastChromePid(): number | null {
  return lastSpawnedChromePid;
}

// Chromium'ni "boshqarilayotgan brauzer" belgilarisiz ishga tushirish argumentlari.
// --disable-blink-features=AutomationControlled => navigator.webdriver yo'qoladi.
export function launchArgs(): string[] {
  return [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process,AutomationControlled",
    "--disable-infobars",
    "--no-default-browser-check",
    "--no-first-run",
    "--disable-dev-shm-usage",
    "--disable-popup-blocking",
    // WEBRTC IP LEAK himoyasi: WebRTC UDP/STUN HTTP-proxy'ni chetlab o'tib
    // haqiqiy (server) IP'ni ochib qo'yishi mumkin. Bu bayroq proxy'dan
    // tashqari UDP'ni butunlay taqiqlaydi — shunda real IP hech qachon
    // sizib chiqmaydi (faqat proxy exit IP ko'rinadi).
    ...webrtcLeakArgs(),
  ];
}

// WebRTC orqali real IP sizishini oldini oluvchi Chrome bayroqlari.
// CDP (connectRealChrome) va launch yo'llari — ikkalasida ham ishlatiladi.
// .env: BOOKING_WEBRTC_PROTECT=false bo'lsa o'chadi (default: yoqilgan).
export function webrtcLeakArgs(): string[] {
  if (
    (process.env.BOOKING_WEBRTC_PROTECT || "").trim().toLowerCase() === "false"
  ) {
    return [];
  }
  return [
    // Proxy'dan tashqari UDP'ni taqiqlaydi — WebRTC faqat proxy orqali ketadi
    // (yoki umuman ishlamaydi). Real local/server IP STUN orqali chiqmaydi.
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    // mDNS host nomzodlarini ham o'chiradi (qo'shimcha local IP manbasi).
    "--disable-features=WebRtcHideLocalIpsWithMdns",
  ];
}

// Proxy trafigini TEJASH: og'ir resurslarni (rasm, shrift, video, audio) va
// keraksiz analytics/tracker domenlarini bloklaydi. Cloudflare/Turnstile va
// VFS uchun zarur skript/CSS/XHR'lar O'TKAZILADI (aks holda captcha buziladi).
// .env: BOOKING_BLOCK_RESOURCES=false bo'lsa o'chadi (default: yoqilgan).
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);
const BLOCKED_URL_PATTERNS = [
  // --- Analytics / tracking (login uchun keraksiz, og'ir) ---
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "facebook.com/tr",
  "hotjar.com",
  "clarity.ms",
  "bat.bing.com",
  "yandex.ru/metrika",
  "mc.yandex",
  // Cloudflare Insights / Web Analytics beacon (challenge EMAS — analytics).
  // DIQQAT: challenges.cloudflare.com (Turnstile) bloklanMAYDI, faqat insights.
  "cloudflareinsights.com",
  "static.cloudflareinsights",
  // Dynatrace RUM monitoring (VFS sahifasidagi og'ir tracking agent ~100KB+).
  "dynatrace.com",
  "dynatracelabs.com",
  "js-cdn.dynatrace",
  "ruxitagent",
  // OneTrust cookie banner SDK (3 ta JS + logo). Banner kerak emas — login
  // funksiyasiga ta'sir qilmaydi, faqat overlay'ni yo'qotadi (Sign In to'silmaydi).
  "cookielaw.org",
  "onetrust.com",
  "cookiepro.com",
  // --- Shriftlar (ikonlar/typography — login uchun shart emas) ---
  "fonts.gstatic.com",
  "fonts.googleapis.com",
  "font-awesome",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  // --- Media / rasmlar ---
  ".mp4",
  ".webm",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
];
export async function applyResourceBlocking(
  context: import("playwright").BrowserContext,
): Promise<void> {
  if ((process.env.BOOKING_BLOCK_RESOURCES || "").toLowerCase() === "false") {
    return;
  }
  // CMS (Contentful) kontent so'rovlarini bloklash — login sahifasidagi MATN/
  // tarjima (resourceGroup, mission). DIQQAT: SINOV ko'rsatdi — bu CMS Angular
  // formasini RENDER qilish uchun KERAK (bloklansa email/parol maydoni chiqmaydi).
  // Shuning uchun DEFAULT O'CHIQ. Faqat .env BOOKING_BLOCK_CMS=true bo'lsa bloklanadi
  // (xavfli — sahifa buzilishi mumkin).
  const blockCms =
    (process.env.BOOKING_BLOCK_CMS || "false").toLowerCase() === "true";

  // CMS DISK CACHE: CMS javoblari STATIK matn (o'zgarmaydi). Birinchi marta
  // proxy orqali olib diskka saqlaymiz, keyingi safar DISKDAN beramiz — proxy
  // orqali QAYTA YUKLANMAYDI (har CMS so'rov ~1.3s tejaydi). Bloklab bo'lmaydi
  // (forma buziladi), lekin cache'lash xavfsiz. .env: BOOKING_CMS_CACHE=false o'chiradi.
  const cmsCacheOn =
    !blockCms &&
    (process.env.BOOKING_CMS_CACHE || "true").toLowerCase() !== "false";
  // Statik asset (versiyali JS/CSS: vendor.js?v=8.0, styles.css?v=8...) — bular
  // ham o'zgarmaydi (versiya URL'da). Disk cache qilamiz — fresh profilda ham
  // proxy orqali qayta yuklanmaydi. .env: BOOKING_ASSET_CACHE=false o'chiradi.
  const assetCacheOn =
    (process.env.BOOKING_ASSET_CACHE || "true").toLowerCase() !== "false";
  const cmsCacheDir = path.join(os.tmpdir(), "visa-cms-cache");
  if (cmsCacheOn || assetCacheOn) {
    try {
      fs.mkdirSync(cmsCacheDir, { recursive: true });
    } catch {
      /* ignore */
    }
  }
  const isCms = (url: string) =>
    url.includes("cloudfront.net") && url.includes("entries");
  // Versiyali statik asset (liftassets.../*.js?v=, *.css?v=). Login-zarur
  // skriptlar (main/vendor/runtime/polyfills/scripts/styles) — o'zgarmaydi.
  const isStaticAsset = (url: string) =>
    url.includes("liftassets.vfsglobal.com") &&
    /\.(js|css)(\?|$)/.test(url) &&
    /(main|vendor|runtime|polyfills|scripts|styles)\./.test(url);
  const cmsKey = (url: string) => {
    let h = 0;
    for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0;
    return `cache-${h.toString(36)}.json`;
  };

  await context.route("**/*", async (route) => {
    try {
      const req = route.request();
      const type = req.resourceType();
      const url = req.url().toLowerCase();
      // Cloudflare/Turnstile resurslarini HECH QACHON bloklamaymiz.
      if (
        url.includes("challenges.cloudflare.com") ||
        url.includes("/cdn-cgi/")
      ) {
        return route.continue();
      }
      // CMS kontenti (matn) — i18n'dan tashqari (til kerak, qoldiramiz).
      if (
        blockCms &&
        url.includes("cloudfront.net") &&
        url.includes("entries") &&
        !url.includes("i18n")
      ) {
        return route.abort();
      }

      // DISK CACHE: statik CMS javoblari VA versiyali JS/CSS asset'larini
      // diskdan beramiz (proxy'siz). Ikkalasi ham o'zgarmaydi (statik/versiyali).
      const cacheable =
        req.method() === "GET" &&
        ((cmsCacheOn && isCms(url)) || (assetCacheOn && isStaticAsset(url)));
      if (cacheable) {
        const file = path.join(cmsCacheDir, cmsKey(url));
        // Cache'da bor — diskdan beramiz (proxy orqali ketmaydi).
        try {
          if (fs.existsSync(file)) {
            const cached = JSON.parse(fs.readFileSync(file, "utf8"));
            return route.fulfill({
              status: cached.status,
              headers: cached.headers,
              body: Buffer.from(cached.body, "base64"),
            });
          }
        } catch {
          /* cache buzilgan — qaytadan olamiz */
        }
        // Cache'da yo'q — proxy orqali olib, diskka saqlaymiz.
        try {
          const resp = await route.fetch();
          const body = await resp.body();
          try {
            fs.writeFileSync(
              file,
              JSON.stringify({
                status: resp.status(),
                headers: resp.headers(),
                body: body.toString("base64"),
              }),
            );
          } catch {
            /* yozib bo'lmadi — muhim emas */
          }
          return route.fulfill({ response: resp, body });
        } catch {
          return route.continue();
        }
      }

      if (
        BLOCKED_RESOURCE_TYPES.has(type) ||
        BLOCKED_URL_PATTERNS.some((p) => url.includes(p))
      ) {
        return route.abort();
      }
      return route.continue();
    } catch {
      try {
        return route.continue();
      } catch {
        /* ignore */
      }
    }
  });
}

// Brauzerga ochilishi bilan qo'shimcha "inson" belgilarini in'ektsiya qiladi
// (stealth ustiga: webdriver=false, languages, chrome obyekt, permissions).
async function applyStealthInit(
  context: import("playwright").BrowserContext,
  acceptLanguage: string,
  profileKey?: string | null,
): Promise<void> {
  const langs = acceptLanguage
    .split(",")
    .map((s) => s.split(";")[0].trim())
    .filter(Boolean)
    .slice(0, 4);
  await context
    .addInitScript((languages: string[]) => {
      try {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        Object.defineProperty(navigator, "languages", {
          get: () => (languages.length ? languages : ["en-US", "en"]),
        });
        (window as any).chrome = (window as any).chrome || { runtime: {} };
        const anyNav = navigator as any;
        const orig = anyNav.permissions?.query?.bind(anyNav.permissions);
        if (orig) {
          anyNav.permissions.query = (p: any) =>
            p && p.name === "notifications"
              ? Promise.resolve({ state: Notification.permission })
              : orig(p);
        }
        // TEZLIK: smooth-scroll animatsiyasini O'CHIRAMIZ. VFS sahifasi
        // `scroll-behavior: smooth` ishlatadi — scrollIntoView / click avto-scroll
        // har safar 2-3s animatsiya qiladi va Playwright uni kutadi (behuda vaqt).
        // Global `scroll-behavior: auto` bilan barcha scroll BIR ZUMDA bo'ladi.
        const s = document.createElement("style");
        s.textContent = "html,body,*{scroll-behavior:auto !important}";
        (document.documentElement || document.head)?.appendChild(s);
      } catch {
        /* ignore */
      }
    }, langs)
    .catch(() => {});
  // WebRTC IP leak himoyasi + apparat fingerprint (WebGL/CPU/RAM) — launch
  // yo'lida string init-script sifatida (CDP yo'li raw CDP bilan injeksiya qiladi).
  await applyStealthSources(context, profileKey);
}

// WEBRTC IP LEAK (JS qatlami) — Chrome bayrog'i (webrtcLeakArgs) ustiga ikkinchi
// himoya qatlami. ICE candidate'lardagi IP'li (host/srflx) nomzodlarni yutadi,
// shunda RTCPeerConnection real local/server IP'ni sahifaga bermaydi.
// MUHIM: bu SOURCE STRING qaytaradi (funksiya EMAS) — esbuild/tsx string'ni
// O'ZGARTIRMAYDI, shuning uchun __name gotcha YO'Q. String launch yo'lida
// context.addInitScript(src), CDP yo'lida raw CDP (addScriptToEvaluateOnNewDocument)
// bilan injeksiya qilinadi. .env: BOOKING_WEBRTC_PROTECT=false bo'lsa null.
function webrtcGuardSource(): string | null {
  if (
    (process.env.BOOKING_WEBRTC_PROTECT || "").trim().toLowerCase() === "false"
  ) {
    return null;
  }
  return `(function () {
  try {
    var RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    if (!RTC) return;
    var Wrapped = function () {
      var pc = new RTC(...arguments);
      var origAdd = pc.addEventListener ? pc.addEventListener.bind(pc) : null;
      if (origAdd) {
        pc.addEventListener = function (type, cb) {
          var rest = Array.prototype.slice.call(arguments, 2);
          if (type === "icecandidate" && typeof cb === "function") {
            return origAdd.apply(null, [type, function (ev) {
              if (ev && ev.candidate && /(\\d{1,3}\\.){3}\\d{1,3}|[a-f0-9]{0,4}:[a-f0-9:]+/i.test(ev.candidate.candidate || "")) {
                return;
              }
              return cb(ev);
            }].concat(rest));
          }
          return origAdd.apply(null, [type, cb].concat(rest));
        };
      }
      return pc;
    };
    Wrapped.prototype = RTC.prototype;
    window.RTCPeerConnection = Wrapped;
    window.webkitRTCPeerConnection = Wrapped;
  } catch (e) {}
})();`;
}

// APPARAT FINGERPRINT (server izini yashirish) — WebGL renderer + CPU + RAM.
// Server (Docker/Xvfb)da Chrome WebGL'da "Google SwiftShader"/"llvmpipe" beradi —
// bu "men serverman" degan KUCHLI signal. Bu yerda real Windows GPU ko'rsatamiz,
// hardwareConcurrency/deviceMemory uy-kompyuter qiymatlariga moslanadi (per
// profileKey BARQAROR). SOURCE STRING qaytaradi (qiymatlar JSON bilan ichiga
// quyiladi -> __name gotcha YO'Q). .env: BOOKING_HW_SPOOF=false bo'lsa null.
//
// "IDEAL" daraja (spoof'ni ANIQLAB BO'LMASIN — anti-bot skript sezmasin):
//  1) toString NIQOBI — patch qilingan funksiyalar .toString() da "[native code]"
//     qaytaradi (override izi yashirinadi). Niqob o'zini ham native ko'rsatadi.
//  2) hardwareConcurrency/deviceMemory NAVIGATOR.PROTOTYPE da (instansiyada EMAS) —
//     native joyida turadi, navigator.hasOwnProperty(...) === false (xuddi haqiqiy).
//  3) getter'lar va getParameter NIQOB ostida — .toString() native ko'rinadi.
function hardwareSpoofSource(profileKey?: string | null): string | null {
  if ((process.env.BOOKING_HW_SPOOF || "").trim().toLowerCase() === "false") {
    return null;
  }
  const hw = hardwareFp(profileKey);
  return `(function () {
  try {
    var data = ${JSON.stringify(hw)};

    // ── 1) toString NIQOBI: patch qilingan funksiyalar "[native code]" qaytarsin. ──
    // Function.prototype.toString ni Proxy bilan o'raymiz; WeakMap'dagi funksiyalar
    // uchun native-ko'rinishli satr qaytaramiz, qolganlari uchun haqiqiy toString.
    var _nts = Function.prototype.toString;
    var _masks = new WeakMap();
    function _nat(name) { return "function " + name + "() { [native code] }"; }
    function _mask(fn, name) { try { _masks.set(fn, _nat(name)); } catch (e) {} return fn; }
    var _tsp = new Proxy(_nts, {
      apply: function (target, thisArg, args) {
        if (thisArg && _masks.has(thisArg)) return _masks.get(thisArg);
        return Reflect.apply(target, thisArg, args);
      }
    });
    Function.prototype.toString = _tsp;
    _masks.set(_tsp, _nat("toString")); // niqobning o'zi ham native ko'rinadi

    // ── 2) CPU yadrolari + RAM: NAVIGATOR.PROTOTYPE da (native joyida). ──
    function _defNav(prop, val) {
      try {
        var getter = function () { return val; };
        _mask(getter, "get " + prop); // getter .toString() native ko'rinadi
        var target = (window.Navigator && window.Navigator.prototype) || navigator;
        Object.defineProperty(target, prop, {
          get: getter, configurable: true, enumerable: true
        });
      } catch (e) {}
    }
    if (data.cores > 0) _defNav("hardwareConcurrency", data.cores);
    if (data.memory > 0) _defNav("deviceMemory", data.memory);

    // ── 3) WebGL UNMASKED vendor(37445)/renderer(37446) — WebGL + WebGL2. ──
    var protos = [
      window.WebGLRenderingContext && window.WebGLRenderingContext.prototype,
      window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype
    ];
    for (var i = 0; i < protos.length; i++) {
      var proto = protos[i];
      if (!proto || !proto.getParameter) continue;
      proto.getParameter = (function (orig) {
        var patched = function (p) {
          if (p === 37445) return data.vendor;
          if (p === 37446) return data.renderer;
          return orig.call(this, p);
        };
        _mask(patched, "getParameter"); // getParameter .toString() native ko'rinadi
        return patched;
      })(proto.getParameter);
    }
  } catch (e) {}
})();`;
}

// Stealth source'larni LAUNCH yo'lida qo'llaymiz (Playwright-managed context —
// addInitScript string'ni qabul qiladi va ishonchli ishlaydi).
async function applyStealthSources(
  context: import("playwright").BrowserContext,
  profileKey?: string | null,
): Promise<void> {
  const sources = [webrtcGuardSource(), hardwareSpoofSource(profileKey)].filter(
    (s): s is string => !!s,
  );
  for (const src of sources) {
    await context.addInitScript(src).catch(() => {});
  }
}

// CDP yo'lida stealth source'larni RAW CDP bilan injeksiya qilamiz —
// page.addInitScript/context.addInitScript connectOverCDP'da ISHLAMAYDI
// (no-op; runtime stealth:check bilan tasdiqlandi: applyAll xatosiz tugaydi,
// lekin skript bajarilmaydi). Page.addScriptToEvaluateOnNewDocument esa Chrome'ga
// to'g'ridan-to'g'ri tushadi va keyingi har bir hujjatda ishlaydi. Sessiyani
// DETACH QILMAYMIZ — detach skript ro'yxatini tozalashi mumkin (page yopilganda
// avtomatik tozalanadi).
async function injectCdpSources(
  context: import("playwright").BrowserContext,
  page: import("playwright").Page,
  profileKey?: string | null,
): Promise<void> {
  const sources = [webrtcGuardSource(), hardwareSpoofSource(profileKey)].filter(
    (s): s is string => !!s,
  );
  if (!sources.length) return;
  const client = await context.newCDPSession(page);
  await client.send("Page.enable").catch(() => {});
  for (const source of sources) {
    await client
      .send("Page.addScriptToEvaluateOnNewDocument", { source })
      .catch(() => {});
  }
}

// CDP (connectOverCDP) yo'lida context.addInitScript VA page.addInitScript YANGI
// hujjatlarga ISHLAMAYDI (no-op — runtime stealth:check bilan tasdiqlandi: wrap
// chaqirildi, applyAll xatosiz tugadi, lekin skript bajarilmadi). Shuning uchun
// CDP'da context.newPage'ni O'RAYMIZ va spoof'ni RAW CDP (injectCdpSources ->
// Page.addScriptToEvaluateOnNewDocument) bilan AWAIT qilib injeksiya qilamiz —
// page qaytishidan oldin tugaydi, shunda caller'ning goto'si POYGA QILMAYDI.
// context.on("page") zaxira handler QO'YMAYMIZ (u await kafolatini buzardi).
// Booking callerlari faqat newPage ishlatadi; Turnstile sahifa ICHIDAGI iframe'da.
async function applyCdpStealth(
  context: import("playwright").BrowserContext,
  profileKey?: string | null,
): Promise<void> {
  // newPage'ni o'raymiz: AWAIT bilan -> raw CDP injeksiya goto'dan oldin tugaydi.
  // context.newPage() argumentsiz (Playwright — page opsiyalari context darajasida).
  const origNewPage = context.newPage.bind(context);
  (context as any).newPage = async () => {
    const page = await origNewPage();
    await injectCdpSources(context, page, profileKey).catch(() => {});
    return page;
  };
  // Mavjud page(lar) (spawn'dagi about:blank) — best-effort.
  for (const p of context.pages()) {
    await injectCdpSources(context, p, profileKey).catch(() => {});
  }
}

// Real brauzerga o'xshatish uchun fingerprint sozlamalari (.env'dan override).
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Per-akkaunt fingerprint xilma-xilligi: bir nechta REAL Windows Chrome
// versiyasi + keng tarqalgan viewport. Har profileKey shulardan BIRINI barqaror
// (har safar bir xil) tanlaydi — shunda bitta serverdan ochilgan akkauntlar
// bir xil UA/oyna o'lchamiga ega bo'lib "bitta manba" deb bog'lanmaydi, lekin
// bitta akkaunt har doim o'zining bir xil belgisini saqlaydi (barqaror).
const UA_POOL: string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
];
const VIEWPORT_POOL: Array<{ width: number; height: number }> = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
];

// profileKey'dan barqaror (deterministik) son — variant tanlash uchun.
function fpHash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Apparat fingerprint pool'lari: REAL Windows GPU (ANGLE/D3D11 renderer string),
// keng tarqalgan CPU yadrolari va RAM. Har profileKey shulardan BIRINI barqaror
// tanlaydi. .env override: BOOKING_WEBGL_VENDOR / BOOKING_WEBGL_RENDERER /
// BOOKING_HW_CORES / BOOKING_HW_MEMORY.
type HwFp = { vendor: string; renderer: string; cores: number; memory: number };
export type { HwFp };
const GPU_POOL: Array<{ vendor: string; renderer: string }> = [
  {
    vendor: "Google Inc. (Intel)",
    renderer:
      "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (Intel)",
    renderer:
      "ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (NVIDIA)",
    renderer:
      "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  {
    vendor: "Google Inc. (AMD)",
    renderer:
      "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
];
// deviceMemory spetsifikatsiya bo'yicha faqat 4/8 kabi qiymatlar (max 8).
const CORES_POOL = [4, 8, 8, 12, 16];
const MEM_POOL = [8, 8, 4, 8];

// profileKey'dan barqaror apparat fingerprint (vendor/renderer/cores/memory).
export function hardwareFp(profileKey?: string | null): HwFp {
  const key = (profileKey || "").trim().toLowerCase();
  const h = key ? fpHash(key) : 0;
  const gpu = GPU_POOL[h % GPU_POOL.length];
  const cores = CORES_POOL[(h >>> 4) % CORES_POOL.length];
  const memory = MEM_POOL[(h >>> 8) % MEM_POOL.length];
  return {
    vendor: (process.env.BOOKING_WEBGL_VENDOR || gpu.vendor).trim(),
    renderer: (process.env.BOOKING_WEBGL_RENDERER || gpu.renderer).trim(),
    cores: Number(process.env.BOOKING_HW_CORES || cores) || cores,
    memory: Number(process.env.BOOKING_HW_MEMORY || memory) || memory,
  };
}

// Proxy davlatiga mos timezone + til (Accept-Language). Exit IP qaysi davlatda
// bo'lsa, timezone va til SHU davlatga moslashadi — aks holda anti-bot (Cloudflare)
// IP-timezone nomuvofiqligini sezadi va captcha/blok beradi.
const COUNTRY_FP: Record<
  string,
  { timezone: string; locale: string; acceptLanguage: string }
> = {
  uz: {
    timezone: "Asia/Tashkent",
    locale: "ru-RU",
    acceptLanguage: "uz-UZ,uz;q=0.9,ru;q=0.8,en;q=0.7",
  },
  kz: {
    timezone: "Asia/Almaty",
    locale: "ru-RU",
    acceptLanguage: "ru-RU,ru;q=0.9,kk;q=0.8,en;q=0.7",
  },
  ru: {
    timezone: "Europe/Moscow",
    locale: "ru-RU",
    acceptLanguage: "ru-RU,ru;q=0.9,en;q=0.8",
  },
};

function fingerprintOptions(
  country?: string | null,
  profileKey?: string | null,
) {
  // Exit IP davlatiga mos fingerprint (uz/kz/...). Topilmasa — .env yoki default.
  const cc = (country || "").trim().toLowerCase();
  const geo = COUNTRY_FP[cc];

  const locale = (process.env.BOOKING_LOCALE || geo?.locale || "en-US").trim();

  // Per-akkaunt barqaror tanlov: profileKey bo'lsa pool'dan deterministik
  // UA + viewport olamiz (har akkauntga boshqacha, lekin o'ziga har safar bir
  // xil). .env BOOKING_USER_AGENT/BOOKING_VIEWPORT berilsa — u har doim ustun.
  const key = (profileKey || "").trim().toLowerCase();
  const h = key ? fpHash(key) : 0;
  const pooledUA = key ? UA_POOL[h % UA_POOL.length] : DEFAULT_USER_AGENT;
  const pooledVp = key
    ? VIEWPORT_POOL[(h >>> 8) % VIEWPORT_POOL.length]
    : { width: 1366, height: 768 };

  const userAgent = (process.env.BOOKING_USER_AGENT || pooledUA).trim();
  const timezoneId = (
    process.env.BOOKING_TIMEZONE ||
    geo?.timezone ||
    "Asia/Tashkent"
  ).trim();
  const acceptLanguage = (
    process.env.BOOKING_ACCEPT_LANGUAGE ||
    geo?.acceptLanguage ||
    `${locale},en;q=0.9`
  ).trim();

  const vpEnv = (process.env.BOOKING_VIEWPORT || "").trim();
  const m = vpEnv.match(/^(\d{3,5})\s*[x×]\s*(\d{3,5})$/i);
  const viewport = m ? { width: Number(m[1]), height: Number(m[2]) } : pooledVp;
  return {
    userAgent,
    locale,
    timezoneId,
    viewport,
    deviceScaleFactor: 1,
    extraHTTPHeaders: {
      "Accept-Language": acceptLanguage,
    } as Record<string, string>,
  };
}

// Stealth plugin faqat bir marta ulanadi (chromium global obyektga).
let stealthApplied = false;
async function getStealthChromium() {
  // playwright-extra chromium'ni puppeteer-extra-plugin-stealth bilan o'raydi —
  // navigator.webdriver, plugins, languages, WebGL kabi bot-belgilarini yashiradi.
  // DIQQAT: stealth ba'zan Turnstile'ni buzadi (a[c] is not a function). Real
  // Chrome profili bilan ishlasangiz stealth shart emas — .env: BOOKING_STEALTH=false.
  const mod: any = await import("playwright-extra");
  const chromium = mod.chromium ?? mod.default?.chromium ?? mod.default;
  const stealthOff =
    (process.env.BOOKING_STEALTH || "true").trim().toLowerCase() === "false";
  if (stealthOff) return chromium;
  if (!stealthApplied) {
    try {
      const stealthMod: any = await import("puppeteer-extra-plugin-stealth");
      const StealthPlugin = stealthMod.default ?? stealthMod;
      chromium.use(StealthPlugin());
      stealthApplied = true;
    } catch {
      // Stealth ulanmasa ham oddiy chromium bilan davom etamiz.
    }
  }
  return chromium;
}

/** Gmail/profil kalitini papka nomi uchun xavfsiz holatga keltiradi. */
export function sanitizeProfileKey(key: string): string {
  return (key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

/**
 * Profil papkasini aniqlaydi.
 *  - profileKey berilsa (har bir userning gmail'i): register va order BIR XIL
 *    papkani ulashadi — shu sababli cookies/localStorage/sessiya saqlanadi va
 *    register bilan booking adashmaydi.
 *  - aks holda: eski xulq (bosqich bo'yicha alohida papka).
 */
export function profileDirFor(
  stage: Stage,
  profileKey?: string | null,
): string {
  const base = (process.env.BOOKING_PROFILE_DIR || "").trim();
  if (!base) return "";
  const safe = profileKey ? sanitizeProfileKey(profileKey) : "";
  if (safe) return `${base}/u-${safe}`;
  return `${base}-${stage}`;
}

// Chrome profilini ochiq turganda ham ishlatish uchun: kerakli fayllarni
// vaqtinchalik papkaga nusxalaymiz (Chrome'ni yopish shart emas). Cache kabi
// og'ir/keraksiz papkalar tashlab ketiladi. Qulflangan fayl xatosi e'tiborsiz.
const COPY_SKIP_DIRS = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "GraphiteDawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Service Worker",
  "Application Cache",
  "Cache Storage",
  "GrShaderCache",
  "ShaderCache",
  "component_crx_cache",
  "extensions_crx_cache",
  "Crashpad",
]);

function copyDirSafe(src: string, dst: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch {
    return;
  }
  fs.mkdirSync(dst, { recursive: true });
  for (const e of entries) {
    if (e.isDirectory() && COPY_SKIP_DIRS.has(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      copyDirSafe(s, d);
    } else {
      try {
        fs.copyFileSync(s, d);
      } catch {
        // qulflangan fayl (masalan ochiq Chrome) — tashlab ketamiz.
      }
    }
  }
}

/**
 * Sessiyani tozalaydi, LEKIN HTTP cache'ni (Angular JS bundle) saqlaydi.
 * Fresh rejimda har user toza bo'lishi kerak (cookie/login yo'q), lekin og'ir
 * statik JS/CSS bundle qayta yuklanmasligi uchun Cache papkalari qoldiriladi.
 * Faqat cookie/login/storage fayllarini o'chiradi.
 */
function clearSessionKeepCache(userDataDir: string): void {
  if (!fs.existsSync(userDataDir)) return;
  // O'chiriladigan sessiya artefaktlari (Default profil ichida va ildizda).
  const sessionTargets = [
    "Default/Cookies",
    "Default/Cookies-journal",
    "Default/Network/Cookies",
    "Default/Network/Cookies-journal",
    "Default/Login Data",
    "Default/Login Data-journal",
    "Default/Local Storage",
    "Default/Session Storage",
    "Default/IndexedDB",
    "Default/Service Worker",
    "Default/Sessions",
    "Default/Web Data",
    "Default/Web Data-journal",
  ];
  for (const rel of sessionTargets) {
    try {
      fs.rmSync(path.join(userDataDir, rel), {
        recursive: true,
        force: true,
      });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Haqiqiy Chrome User Data'dan tanlangan profilni vaqtinchalik papkaga nusxalaydi
 * (Local State + profil papkasi). Chrome ochiq bo'lsa ham ishlaydi. Natijada
 * Playwright shu nusxa orqali xuddi o'sha hisob (cookies/login) bilan ochadi.
 * Yo'l qaytaradi (vaqtinchalik User Data dir) yoki muvaffaqiyatsizlikda null.
 */
function prepareCopiedUserDataDir(
  srcUserData: string,
  profile: string,
): string | null {
  try {
    if (!fs.existsSync(srcUserData)) return null;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "visa-chrome-"));
    // Local State (cookie shifrlash kaliti shu yerda).
    const ls = path.join(srcUserData, "Local State");
    if (fs.existsSync(ls)) {
      try {
        fs.copyFileSync(ls, path.join(tmp, "Local State"));
      } catch {
        /* ignore */
      }
    }
    // Profil papkasi (Cookies, Login Data, Local Storage, Network, ...).
    const prof = profile || "Default";
    copyDirSafe(path.join(srcUserData, prof), path.join(tmp, prof));
    return tmp;
  } catch {
    return null;
  }
}

/** chrome.exe yo'lini topadi (.env: BOOKING_CHROME_PATH yoki standart joylar). */
function findChromeExe(): string | null {
  const env = (process.env.BOOKING_CHROME_PATH || "").trim();
  if (env && fs.existsSync(env)) return env;
  // Linux/Docker (mcr playwright image: `npx playwright install chrome` o'rnatadi).
  const linuxCandidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const winCandidates = [
    `${process.env["ProgramFiles"] || "C:/Program Files"}/Google/Chrome/Application/chrome.exe`,
    `${process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)"}/Google/Chrome/Application/chrome.exe`,
    `${process.env["LOCALAPPDATA"] || ""}/Google/Chrome/Application/chrome.exe`,
  ];
  const candidates =
    process.platform === "win32" ? winCandidates : linuxCandidates;
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** CDP endpoint (http://127.0.0.1:PORT) tayyor bo'lguncha kutadi. */
async function waitForCdp(port: number, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return true;
    } catch {
      /* hali tayyor emas */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** OS bergan bo'sh TCP portni topadi (parallel userlar to'qnashmasligi uchun). */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** ProxyConfig'dan to'liq URL (login/parol bilan) yasaydi: scheme://user:pass@host:port */
function fullProxyUrl(p: ProxyConfig): string {
  const m = p.server.match(/^(\w+):\/\/(.+)$/);
  const scheme = m ? m[1] : "http";
  const hostport = m ? m[2] : p.server;
  const u = encodeURIComponent(p.username);
  const pw = encodeURIComponent(p.password);
  return `${scheme}://${u}:${pw}@${hostport}`;
}

/**
 * HAQIQIY Chrome'ni o'zimiz (chrome.exe) debug porti bilan ishga tushirib,
 * connectOverCDP orqali ulanamiz. Playwright launch() ishlatmaymiz — shuning
 * uchun "--enable-automation" kabi belgilar yo'q va Turnstile uni oddiy Chrome
 * deb ko'radi.
 *
 *  PARALLEL: har user uchun BO'SH port + ALOHIDA profil papka olinadi, shuning
 *  uchun 30-40 user bir vaqtda ishlay oladi (bir-biriga xalal bermaydi).
 *
 *  PROXY: chrome.exe login/parolli proxy'ni qabul qilmaydi. Shu sababli
 *  IPRoyal proxy'sini `proxy-chain` orqali LOKAL parolsiz portga o'rab,
 *  chrome'ga `--proxy-server=http://127.0.0.1:PORT` beramiz. Har user o'z
 *  sticky IP'sini oladi (proxyFor(profileKey)).
 *
 *  PROFIL: har user (profileKey) o'z persistent papkasida saqlanadi
 *  (BOOKING_CDP_PROFILE_DIR yoki BOOKING_PROFILE_DIR ostida) — register->login
 *  ->order davomida sessiya/cookie saqlanadi. Agar BOOKING_CHROME_USER_DATA_DIR
 *  + COPY berilsa, real Chrome profili (Profile 3) nusxasi ishlatiladi.
 */
async function connectRealChrome(opts?: {
  proxy?: ProxyConfig;
  profileKey?: string | null;
  /** Har urinishda toza profil (eski cookie/cache buzilgan bo'lsa). */
  attempt?: number;
  /** CDP profil bazasini majburan belgilash (slot-monitor uchun alohida papka). */
  cdpProfileBase?: string;
  /** BOOKING_CDP_FRESH_PROFILE env'ni bekor qilib, sessiyani saqlash/tozalashni majburlash. */
  cdpFreshProfile?: boolean;
}): Promise<{
  context: import("playwright").BrowserContext;
  close: () => Promise<void>;
} | null> {
  const exe = findChromeExe();
  if (!exe) return null;

  // --- Profil papkasi (persistent per-user yoki real Chrome nusxasi) ---
  const realUserData = (process.env.BOOKING_CHROME_USER_DATA_DIR || "").trim();
  const realProfile = (process.env.BOOKING_CHROME_PROFILE || "Default").trim();
  const copyMode =
    (process.env.BOOKING_CHROME_COPY_PROFILE || "").trim().toLowerCase() ===
    "true";
  // Har ishga tushganda profilni TOZALAB ishlatish (eski/buzilgan sessiya
  // muammosini oldini oladi). .env: BOOKING_CDP_FRESH_PROFILE=true.
  // opts.cdpFreshProfile berilsa — env'dan ustun (slot-monitor sessiyani saqlaydi).
  const freshProfile =
    opts?.cdpFreshProfile ??
    (process.env.BOOKING_CDP_FRESH_PROFILE || "").trim().toLowerCase() ===
      "true";

  const keySafe = sanitizeProfileKey(opts?.profileKey || "default");
  let userDataDir: string;
  let profileArg = "Default";
  let isTempCopy = false;

  if (realUserData && copyMode) {
    // Real Chrome profili (Profile 3) nusxasi — vaqtinchalik, yopilganda o'chadi.
    const copied = prepareCopiedUserDataDir(realUserData, realProfile);
    if (copied) {
      userDataDir = copied;
      profileArg = realProfile;
      isTempCopy = true;
    } else {
      userDataDir = realUserData;
      profileArg = realProfile;
    }
  } else {
    // Har user o'z persistent papkasida (yangi profil — Turnstile'ni
    // chrome.exe binarining o'zi o'tadi, Profile 3 cookie'lari shart emas).
    const base = (
      opts?.cdpProfileBase ||
      process.env.BOOKING_CDP_PROFILE_DIR ||
      process.env.BOOKING_PROFILE_DIR ||
      path.join(os.tmpdir(), "visa-cdp-profiles")
    ).trim();
    userDataDir = path.join(base, keySafe);
    // Fresh rejimda (yoki qayta urinishda) eski SESSIYANI tozalaymiz.
    // TEZLIK: HTTP cache (Cache/Code Cache — Angular JS bundle shu yerda) ni
    // SAQLAB qolamiz, faqat cookie/login/storage ni o'chiramiz. Shunda har user
    // toza (cookie yo'q), lekin og'ir JS bundle qayta yuklanmaydi (~15-20s tejaydi).
    // .env BOOKING_CDP_KEEP_CACHE=false bo'lsa — eski xulq (hammasi o'chadi).
    const keepCache =
      (process.env.BOOKING_CDP_KEEP_CACHE || "true").trim().toLowerCase() !==
      "false";
    if (freshProfile || (opts?.attempt ?? 0) > 0) {
      try {
        if (keepCache) {
          clearSessionKeepCache(userDataDir);
        } else {
          fs.rmSync(userDataDir, { recursive: true, force: true });
        }
      } catch {
        /* ignore */
      }
    }
    fs.mkdirSync(userDataDir, { recursive: true });
    profileArg = "Default";
  }

  // --- Proxy (proxy-chain orqali lokal parolsiz portga o'rab) ---
  let localProxyUrl: string | null = null;
  if (opts?.proxy) {
    try {
      const proxyChain = await import("proxy-chain");
      localProxyUrl = await proxyChain.anonymizeProxy(fullProxyUrl(opts.proxy));
    } catch {
      localProxyUrl = null; // o'rash muvaffaqiyatsiz
    }
    // FAIL-CLOSED: proxy TALAB qilingan (opts.proxy bor), lekin o'ralmadi.
    // Eski xulq proxy'siz davom etardi — bu xavfli (real server IP ochiq
    // chiqib ketadi). Default: CDP'ni BEKOR qilamiz (null qaytaramiz) —
    // yuqori oqim launch yo'liga tushadi va proxy'ni Playwright'ning o'ziga
    // (login/parol bilan) beradi, ya'ni IP baribir yashiringan qoladi.
    // .env BOOKING_PROXY_FAIL_OPEN=true bo'lsa — eski (xavfli) xulq: direct.
    if (!localProxyUrl) {
      const failOpen =
        (process.env.BOOKING_PROXY_FAIL_OPEN || "").trim().toLowerCase() ===
        "true";
      if (!failOpen) {
        return null; // proxy o'ralmadi — direct'ga tushmaymiz (IP leak oldini olish)
      }
    }
  }

  // --- chrome.exe ni bo'sh portda ishga tushirish ---
  const port = await findFreePort();
  // Docker/Linux: ekran yo'q => headless kerak; sandbox root'da ishlamaydi.
  const isLinux = process.platform !== "win32";
  // Linux'da DISPLAY (Xvfb) bo'lsa NON-headless ishlay olamiz — bu Turnstile
  // interaktiv checkbox + xdotool OS-klik uchun zarur. DISPLAY yo'q bo'lsa
  // (oddiy headless konteyner) Chrome ko'rinadigan rejimda ishga tushmaydi,
  // shuning uchun xavfsizlik uchun headless'ga qaytaramiz.
  const hasDisplay = !!(process.env.DISPLAY || "").trim();
  let headless = envHeadless();
  if (isLinux && !headless && !hasDisplay) {
    headless = true; // ekran yo'q — majburan headless (aks holda Chrome yiqiladi)
  }
  const dockerArgs: string[] = [];
  if (isLinux) {
    // Konteynerda root => --no-sandbox shart. /dev/shm kichik => disable.
    dockerArgs.push("--no-sandbox", "--disable-dev-shm-usage");
    if (headless) {
      // Yangi headless rejimi — haqiqiy Chrome'ga eng yaqin (Turnstile uchun).
      dockerArgs.push("--headless=new", "--disable-gpu");
    } else {
      // Xvfb virtual ekranida KO'RINADIGAN oyna — xdotool OS-klik koordinatasi
      // aniq bo'lishi uchun oynani 0,0 ga belgilangan o'lchamda ochamiz.
      const size = (process.env.BOOKING_WINDOW_SIZE || "1280,1024").trim();
      dockerArgs.push("--window-position=0,0", `--window-size=${size}`);
    }
  }
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileArg}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--restore-last-session=false",
    "--disable-session-crashed-bubble",
    // TEZLIK: Angular JS bajarilishini tezlashtiradi — oyna fonda/fokussiz
    // bo'lsa ham timer/renderer sekinlashmaydi (bot-belgisi EMAS).
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-ipc-flooding-protection",
    // WEBRTC IP LEAK himoyasi (CDP yo'li): real server IP STUN/UDP orqali
    // sizib chiqmasligi uchun — launch yo'lidagi bilan bir xil.
    ...webrtcLeakArgs(),
    ...dockerArgs,
    ...(localProxyUrl ? [`--proxy-server=${localProxyUrl}`] : []),
    "about:blank",
  ];

  const child: ChildProcess = spawn(exe, args, {
    detached: false,
    stdio: "ignore",
  });
  // OS-click (Turnstile fizik klik) uchun PID'ni eslab qolamiz.
  lastSpawnedChromePid = child.pid ?? null;

  const cleanupProxy = async () => {
    if (localProxyUrl) {
      try {
        const proxyChain = await import("proxy-chain");
        await proxyChain.closeAnonymizedProxy(localProxyUrl, true);
      } catch {
        /* ignore */
      }
    }
  };

  const ready = await waitForCdp(port, 25000);
  if (!ready) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    await cleanupProxy();
    return null;
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0] || (await browser.newContext());

  // Stealth init-skriptlar (WebRTC guard + apparat spoof) CDP yo'lida
  // openBrowserContext -> applyCdpStealth orqali HAR PAGE darajada qo'shiladi
  // (context.addInitScript connectOverCDP'da yangi page'larga ishonchsiz).

  return {
    context,
    close: async () => {
      // Brauzerni yopamiz (bu o'zimiz ochgan Chrome — userniki emas).
      await browser.close().catch(() => {});
      try {
        // MUHIM (Windows): child.kill() faqat launcher jarayonini o'ldiradi —
        // Chrome jarayon DARAXTI (browser + renderer + gpu + oyna) ochiq qoladi.
        // taskkill /T (daraxt) /F (majburan) bilan BUTUN daraxtni yopamiz,
        // aks holda har testdan keyin Chrome oynasi (masalan 403201 sahifasi)
        // osilib qoladi. Linux/mac'da oddiy kill yetarli (renderer'lar bola).
        if (process.platform === "win32" && child.pid) {
          spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
          });
        } else {
          child.kill();
        }
      } catch {
        /* ignore */
      }
      await cleanupProxy();
      // Faqat vaqtinchalik nusxani o'chiramiz; persistent profilni saqlaymiz.
      if (isTempCopy) {
        fs.rm(userDataDir, { recursive: true, force: true }, () => {});
      }
    },
  };
}

/**
 * Brauzer context'ini ochadi (CDP / haqiqiy Chrome profili / persistent / launch).
 * Qaytaradi: { context, close }. Hech qachon throw qilmaydi (yuqori oqim qiladi).
 */
export async function openBrowserContext(
  profileDir: string,
  proxyTarget?: ProxyTarget,
  cdpOpts?: { cdpProfileBase?: string; cdpFreshProfile?: boolean },
) {
  const chromium = await getStealthChromium();
  const proxy = proxyTarget ? proxyFor(proxyTarget) : undefined;
  // Fingerprint'ni proxy exit IP davlatiga moslaymiz (timezone + til) va
  // profileKey bo'yicha barqaror UA/viewport tanlaymiz (akkauntlar bog'lanmasin).
  const proxyCountry = proxyTarget ? proxyMetaFor(proxyTarget)?.country : null;
  const fp = fingerprintOptions(proxyCountry, proxyTarget?.profileKey ?? null);

  // CDP rejimi: haqiqiy chrome.exe'ni o'zimiz ochib connectOverCDP bilan ulanamiz
  // (Turnstile uchun eng tabiiy — Playwright launch belgilarisiz). .env:
  // BOOKING_CHROME_CDP=true + BOOKING_CHROME_USER_DATA_DIR + BOOKING_CHROME_PROFILE.
  const cdpMode =
    (process.env.BOOKING_CHROME_CDP || "").trim().toLowerCase() === "true";
  if (cdpMode) {
    const real = await connectRealChrome({
      proxy,
      profileKey: proxyTarget?.profileKey ?? null,
      attempt: proxyTarget?.ipAttempt ?? 0,
      cdpProfileBase: cdpOpts?.cdpProfileBase,
      cdpFreshProfile: cdpOpts?.cdpFreshProfile,
    });
    if (real) {
      // CDP yo'lida stealth init-skriptlar (WebRTC guard + WebGL/CPU/RAM spoof)
      // HAR PAGE darajada qo'shiladi (applyCdpStealth): context.addInitScript
      // connectOverCDP'da yangi page'larga ISHONCHSIZ (runtime testda tasdiqlandi).
      // navigator.languages'ni CDP'da O'ZGARTIRMAYMIZ — real Chrome HTTP
      // Accept-Language header bilan nomuvofiqlik bo'lmasin.
      await applyCdpStealth(real.context, proxyTarget?.profileKey ?? null);
      return real;
    }
    // CDP muvaffaqiyatsiz bo'lsa — oddiy rejimga tushamiz (pastda).
  }

  // Tizimdagi haqiqiy Chrome (kanal) ishlatish — .env: BOOKING_BROWSER_CHANNEL=chrome
  // (yoki "msedge"). Bo'sh bo'lsa Playwright'ning ichki chromium'i ishlatiladi.
  const channel = (process.env.BOOKING_BROWSER_CHANNEL || "").trim();

  // Haqiqiy Chrome profili (khurshidi2827@gmail.com kabi) bilan kirish:
  //   BOOKING_CHROME_USER_DATA_DIR = "C:/Users/PC/AppData/Local/Google/Chrome/User Data"
  //   BOOKING_CHROME_PROFILE       = "Default" yoki "Profile 1" ...
  // DIQQAT: bu rejimda Chrome TO'LIQ yopilgan bo'lishi kerak (profil qulflanadi).
  const realUserDataDir = (
    process.env.BOOKING_CHROME_USER_DATA_DIR || ""
  ).trim();
  const realProfile = (process.env.BOOKING_CHROME_PROFILE || "").trim();

  if (realUserDataDir) {
    // Chrome ochiq bo'lsa profil qulflanadi. COPY rejimi: profilni vaqtinchalik
    // papkaga nusxalab, o'shani ishlatamiz (Chrome'ni yopish shart emas).
    const useCopy =
      (process.env.BOOKING_CHROME_COPY_PROFILE || "").trim().toLowerCase() ===
      "true";
    let userDataDir = realUserDataDir;
    let profileArg = realProfile;
    if (useCopy) {
      const copied = prepareCopiedUserDataDir(
        realUserDataDir,
        realProfile || "Default",
      );
      if (copied) {
        userDataDir = copied;
        profileArg = realProfile || "Default";
      }
    }
    const args = [...launchArgs()];
    if (profileArg) args.push(`--profile-directory=${profileArg}`);
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: envHeadless(),
      channel: channel || "chrome",
      args,
      ...(proxy ? { proxy } : {}),
      viewport: fp.viewport,
      timezoneId: fp.timezoneId,
      locale: fp.locale,
      extraHTTPHeaders: fp.extraHTTPHeaders,
    });
    await applyStealthInit(
      context,
      fp.extraHTTPHeaders["Accept-Language"],
      proxyTarget?.profileKey ?? null,
    );
    return {
      context,
      close: async () => {
        await context.close().catch(() => {});
        if (useCopy && userDataDir !== realUserDataDir) {
          fs.rm(userDataDir, { recursive: true, force: true }, () => {});
        }
      },
    };
  }

  if (profileDir) {
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: envHeadless(),
      ...(channel ? { channel } : {}),
      args: launchArgs(),
      ...(proxy ? { proxy } : {}),
      userAgent: fp.userAgent,
      locale: fp.locale,
      timezoneId: fp.timezoneId,
      viewport: fp.viewport,
      deviceScaleFactor: fp.deviceScaleFactor,
      extraHTTPHeaders: fp.extraHTTPHeaders,
    });
    await applyStealthInit(
      context,
      fp.extraHTTPHeaders["Accept-Language"],
      proxyTarget?.profileKey ?? null,
    );
    return {
      context,
      close: async () => context.close(),
    };
  }

  const browser = await chromium.launch({
    headless: envHeadless(),
    ...(channel ? { channel } : {}),
    args: launchArgs(),
    ...(proxy ? { proxy } : {}),
  });
  const context = await browser.newContext({
    userAgent: fp.userAgent,
    locale: fp.locale,
    timezoneId: fp.timezoneId,
    viewport: fp.viewport,
    deviceScaleFactor: fp.deviceScaleFactor,
    extraHTTPHeaders: fp.extraHTTPHeaders,
  });
  await applyStealthInit(
    context,
    fp.extraHTTPHeaders["Accept-Language"],
    proxyTarget?.profileKey ?? null,
  );
  return {
    context,
    close: async () => browser.close(),
  };
}
