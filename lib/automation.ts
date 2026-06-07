/**
 * ====================================================================
 *  BOOKING AVTOMATLASHTIRISH — Playwright bilan generic forma to'ldirgich
 * ====================================================================
 *  Ikki bosqich: "register" (ro'yxatdan o'tkazish) va "order" (buyurtma).
 *  URL'lar .env dan keladi (BOOKING_REGISTER_URL / BOOKING_ORDER_URL).
 *
 *  Engine sahifadagi formani avtomatik topadi: har bir input/select ni
 *  uning name/id/placeholder/label matni bo'yicha arizachi maydoniga
 *  moslaydi va to'ldiradi, so'ng "submit" tugmasini bosadi.
 *
 *  HECH QACHON exception tashlamaydi — har doim natija obyektini qaytaradi.
 *  Shu sababli CRM oqimi (status yangilash) buzilmaydi.
 * ====================================================================
 */

import {
  proxyFor,
  proxyMetaFor,
  proxyIpEchoUrl,
  shouldLogExitIp,
  isProxyEnabled,
  type ProxyTarget,
  type ProxyConfig,
} from "./proxy";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as net from "net";
import { spawn, type ChildProcess } from "child_process";
export type AutomationApplicant = {
  surname: string;
  name: string;
  passportNumber: string;
  nationality?: string | null;
  gender?: string | null;
  birthdate?: string | null;
  passportValidity?: string | null;
  phone?: string | null;
  email?: string | null;
  generatedEmail?: string | null;
};

export type AutomationResult = {
  ok: boolean;
  ref: string | null; // sahifadan topilgan tasdiqlash/appointment raqami
  note: string; // qisqa natija izohi (resultNote uchun)
  filled: string[]; // to'ldirilgan maydonlar ro'yxati
  url: string; // boshlang'ich (target) URL
  finalUrl: string; // urinish oxirida brauzer turgan URL
  visitedUrls: string[]; // urinish davomida ochilgan barcha URL'lar (tartib bilan)
  proxyServer: string | null; // ulangan proxy gateway (host:port) yoki null
  proxyCountry: string | null; // proxy davlati (uz/kz)
  proxySession: string | null; // sticky session id (qaysi user IP'si)
  exitIp: string | null; // proxy orqali chiqqan tashqi IP
  statusCode: number | null; // asosiy sahifa HTTP status kodi
  requestedAt: string | null; // "kelgan": navigatsiya boshlangan vaqt (ISO)
  openedAt: string | null; // "ochilgan": sahifa ochilgan/javob kelgan vaqt (ISO)
  navMs: number | null; // sahifa ochilish davomiyligi (ochilgan - kelgan)
  pageError: string | null; // chrome web ochganda chiqqan xatolar (JS/timeout/4xx-5xx)
};

export type ActivationResult = {
  ok: boolean;
  link: string | null; // gmail'dan topilgan aktivatsiya linki
  note: string;
  to: string | null; // qaysi email manziliga xat keldi
  proxyServer: string | null; // register bilan BIR XIL proxy (tasdiq uchun)
  proxyCountry: string | null;
  proxySession: string | null; // register bilan bir xil session id bo'lishi kerak
  exitIp: string | null; // proxy orqali chiqqan IP (register bilan bir xil)
  statusCode: number | null; // aktivatsiya sahifasi HTTP status kodi
  requestedAt: string | null; // "kelgan": link ochish boshlangan vaqt
  openedAt: string | null; // "ochilgan": sahifa ochilgan vaqt
  navMs: number | null; // ochilish davomiyligi
  pageError: string | null; // chrome xatolari
};

type Stage = "register" | "login" | "order";

// Har bir maydon uchun forma elementlarini topish kalit so'zlari (kichik harf).
const FIELD_KEYWORDS: Record<keyof AutomationApplicant, string[]> = {
  surname: ["surname", "lastname", "last_name", "familiya", "fname"],
  name: ["firstname", "first_name", "givenname", "given", "ism", "name"],
  passportNumber: ["passport", "pasport", "document", "docno", "passportno"],
  nationality: ["nationality", "country", "millat", "davlat", "citizenship"],
  gender: ["gender", "sex", "jins"],
  birthdate: ["birth", "dob", "tugilgan", "tug", "dateofbirth", "born"],
  passportValidity: ["validity", "expiry", "expire", "amal", "muddat", "valid"],
  phone: ["phone", "mobile", "tel", "telefon", "contact"],
  email: ["email", "e-mail", "mail", "pochta"],
  generatedEmail: ["systememail", "loginemail"],
};

function envHeadless(): boolean {
  const v = (process.env.BOOKING_HEADLESS || "true").toLowerCase();
  return v !== "false" && v !== "0";
}

// Chromium'ni "boshqarilayotgan brauzer" belgilarisiz ishga tushirish argumentlari.
// --disable-blink-features=AutomationControlled => navigator.webdriver yo'qoladi.
function launchArgs(): string[] {
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

// Inson kabi tasodifiy qisqa kutish.
function rand(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}
async function humanPause(min = 120, max = 380): Promise<void> {
  await new Promise((r) => setTimeout(r, rand(min, max)));
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
function profileDirFor(stage: Stage, profileKey?: string | null): string {
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

/**
 * Debug: sahifa skrinshot + HTML + matn'ni uploads/debug ga saqlaydi.
 * Email/forma topilmaganda nima ko'rinayotganini bilish uchun.
 */
async function dumpDebug(
  page: import("playwright").Page,
  tag: string,
): Promise<void> {
  try {
    const dir = path.join(process.cwd(), "uploads", "debug");
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const baseP = path.join(dir, `${tag}-${ts}`);
    await page
      .screenshot({ path: `${baseP}.png`, fullPage: true })
      .catch(() => {});
    const html = await page.content().catch(() => "");
    fs.writeFileSync(`${baseP}.html`, html, "utf8");
    const title = await page.title().catch(() => "");
    const bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    fs.writeFileSync(
      `${baseP}.txt`,
      `URL: ${page.url()}\nTITLE: ${title}\n\n${bodyText.slice(0, 2000)}`,
      "utf8",
    );
    // eslint-disable-next-line no-console
    console.log(`[debug] saqlandi: ${baseP}.png / .html / .txt`);
  } catch {
    /* ignore */
  }
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

async function openBrowserContext(
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

function urlForStage(stage: Stage): string | null {
  let u: string | undefined;
  if (stage === "order") u = process.env.BOOKING_ORDER_URL;
  else if (stage === "login") u = process.env.BOOKING_LOGIN_URL;
  else u = process.env.BOOKING_REGISTER_URL;
  return u && u.trim() ? u.trim() : null;
}

function stageLabel(stage: Stage): string {
  if (stage === "order") return "Buyurtma";
  if (stage === "login") return "Login";
  return "Ro'yxat";
}

function stageEnvName(stage: Stage): string {
  if (stage === "order") return "ORDER";
  if (stage === "login") return "LOGIN";
  return "REGISTER";
}

export type SlotCheckResult = {
  open: boolean;
  note: string;
  url: string;
};

/**
 * Saytda slot (vaqt oynasi) ochiq-yopiqligini Playwright bilan tekshiradi.
 * URL .env dan: BOOKING_SLOT_URL. Ochiqlik belgilari .env dan moslashtiriladi:
 *   BOOKING_SLOT_OPEN_TEXT   — sahifada shu matn bo'lsa = ochiq
 *   BOOKING_SLOT_CLOSED_TEXT — sahifada shu matn bo'lsa = yopiq
 * Default belgilar: "available/slot/book" = ochiq, "no appointment/closed" = yopiq.
 * Hech qachon exception tashlamaydi.
 */
export async function checkSlotOpen(): Promise<SlotCheckResult> {
  const url = process.env.BOOKING_SLOT_URL?.trim() || "";
  if (!url) {
    return {
      open: false,
      note: "URL sozlanmagan (.env: BOOKING_SLOT_URL)",
      url: "",
    };
  }

  const openText = (process.env.BOOKING_SLOT_OPEN_TEXT || "")
    .split("|")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const closedText = (process.env.BOOKING_SLOT_CLOSED_TEXT || "")
    .split("|")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const defaultOpen = ["available", "book now", "select slot", "free slot"];
  const defaultClosed = [
    "no appointment",
    "no slots",
    "not available",
    "closed",
    "fully booked",
    "band emas",
  ];
  const openMarks = openText.length ? openText : defaultOpen;
  const closedMarks = closedText.length ? closedText : defaultClosed;

  let closeSession: (() => Promise<void>) | null = null;
  try {
    // Slot tekshiruvi har 5 soniyada ishlaydi — har safar YANGI (rotating) IP
    // ishlatamiz, profil saqlamaymiz. Shunda bitta IP monitoring bilan
    // charchab bloklanmaydi va booking IP'lari toza qoladi.
    const session = await openBrowserContext("", { rotating: true });
    closeSession = session.close;

    const page = await session.context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page
      .waitForLoadState("networkidle", { timeout: 8000 })
      .catch(() => {});

    const body = (
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")) || ""
    ).toLowerCase();

    await closeSession();
    closeSession = null;

    const hasClosed = closedMarks.some((m) => body.includes(m));
    const hasOpen = openMarks.some((m) => body.includes(m));
    // Yopiq belgisi ustun: avval yopiqlikni tekshiramiz.
    if (hasClosed) {
      return { open: false, note: "Saytda slot yopiq", url };
    }
    if (hasOpen) {
      return { open: true, note: "Saytda slot ochiq", url };
    }
    // Belgi topilmadi (sayt o'zgargan/yangi sahifa). Monitoring jadval asosida
    // ishlaydi — admin slot vaqtini o'zi belgilaydi. Shuning uchun default'da
    // bunday holatni "ochiq" deb hisoblaymiz va navbatni ishga tushiramiz.
    // Qat'iy rejim kerak bo'lsa: .env BOOKING_SLOT_REQUIRE_MARK=true.
    const requireMark =
      (process.env.BOOKING_SLOT_REQUIRE_MARK || "").trim().toLowerCase() ===
      "true";
    if (requireMark) {
      return {
        open: false,
        note: "Slot holati aniqlanmadi (belgi topilmadi)",
        url,
      };
    }
    return {
      open: true,
      note: "Belgi topilmadi — jadval bo'yicha ochiq deb hisoblandi",
      url,
    };
  } catch (err) {
    if (closeSession) await closeSession().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return {
      open: false,
      note: `Slot tekshirish xatosi: ${msg.slice(0, 200)}`,
      url,
    };
  }
}

export type LoginResult = {
  ok: boolean; // login muvaffaqiyatli bo'ldimi (taxminiy belgilar bo'yicha)
  note: string;
  url: string; // login URL
  finalUrl: string; // login bosgandan keyingi URL
  captchaPresent: boolean;
  captchaSolved: boolean;
  filledEmail: boolean;
  filledPassword: boolean;
  submitted: boolean;
  exitIp: string | null;
  statusCode: number | null;
  pageError: string | null;
};

/**
 * Booking saytiga LOGIN qiladi (BOOKING_LOGIN_URL). Proxy (sticky, email bo'yicha)
 * + stealth + IP'ga mos timezone/til + Turnstile token kutish — hammasi ishlatiladi.
 * Angular Material formasi: email=#email (formcontrolname=username),
 * password=#password (formcontrolname=password), tugma "Sign In".
 * Hech qachon exception tashlamaydi — natija obyektini qaytaradi.
 */
export async function loginToBooking(
  email: string,
  password: string,
  opts?: { profileKey?: string | null; onStep?: (msg: string) => void },
): Promise<LoginResult> {
  const step = (msg: string) => {
    try {
      opts?.onStep?.(msg);
    } catch {
      /* ignore */
    }
  };
  const url = (process.env.BOOKING_LOGIN_URL || "").trim();
  const base: LoginResult = {
    ok: false,
    note: "",
    url,
    finalUrl: "",
    captchaPresent: false,
    captchaSolved: false,
    filledEmail: false,
    filledPassword: false,
    submitted: false,
    exitIp: null,
    statusCode: null,
    pageError: null,
  };
  if (!url) {
    return { ...base, note: "URL sozlanmagan (.env: BOOKING_LOGIN_URL)" };
  }

  const pageErrors: string[] = [];
  let closeSession: (() => Promise<void>) | null = null;
  // Sticky proxy: shu user (email) doim bir xil IP oladi.
  const profileKey = opts?.profileKey || email;

  try {
    let page: import("playwright").Page | null = null;
    // IP bloklansa (403) — necha marta yangi IP bilan qayta urinish.
    const maxIpRetries = Math.max(
      1,
      Number(process.env.BOOKING_PROXY_IP_RETRIES || "4"),
    );
    const proxyOn = isProxyEnabled();

    for (let attempt = 0; attempt < maxIpRetries; attempt++) {
      // Avvalgi (bloklangan) sessiyani yopamiz.
      if (closeSession) {
        await closeSession().catch(() => {});
        closeSession = null;
      }

      const session = await openBrowserContext(
        profileDirFor("login", profileKey),
        { profileKey, ipAttempt: attempt },
      );
      closeSession = session.close;
      step(
        attempt === 0
          ? "Brauzer ochildi (stealth + proxy)"
          : `Yangi IP bilan qayta urinish #${attempt + 1}...`,
      );

      const p = await session.context.newPage();
      page = p;
      p.on("pageerror", (e: Error) => {
        pageErrors.push(`JS: ${e.message}`.slice(0, 200));
      });
      p.on("response", (res: import("playwright").Response) => {
        const s = res.status();
        if (s >= 400) {
          pageErrors.push(`HTTP ${s}: ${res.url().slice(0, 80)}`.slice(0, 200));
        }
      });

      // Warmup: avval asosiy sahifani ochamiz (region cookie/sessiya o'rnatadi
      // va Cloudflare'ni yengilroq sahifada o'taymiz). .env: BOOKING_WARMUP_URL.
      const warmupUrl = (process.env.BOOKING_WARMUP_URL || "").trim();
      if (warmupUrl) {
        step("Asosiy sahifa (warmup) ochilmoqda...");
        await p
          .goto(warmupUrl, { waitUntil: "domcontentloaded", timeout: 45000 })
          .catch(() => {});
        await waitForCloudflareClear(p, step);
        // Cookie banner chiqsa — qabul qilamiz.
        if (await acceptCookies(p)) step("Cookie qabul qilindi");
        await humanPause(800, 1600);
        step("Warmup tugadi, login sahifasiga o'tilmoqda...");
      }

      step("Login sahifasi ochilmoqda...");
      // Proxy tuneli uzilishi mumkin (ERR_TUNNEL_CONNECTION_FAILED) — buni
      // ham "blok" deb hisoblab yangi IP bilan qayta urinamiz.
      let gotoError = false;
      let response: import("playwright").Response | null = null;
      try {
        response = await p.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
      } catch (e) {
        gotoError = true;
        const m = e instanceof Error ? e.message : String(e);
        pageErrors.push(`goto: ${m}`.slice(0, 200));
      }
      base.statusCode = response ? response.status() : null;
      await p
        .waitForLoadState("networkidle", { timeout: 10000 })
        .catch(() => {});
      step(
        gotoError
          ? "Sahifa ochilmadi (proxy/ulanish xatosi)"
          : `Sahifa ochildi (HTTP ${base.statusCode ?? "?"})`,
      );

      if (!gotoError && shouldLogExitIp()) {
        base.exitIp = await readExitIp(p);
        step(`Exit IP: ${base.exitIp || "—"}`);
      }

      // Cloudflare interstitial ("Just a moment" / "Checking your browser") bo'lsa
      // — JS challenge avtomatik hal bo'lishini kutamiz (managed challenge).
      const cleared = gotoError ? false : await waitForCloudflareClear(p, step);
      const blocked = gotoError || base.statusCode === 403 || !cleared;

      // Bloklanmagan bo'lsa — davom etamiz. Proxy o'chiq bo'lsa IP almashtirib
      // bo'lmaydi (qayta urinish foydasiz). Oxirgi urinish ham shu yerda tugaydi.
      if (!blocked || !proxyOn || attempt === maxIpRetries - 1) {
        if (blocked) {
          pageErrors.push(
            "cloudflare/proxy: sahifa ochilmadi (403/blok/uzilish)",
          );
        }
        break;
      }

      step(
        gotoError
          ? "Proxy uzildi — yangi IP olinmoqda..."
          : `IP bloklandi (HTTP ${base.statusCode}) — yangi IP olinmoqda...`,
      );
    }

    if (!page) {
      return { ...base, note: "Brauzer ochilmadi" };
    }

    // Cookie banner login sahifasida ham chiqishi mumkin.
    if (await acceptCookies(page)) step("Cookie qabul qilindi");

    // EMAIL — Angular Material: ko'rinadigan input #email (yashirin #username emas).
    const emailSel = '#email, input[formcontrolname="username"]';
    await page
      .waitForSelector(emailSel, { state: "visible", timeout: 20000 })
      .catch(() => {});
    const emailEl = page.locator(emailSel).first();
    if ((await emailEl.count()) > 0) {
      await emailEl.click({ timeout: 5000 }).catch(() => {});
      await emailEl.fill("", { timeout: 3000 }).catch(() => {});
      await emailEl.type(email, { delay: rand(50, 120), timeout: 10000 });
      base.filledEmail = true;
      step("Email kiritildi");
    } else {
      step("Email maydoni topilmadi!");
      // Debug: sahifa holatini saqlaymiz (nima ko'rinayotganini bilish uchun).
      await dumpDebug(page, "login-noemail").catch(() => {});
    }
    await humanPause();

    // PASSWORD — ko'rinadigan input #password (yashirin #password1 emas).
    const passSel = '#password, input[formcontrolname="password"]';
    const passEl = page.locator(passSel).first();
    if ((await passEl.count()) > 0) {
      await passEl.click({ timeout: 5000 }).catch(() => {});
      await passEl.fill("", { timeout: 3000 }).catch(() => {});
      await passEl.type(password, { delay: rand(50, 120), timeout: 10000 });
      base.filledPassword = true;
      step("Parol kiritildi");
    } else {
      step("Parol maydoni topilmadi!");
    }
    await humanPause();

    // Cloudflare Turnstile — token to'lguncha kutamiz.
    step("Cloudflare Turnstile tekshirilmoqda...");
    let captcha = await waitForTurnstile(page);
    base.captchaPresent = captcha.present;
    base.captchaSolved = captcha.solved;

    // Token avtomatik to'lmagan bo'lsa — checkbox ustiga inson kabi bosamiz
    // (tasodifiy nuqtalarda) va yana token to'lishini kutamiz.
    if (captcha.present && !captcha.solved) {
      step("Captcha o'zi o'tmadi — ustiga bosilmoqda...");
      const clicked = await clickTurnstile(page);
      if (clicked) {
        step("Captcha ustiga bosildi, token kutilmoqda...");
      }
      captcha = await waitForTurnstile(page);
      base.captchaPresent = captcha.present;
      base.captchaSolved = captcha.solved;
    }

    if (captcha.present) {
      step(captcha.solved ? "Captcha o'tdi ✓" : "Captcha o'tmadi ✗");
    } else {
      step("Captcha yo'q (bu sahifada)");
    }
    if (captcha.present && !captcha.solved) {
      pageErrors.push("turnstile: token kutib olinmadi");
    }

    await humanPause(400, 900);

    // "Sign In" tugmasini bosamiz.
    const signInBtn = page
      .locator(
        'button:has-text("Sign In"), button:has-text("Sign in"), button[type="submit"]',
      )
      .first();
    if ((await signInBtn.count()) > 0) {
      await signInBtn.click({ timeout: 8000 }).catch(() => {});
      base.submitted = true;
      step("Sign In bosildi");
    } else {
      step("Sign In tugmasi topilmadi!");
    }

    // Login natijasini kutamiz (navigatsiya yoki xato xabari).
    step("Natija kutilmoqda...");
    await page
      .waitForLoadState("networkidle", { timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(1500).catch(() => {});

    base.finalUrl = page.url();
    const bodyText = (
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")) || ""
    ).toLowerCase();

    // Login muvaffaqiyatini taxminiy aniqlaymiz: URL o'zgardi (login sahifasidan
    // chiqdi) yoki xato xabari yo'q.
    const stillOnLogin = /login|sign\s*in/.test(base.finalUrl.toLowerCase());
    const hasError = /invalid|incorrect|wrong|failed|error|noto'g'ri|xato/.test(
      bodyText,
    );
    base.ok = base.submitted && !hasError && !stillOnLogin;

    base.note = base.ok
      ? "Login muvaffaqiyatli (taxminiy)"
      : hasError
        ? "Login xato xabari aniqlandi"
        : stillOnLogin
          ? "Hali login sahifasida (parol/captcha tekshiring)"
          : "Login holati noaniq";

    // Login bo'lmasa — sahifa holatini saqlaymiz (VFS xato xabarini ko'rish uchun).
    if (!base.ok) {
      await dumpDebug(page, "login-result").catch(() => {});
    }

    if (closeSession) await closeSession();
    closeSession = null;

    base.pageError = pageErrors.length
      ? pageErrors.slice(0, 10).join(" | ")
      : null;
    return base;
  } catch (err) {
    if (closeSession) await closeSession().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    pageErrors.push(`FATAL: ${msg}`.slice(0, 200));
    return {
      ...base,
      note: `Login xatosi: ${msg.slice(0, 200)}`,
      pageError: pageErrors.slice(0, 10).join(" | "),
    };
  }
}

function extractRef(text: string): string | null {
  const patterns = [
    /(?:appointment|booking|reference|confirmation|ref|tasdiq|buyurtma)\D{0,12}([A-Z0-9]{5,})/i,
    /\b([A-Z]{2,4}-?\d{5,})\b/,
    /\b(\d{8,})\b/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

/**
 * Proxy orqali chiqqan tashqi (exit) IP'ni aniqlaydi (log uchun).
 * Sahifa context'idagi request ishlatiladi — demak o'sha proxy orqali ketadi.
 * Xato bo'lsa null qaytaradi (asosiy oqim buzilmaydi).
 */
async function readExitIp(
  page: import("playwright").Page,
): Promise<string | null> {
  const echo = proxyIpEchoUrl();
  // MUHIM: CDP (connectOverCDP) rejimida page.request.get() chrome'ning
  // --proxy-server flagini CHETLAB O'TADI (Node tarmog'idan ketadi) va HAQIQIY
  // IP'ni qaytaradi. Shu sababli IP'ni SAHIFA ICHIDAGI fetch orqali olamiz —
  // u chrome proxy'sidan o'tadi va to'g'ri exit IP'ni beradi.
  try {
    const txt = await page.evaluate(async (u: string) => {
      try {
        const r = await fetch(u, { cache: "no-store" });
        return await r.text();
      } catch {
        return "";
      }
    }, echo);
    const parsed = parseIpFromText(txt);
    if (parsed) return parsed;
  } catch {
    /* in-page fetch ishlamadi — pastdagi zaxira usulga o'tamiz */
  }
  // Zaxira: page.request (CDP'da proxy'ni chetlab o'tishi mumkin — faqat oxirgi chora).
  try {
    const res = await page.request.get(echo, { timeout: 8000 });
    return parseIpFromText((await res.text()).trim());
  } catch {
    return null;
  }
}

/** Echo javobidan (JSON yoki xom matn) IP manzilni ajratadi. */
function parseIpFromText(txt: string): string | null {
  const t = (txt || "").trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t);
    const ip = j.ip || j.query || j.YourFuckingIPAddress || null;
    if (ip) return String(ip).slice(0, 60);
  } catch {
    /* JSON emas — xom matn */
  }
  const m = t.match(/(\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]{6,}/);
  return m ? m[0].slice(0, 60) : null;
}

/**
 * Bitta arizachi uchun bitta bosqichni bajaradi.
 * Playwright dinamik import qilinadi (build/serverless'ni buzmaslik uchun).
 */
export async function runBooking(
  stage: Stage,
  applicant: AutomationApplicant,
  opts?: { profileKey?: string | null },
): Promise<AutomationResult> {
  const url = urlForStage(stage);
  if (!url) {
    return {
      ok: false,
      ref: null,
      note: `URL sozlanmagan (.env: BOOKING_${stageEnvName(stage)}_URL)`,
      filled: [],
      url: "",
      finalUrl: "",
      visitedUrls: [],
      proxyServer: null,
      proxyCountry: null,
      proxySession: null,
      exitIp: null,
      statusCode: null,
      requestedAt: null,
      openedAt: null,
      navMs: null,
      pageError: null,
    };
  }

  let closeSession: (() => Promise<void>) | null = null;
  const filled: string[] = [];
  const visitedUrls: string[] = [];

  // Proxy meta (parolsiz) — log uchun. Sticky: profileKey bo'yicha.
  const proxyTarget: ProxyTarget = { profileKey: opts?.profileKey ?? null };
  const pmeta = proxyMetaFor(
    proxyTarget.profileKey
      ? proxyTarget
      : {
          profileKey: applicant.generatedEmail || applicant.email || null,
        },
  );
  let statusCode: number | null = null;
  let exitIp: string | null = null;
  // Vaqtlar: "kelgan" (navigatsiya boshlandi) va "ochilgan" (javob keldi).
  let requestedAt: string | null = null;
  let openedAt: string | null = null;
  let navMs: number | null = null;
  // Chrome web ochganda chiqqan xatolar (JS exception / failed request / 4xx-5xx).
  const pageErrors: string[] = [];

  // Brauzer qaysi sahifaga o'tsa — tartib bilan yozib boramiz (takrorsiz).
  const trackUrl = (u: string) => {
    if (!u || u === "about:blank") return;
    if (visitedUrls[visitedUrls.length - 1] === u) return;
    visitedUrls.push(u);
  };

  try {
    const profileKey =
      opts?.profileKey || applicant.generatedEmail || applicant.email || null;
    const session = await openBrowserContext(profileDirFor(stage, profileKey), {
      profileKey,
    });
    closeSession = session.close;

    const page: import("playwright").Page = await session.context.newPage();

    // Har bir navigatsiyani (redirect/yangi sahifa) kuzatamiz.
    page.on("framenavigated", (frame) => {
      try {
        if (frame === page.mainFrame()) trackUrl(frame.url());
      } catch {
        /* ignore */
      }
    });

    // Chrome xatolarini yig'amiz: JS exception, yuklanmagan so'rov, 4xx/5xx.
    page.on("pageerror", (e) => {
      pageErrors.push(`JS: ${e.message}`.slice(0, 200));
    });
    page.on("requestfailed", (req) => {
      const f = req.failure();
      pageErrors.push(
        `REQFAIL: ${req.url().slice(0, 80)} (${f?.errorText || "?"})`.slice(
          0,
          200,
        ),
      );
    });
    page.on("response", (res) => {
      const s = res.status();
      if (s >= 400) {
        pageErrors.push(`HTTP ${s}: ${res.url().slice(0, 80)}`.slice(0, 200));
      }
    });

    // "kelgan": navigatsiya boshlandi.
    const t0 = Date.now();
    requestedAt = new Date(t0).toISOString();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    // "ochilgan": sahifa javob berdi / DOM tayyor.
    const t1 = Date.now();
    openedAt = new Date(t1).toISOString();
    navMs = t1 - t0;
    statusCode = response ? response.status() : null;
    trackUrl(page.url());

    // Proxy yoqilgan bo'lsa — tashqi (exit) IP'ni aniqlaymiz (log uchun).
    if (shouldLogExitIp()) {
      exitIp = await readExitIp(page);
    }

    // Har bir maydonni topib to'ldiramiz.
    const values: Partial<Record<keyof AutomationApplicant, string>> = {
      surname: applicant.surname,
      name: applicant.name,
      passportNumber: applicant.passportNumber,
      nationality: applicant.nationality ?? undefined,
      gender: applicant.gender ?? undefined,
      birthdate: applicant.birthdate ?? undefined,
      passportValidity: applicant.passportValidity ?? undefined,
      phone: applicant.phone ?? undefined,
      email: applicant.generatedEmail || applicant.email || undefined,
    };

    for (const [field, value] of Object.entries(values)) {
      if (!value) continue;
      const ok = await fillSmartField(
        page,
        FIELD_KEYWORDS[field as keyof AutomationApplicant],
        value,
      );
      if (ok) filled.push(field);
      // Inson kabi: har bir maydondan keyin qisqa tasodifiy pauza.
      await humanPause();
    }

    // Cloudflare Turnstile bo'lsa — token to'lguncha (captcha o'tguncha) kutamiz.
    const captcha = await waitForTurnstile(page);
    if (captcha.present && !captcha.solved) {
      pageErrors.push("turnstile: token kutib olinmadi (captcha o'tmadi)");
    }

    // Inson kabi: yuborishdan oldin biroz "o'ylab turish".
    await humanPause(400, 900);

    // Submit tugmasini bosamiz (agar topilsa).
    const submitted = await clickSubmit(page);

    // Natijani kutamiz va sahifa matnini o'qiymiz.
    await page
      .waitForLoadState("networkidle", { timeout: 8000 })
      .catch(() => {});
    const bodyText =
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")) || "";
    const ref = extractRef(bodyText);

    // Brauzer yopishdan oldin oxirgi URL'ni olamiz.
    const finalUrl = page.url();
    trackUrl(finalUrl);

    await closeSession();
    closeSession = null;

    const note =
      `${stageLabel(stage)}: ` +
      `${filled.length} maydon to'ldirildi` +
      (submitted ? ", forma yuborildi" : ", submit tugmasi topilmadi") +
      (captcha.present
        ? captcha.solved
          ? ", captcha o'tdi"
          : ", captcha o'tmadi"
        : "") +
      (ref ? `, ref: ${ref}` : "");

    return {
      ok: filled.length > 0 || submitted,
      ref,
      note,
      filled,
      url,
      finalUrl,
      visitedUrls,
      proxyServer: pmeta?.server ?? null,
      proxyCountry: pmeta?.country ?? null,
      proxySession: pmeta?.session ?? null,
      exitIp,
      statusCode,
      requestedAt,
      openedAt,
      navMs,
      pageError: pageErrors.length ? pageErrors.slice(0, 10).join(" | ") : null,
    };
  } catch (err) {
    if (closeSession) await closeSession().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    pageErrors.push(`FATAL: ${msg}`.slice(0, 200));
    return {
      ok: false,
      ref: null,
      note: `Avtomatlashtirish xatosi: ${msg.slice(0, 200)}`,
      filled,
      url,
      finalUrl: visitedUrls[visitedUrls.length - 1] || url,
      visitedUrls,
      proxyServer: pmeta?.server ?? null,
      proxyCountry: pmeta?.country ?? null,
      proxySession: pmeta?.session ?? null,
      exitIp,
      statusCode,
      requestedAt,
      openedAt,
      navMs,
      pageError: pageErrors.length ? pageErrors.slice(0, 10).join(" | ") : null,
    };
  }
}

/**
 * Register'dan keyin aktivatsiya: gmail qutidan userning aktivatsiya xatini
 * kutadi, ichidagi linkni topadi va USERNING profilida ochadi.
 *  - IMAP sozlanmagan bo'lsa: ok=true, "o'tkazib yuborildi" (register bloklanmaydi).
 *  - Xat topilmasa: ok=false (register to'liq hisoblanmaydi).
 *  - Link topilib ochilsa: ok=true, register to'liq tugadi.
 */
export async function runActivation(
  applicant: AutomationApplicant,
  opts?: { profileKey?: string | null },
): Promise<ActivationResult> {
  const toEmail = applicant.generatedEmail || applicant.email || null;
  // Aktivatsiya register bilan BIR XIL session (profil + sticky IP) ishlatadi.
  const profileKey = opts?.profileKey || toEmail || null;
  const pmeta = proxyMetaFor({ profileKey });
  // Bo'sh (proxy yo'q) natija uchun umumiy meta.
  const baseMeta = {
    proxyServer: pmeta?.server ?? null,
    proxyCountry: pmeta?.country ?? null,
    proxySession: pmeta?.session ?? null,
    exitIp: null as string | null,
    statusCode: null as number | null,
    requestedAt: null as string | null,
    openedAt: null as string | null,
    navMs: null as number | null,
    pageError: null as string | null,
  };

  if (!toEmail) {
    return {
      ok: false,
      link: null,
      to: null,
      note: "Email manzili yo'q",
      ...baseMeta,
    };
  }

  const { isMailListenerEnabled, waitForActivationMail } =
    await import("./mail-listener");

  if (!isMailListenerEnabled()) {
    // IMAP sozlanmagan — aktivatsiyani o'tkazib yuboramiz (register bloklanmasin).
    return {
      ok: true,
      link: null,
      to: toEmail,
      note: "Aktivatsiya o'tkazib yuborildi (IMAP sozlanmagan)",
      ...baseMeta,
    };
  }

  const mail = await waitForActivationMail(toEmail);
  if (!mail) {
    return {
      ok: false,
      link: null,
      to: toEmail,
      note: "Aktivatsiya xati topilmadi (gmail'da link kelmadi)",
      ...baseMeta,
    };
  }

  // Linkni userning profilida ochamiz (register bilan BIR XIL profil + IP).
  let closeSession: (() => Promise<void>) | null = null;
  let statusCode: number | null = null;
  let exitIp: string | null = null;
  let requestedAt: string | null = null;
  let openedAt: string | null = null;
  let navMs: number | null = null;
  const pageErrors: string[] = [];
  try {
    const session = await openBrowserContext(
      profileDirFor("register", profileKey),
      { profileKey },
    );
    closeSession = session.close;

    const page: import("playwright").Page = await session.context.newPage();
    page.on("pageerror", (e) => {
      pageErrors.push(`JS: ${e.message}`.slice(0, 200));
    });
    page.on("requestfailed", (req) => {
      const f = req.failure();
      pageErrors.push(
        `REQFAIL: ${req.url().slice(0, 80)} (${f?.errorText || "?"})`.slice(
          0,
          200,
        ),
      );
    });
    page.on("response", (res) => {
      const s = res.status();
      if (s >= 400) {
        pageErrors.push(`HTTP ${s}: ${res.url().slice(0, 80)}`.slice(0, 200));
      }
    });

    const t0 = Date.now();
    requestedAt = new Date(t0).toISOString();
    const response = await page.goto(mail.link, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    const t1 = Date.now();
    openedAt = new Date(t1).toISOString();
    navMs = t1 - t0;
    statusCode = response ? response.status() : null;
    await page
      .waitForLoadState("networkidle", { timeout: 10000 })
      .catch(() => {});

    if (shouldLogExitIp()) {
      exitIp = await readExitIp(page);
    }

    const body = (
      (await page
        .locator("body")
        .innerText()
        .catch(() => "")) || ""
    ).toLowerCase();

    await closeSession();
    closeSession = null;

    // Xatolik belgilari (link eskirgan/yaroqsiz bo'lsa).
    const failMarks = [
      "expired",
      "invalid",
      "not valid",
      "link has expired",
      "muddati",
    ];
    if (failMarks.some((m) => body.includes(m))) {
      return {
        ok: false,
        link: mail.link,
        to: toEmail,
        note: "Aktivatsiya linki yaroqsiz/eskirgan",
        ...baseMeta,
        exitIp,
        statusCode,
        requestedAt,
        openedAt,
        navMs,
        pageError: pageErrors.length
          ? pageErrors.slice(0, 10).join(" | ")
          : null,
      };
    }

    return {
      ok: true,
      link: mail.link,
      to: toEmail,
      note: "Aktivatsiya bajarildi (link ochildi)",
      ...baseMeta,
      exitIp,
      statusCode,
      requestedAt,
      openedAt,
      navMs,
      pageError: pageErrors.length ? pageErrors.slice(0, 10).join(" | ") : null,
    };
  } catch (err) {
    if (closeSession) await closeSession().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    pageErrors.push(`FATAL: ${msg}`.slice(0, 200));
    return {
      ok: false,
      link: mail.link,
      to: toEmail,
      note: `Aktivatsiya xatosi: ${msg.slice(0, 200)}`,
      ...baseMeta,
      exitIp,
      statusCode,
      requestedAt,
      openedAt,
      navMs,
      pageError: pageErrors.length ? pageErrors.slice(0, 10).join(" | ") : null,
    };
  }
}

/**
 * Sahifadagi input/select/textarea ni kalit so'zlar bo'yicha topib to'ldiradi.
 * Element atributlari (name/id/placeholder/aria-label) + bog'langan <label>
 * matni tekshiriladi. Birinchi mos kelgan bo'sh element to'ldiriladi.
 */
async function fillSmartField(
  page: import("playwright").Page,
  keywords: string[],
  value: string,
): Promise<boolean> {
  try {
    const handles = await page.$$(
      "input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea",
    );
    for (const el of handles) {
      const meta = await el.evaluate((node: Element) => {
        const get = (a: string) => node.getAttribute(a) || "";
        let labelText = "";
        const id = node.getAttribute("id");
        if (id) {
          const lbl = document.querySelector(`label[for="${id}"]`);
          if (lbl) labelText = lbl.textContent || "";
        }
        const parentLabel = node.closest("label");
        if (parentLabel) labelText += " " + (parentLabel.textContent || "");
        return {
          tag: node.tagName.toLowerCase(),
          type: (node.getAttribute("type") || "").toLowerCase(),
          haystack: [
            get("name"),
            get("id"),
            get("placeholder"),
            get("aria-label"),
            labelText,
          ]
            .join(" ")
            .toLowerCase(),
          disabled: (node as HTMLInputElement).disabled,
        };
      });

      if (meta.disabled) continue;
      if (!keywords.some((k) => meta.haystack.includes(k))) continue;

      // SELECT — qiymatga mos optionni tanlaymiz.
      if (meta.tag === "select") {
        const picked = await el
          .evaluate((node: Element, v: string) => {
            const sel = node as HTMLSelectElement;
            const want = v.toLowerCase();
            for (const opt of Array.from(sel.options)) {
              const t = (opt.text + " " + opt.value).toLowerCase();
              if (t.includes(want) || want.includes(opt.value.toLowerCase())) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event("change", { bubbles: true }));
                return true;
              }
            }
            return false;
          }, value)
          .catch(() => false);
        if (picked) return true;
        continue;
      }

      // Oddiy matn inputi / textarea — inson kabi belgilab-belgilab yozamiz.
      const delay = rand(40, 110); // har belgi orasida ms (tabiiy tezlik)
      try {
        await el.click({ timeout: 2000 }).catch(() => {});
        await el.fill("", { timeout: 2000 }).catch(() => {});
        await el.type(value, { delay, timeout: 8000 });
        return true;
      } catch {
        // type ishlamasa — to'g'ridan-to'g'ri fill bilan urinib ko'ramiz.
        await el.fill(value, { timeout: 4000 }).catch(() => {});
        return true;
      }
    }
  } catch {
    // jim — natijaga ta'sir qilmaydi.
  }
  return false;
}

/**
 * Cookie banner (OneTrust va boshqalar) chiqsa — "Accept all" tugmasini bosadi.
 * Hech qachon throw qilmaydi. Bosilsa true qaytaradi.
 */
async function acceptCookies(
  page: import("playwright").Page,
): Promise<boolean> {
  const selectors = [
    "#onetrust-accept-btn-handler",
    "button#onetrust-accept-btn-handler",
    'button:has-text("Accept All Cookies")',
    'button:has-text("Accept all cookies")',
    'button:has-text("Accept All")',
    'button:has-text("Accept Cookies")',
    'button:has-text("Accept")',
    'button:has-text("I Accept")',
    'button:has-text("Allow all")',
    'button:has-text("Got it")',
    '[aria-label="Accept cookies"]',
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0 && (await btn.isVisible())) {
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(rand(300, 700)).catch(() => {});
        return true;
      }
    } catch {
      // keyingisini sinaymiz.
    }
  }
  return false;
}

/**
 * Turnstile checkbox'i interaktiv bo'lsa — uning ustiga (iframe markaziga)
 * inson kabi tasodifiy nuqtalarda bir necha marta bosadi. Token avtomatik
 * to'lmagan holatlar uchun. Hech qachon throw qilmaydi.
 */
async function clickTurnstile(
  page: import("playwright").Page,
): Promise<boolean> {
  try {
    const frameEl = await page
      .waitForSelector(
        'iframe[src*="challenges.cloudflare.com"], .cf-turnstile iframe, #widgetId iframe',
        { state: "visible", timeout: 4000 },
      )
      .catch(() => null);
    if (!frameEl) return false;

    const box = await frameEl.boundingBox().catch(() => null);
    if (!box) return false;

    // Checkbox odatda iframe'ning chap qismida. Tasodifiy 2-3 nuqtaga bosamiz.
    const tries = rand(2, 4);
    for (let i = 0; i < tries; i++) {
      const x = box.x + rand(18, Math.max(20, Math.floor(box.width * 0.28)));
      const y = box.y + box.height / 2 + rand(-6, 6);
      // Avval kursorni inson kabi olib boramiz.
      await page.mouse.move(x - rand(20, 60), y - rand(10, 30)).catch(() => {});
      await page.waitForTimeout(rand(120, 320)).catch(() => {});
      await page.mouse.move(x, y).catch(() => {});
      await page.waitForTimeout(rand(80, 200)).catch(() => {});
      await page.mouse.click(x, y).catch(() => {});
      await page.waitForTimeout(rand(500, 1100)).catch(() => {});

      // Token to'ldimi? To'lgan bo'lsa to'xtaymiz.
      const ok = await page
        .evaluate(() => {
          const el = document.querySelector(
            'input[name="cf-turnstile-response"]',
          ) as HTMLInputElement | null;
          return !!el && !!el.value && el.value.length > 30;
        })
        .catch(() => false);
      if (ok) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Cloudflare "Just a moment" / "Checking your browser" interstitial (managed
 * challenge) hal bo'lishini kutadi. Sahifa challenge'da bo'lsa, JS challenge
 * avtomatik bajarilib, asl sahifaga o'tishini kutamiz. Hech qachon throw qilmaydi.
 *  - true: challenge yo'q yoki hal bo'ldi (asl sahifa ko'rindi).
 *  - false: vaqt tugadi, hali ham challenge/blokda.
 */
async function waitForCloudflareClear(
  page: import("playwright").Page,
  step?: (m: string) => void,
): Promise<boolean> {
  const timeoutMs = Number(
    process.env.BOOKING_CF_CHALLENGE_TIMEOUT_MS || "45000",
  );
  const isChallenge = async (): Promise<boolean> => {
    try {
      return await page.evaluate(() => {
        const t = (document.title || "").toLowerCase();
        const b = (document.body?.innerText || "").toLowerCase();
        const marks = [
          "just a moment",
          "checking your browser",
          "verify you are human",
          "needs to review the security",
          "attention required",
        ];
        const hit = marks.some((m) => t.includes(m) || b.includes(m));
        // Challenge sahifasida odatda asosiy app (app-login/app-root) bo'lmaydi.
        const hasApp = !!document.querySelector(
          "app-login, app-root, #email, form",
        );
        return hit && !hasApp;
      });
    } catch {
      return false;
    }
  };

  if (!(await isChallenge())) return true;
  step?.("Cloudflare challenge aniqlandi, hal bo'lishi kutilmoqda...");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000).catch(() => {});
    if (!(await isChallenge())) {
      step?.("Cloudflare challenge hal bo'ldi ✓");
      // App to'liq yuklanishi uchun biroz kutamiz.
      await page
        .waitForLoadState("networkidle", { timeout: 8000 })
        .catch(() => {});
      return true;
    }
  }
  step?.("Cloudflare challenge hal bo'lmadi ✗");
  return false;
}

/**
 * Cloudflare Turnstile captcha'ni aniqlaydi va token to'lguncha kutadi.
 */
async function waitForTurnstile(
  page: import("playwright").Page,
): Promise<{ present: boolean; solved: boolean }> {
  const timeoutMs = Number(process.env.BOOKING_CAPTCHA_TIMEOUT_MS || "30000");
  try {
    // Widget bormi? (iframe yoki hidden input yoki .cf-turnstile konteyner)
    const present = await page
      .evaluate(() => {
        const hasInput = !!document.querySelector(
          'input[name="cf-turnstile-response"], [id^="cf-chl-widget"]',
        );
        const hasWidget = !!document.querySelector(
          '.cf-turnstile, iframe[src*="challenges.cloudflare.com"]',
        );
        return hasInput || hasWidget;
      })
      .catch(() => false);

    if (!present) return { present: false, solved: false };

    // Token to'lguncha kutamiz (cf-turnstile-response value uzunligi > 30).
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector(
            'input[name="cf-turnstile-response"]',
          ) as HTMLInputElement | null;
          return !!el && !!el.value && el.value.length > 30;
        },
        { timeout: timeoutMs },
      )
      .catch(() => {});

    const solved = await page
      .evaluate(() => {
        const el = document.querySelector(
          'input[name="cf-turnstile-response"]',
        ) as HTMLInputElement | null;
        return !!el && !!el.value && el.value.length > 30;
      })
      .catch(() => false);

    return { present: true, solved };
  } catch {
    return { present: false, solved: false };
  }
}

/** Forma yuborish tugmasini topib bosadi. */
async function clickSubmit(page: import("playwright").Page): Promise<boolean> {
  const candidates = [
    'button[type="submit"]',
    'input[type="submit"]',
    "button:has-text('Submit')",
    "button:has-text('Send')",
    "button:has-text('Book')",
    "button:has-text('Register')",
    "button:has-text('Continue')",
    "button:has-text('Yuborish')",
    "button:has-text('Davom')",
    "button:has-text('Saqlash')",
    "button:has-text('Tasdiqlash')",
  ];
  for (const sel of candidates) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0 && (await btn.isVisible())) {
        await btn.click({ timeout: 5000 });
        return true;
      }
    } catch {
      // keyingisini sinaymiz.
    }
  }
  return false;
}
