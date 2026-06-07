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
import { spawn, type ChildProcess } from "child_process";
import type { Stage } from "./types";

export function envHeadless(): boolean {
  const v = (process.env.BOOKING_HEADLESS || "true").toLowerCase();
  return v !== "false" && v !== "0";
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
  ];
}

// Proxy trafigini TEJASH: og'ir resurslarni (rasm, shrift, video, audio) va
// keraksiz analytics/tracker domenlarini bloklaydi. Cloudflare/Turnstile va
// VFS uchun zarur skript/CSS/XHR'lar O'TKAZILADI (aks holda captcha buziladi).
// .env: BOOKING_BLOCK_RESOURCES=false bo'lsa o'chadi (default: yoqilgan).
const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);
const BLOCKED_URL_PATTERNS = [
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
  "fonts.gstatic.com",
  "fonts.googleapis.com",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
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
  await context.route("**/*", (route) => {
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
      } catch {
        /* ignore */
      }
    }, langs)
    .catch(() => {});
}

// Real brauzerga o'xshatish uchun fingerprint sozlamalari (.env dan override).
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

function fingerprintOptions(country?: string | null) {
  const userAgent = (
    process.env.BOOKING_USER_AGENT || DEFAULT_USER_AGENT
  ).trim();

  // Exit IP davlatiga mos fingerprint (uz/kz/...). Topilmasa — .env yoki default.
  const cc = (country || "").trim().toLowerCase();
  const geo = COUNTRY_FP[cc];

  const locale = (process.env.BOOKING_LOCALE || geo?.locale || "en-US").trim();
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

  const vp = (process.env.BOOKING_VIEWPORT || "1366x768").trim();
  const m = vp.match(/^(\d{3,5})\s*[x×]\s*(\d{3,5})$/i);
  const viewport = m
    ? { width: Number(m[1]), height: Number(m[2]) }
    : { width: 1366, height: 768 };
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
  const candidates = [
    `${process.env["ProgramFiles"] || "C:/Program Files"}/Google/Chrome/Application/chrome.exe`,
    `${process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)"}/Google/Chrome/Application/chrome.exe`,
    `${process.env["LOCALAPPDATA"] || ""}/Google/Chrome/Application/chrome.exe`,
  ];
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
  const freshProfile =
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
      process.env.BOOKING_CDP_PROFILE_DIR ||
      process.env.BOOKING_PROFILE_DIR ||
      path.join(os.tmpdir(), "visa-cdp-profiles")
    ).trim();
    userDataDir = path.join(base, keySafe);
    // Fresh rejimda (yoki qayta urinishda) eski profilni o'chirib yangidan
    // boshlaymiz — buzilgan cookie/cache sahifa skriptlarini buzmasin.
    if (freshProfile || (opts?.attempt ?? 0) > 0) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
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
      localProxyUrl = null; // proxy o'ralmadi — proxy'siz davom etamiz.
    }
  }

  // --- chrome.exe ni bo'sh portda ishga tushirish ---
  const port = await findFreePort();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileArg}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--restore-last-session=false",
    "--disable-session-crashed-bubble",
    ...(localProxyUrl ? [`--proxy-server=${localProxyUrl}`] : []),
    "about:blank",
  ];

  const child: ChildProcess = spawn(exe, args, {
    detached: false,
    stdio: "ignore",
  });

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

  return {
    context,
    close: async () => {
      // Brauzerni yopamiz (bu o'zimiz ochgan Chrome — userniki emas).
      await browser.close().catch(() => {});
      try {
        child.kill();
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
) {
  const chromium = await getStealthChromium();
  const proxy = proxyTarget ? proxyFor(proxyTarget) : undefined;
  // Fingerprint'ni proxy exit IP davlatiga moslaymiz (timezone + til).
  const proxyCountry = proxyTarget ? proxyMetaFor(proxyTarget)?.country : null;
  const fp = fingerprintOptions(proxyCountry);

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
    });
    if (real) return real;
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
    await applyStealthInit(context, fp.extraHTTPHeaders["Accept-Language"]);
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
    await applyStealthInit(context, fp.extraHTTPHeaders["Accept-Language"]);
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
  await applyStealthInit(context, fp.extraHTTPHeaders["Accept-Language"]);
  return {
    context,
    close: async () => browser.close(),
  };
}
