// ====================================================================
//  FLOW CAPTURE — slot ochilgandan keyingi noma'lum sahifalarni yozish
// ====================================================================
//  Maqsad: slot ochilsa, undan keyingi 3-4 forma + PDF sahifalari hali
//  ANIQ EMAS. Bu modul brauzerni OCHIQ qoldiradi (siz qo'lda formalarni
//  to'ldirib, sahifalarni bosib o'tasiz), va FONDA hamma narsani yozadi:
//    - har sahifaning to'liq SKRINSHOTI (.png)
//    - sahifa DOM/HTML (.html) + tuzilmasi JSON (forma/maydon/tugma/PDF link)
//    - barcha NETWORK so'rovlari (XHR/fetch/document) — payload + javob (.json)
//    - yuklab olingan PDF/fayllar (downloads/)
//    - chiroyli LOG (konsol + log.txt)
//    - oxirida manifest.json (hammasining ro'yxati)
//
//  Docker uchun EMAS — lokal tahlil/o'rganish vositasi. Brauzer ko'rinadi.
//
//  Ishlatish: scripts/flow-capture.ts -> `npm run flow:capture`
// ====================================================================

import * as fs from "fs";
import * as path from "path";
import { openBrowserContext, profileDirFor } from "./browser";
import { restoreSession, saveSession, slotMonitorProfileBase } from "./session";

type Page = import("playwright").Page;
type BrowserContext = import("playwright").BrowserContext;
type Response = import("playwright").Response;
type Download = import("playwright").Download;

export type CaptureLevel =
  | "info"
  | "nav"
  | "snap"
  | "net"
  | "pdf"
  | "warn"
  | "err";

export type CaptureLogger = (level: CaptureLevel, msg: string) => void;

export type FlowCaptureOptions = {
  /** Boshlanish URL (default: dashboard token bo'lsa, aks holda login). */
  startUrl?: string | null;
  /** Sessiya/profil kaliti (login token shu profildan tiklanadi). */
  profileKey?: string | null;
  /** Brauzer necha ms ochiq tursin (default 600000 = 10 min). */
  openMs?: number;
  /** SPA qadam o'zgarishini tekshirish oralig'i (default 1200). */
  pollMs?: number;
  /** Snapshotdan oldin loading tugashini kutish chegarasi ms (default 9000). */
  settleMaxMs?: number;
  /** Sahifa imzosi shuncha ms barqaror tursa "tinch" deyiladi (default 700). */
  settleStableMs?: number;
  /** Har necha ms da majburiy "auto" snapshot (default 0 = o'chiq). */
  heartbeatMs?: number;
  /** Proxy orqali (default false — lokal tahlil, to'g'ridan-to'g'ri). */
  proxy?: boolean;
  /** Saqlangan login tokenni tiklash (default true). */
  restore?: boolean;
  /** Klaviatura boshqaruvi (Enter=snapshot, q=chiqish) (default true). */
  interactive?: boolean;
  /** Yozuv papkasi (default uploads/flow-capture/<vaqt>). */
  outDir?: string;
  /** Log callback (CLI chiroyli chiqaradi). */
  log?: CaptureLogger;
};

export type CapturedNet = {
  seq: number;
  time: string;
  method: string;
  url: string;
  resourceType: string;
  status: number;
  mime: string;
  size: number;
  savedBody: boolean;
  file?: string;
};

export type CapturedSnapshot = {
  seq: number;
  time: string;
  event: string;
  tab: number;
  url: string;
  title: string;
  forms: number;
  inputs: number;
  buttons: number;
  png: string;
  html: string;
  json: string;
};

export type CapturedDownload = {
  time: string;
  filename: string;
  url: string;
  file: string;
  size: number;
};

export type FlowCaptureResult = {
  dir: string;
  tabs: number;
  snapshots: number;
  requests: number;
  downloads: number;
  durationMs: number;
  manifestPath: string;
};

// Sahifa tuzilmasini o'qish (forma/maydon/tugma/PDF link) — page.evaluate ichida
// ISHLAYDI, shuning uchun FAQAT anonim inline callback'lar (named/const funksiya
// YO'Q — esbuild/tsx "__name is not defined" xatosini oldini olish uchun).
const PAGE_INFO_FN = () => {
  const inputs = Array.from(
    document.querySelectorAll("input,select,textarea"),
  ).map((el) => {
    const e = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    let lbl =
      e.getAttribute("aria-label") || e.getAttribute("placeholder") || "";
    if (!lbl && e.id) {
      const l = document.querySelector('label[for="' + e.id + '"]');
      if (l) lbl = (l.textContent || "").trim();
    }
    if (!lbl) {
      const p = e.closest("label");
      if (p) lbl = (p.textContent || "").trim();
    }
    return {
      tag: e.tagName.toLowerCase(),
      type: e.getAttribute("type") || e.tagName.toLowerCase(),
      name:
        e.getAttribute("name") ||
        e.getAttribute("formcontrolname") ||
        e.id ||
        "",
      label: lbl.replace(/\s+/g, " ").trim().slice(0, 90),
      required:
        (e as HTMLInputElement).required === true ||
        e.getAttribute("aria-required") === "true",
      filled:
        !!(e as HTMLInputElement).value &&
        String((e as HTMLInputElement).value).length > 0,
      options:
        e.tagName === "SELECT"
          ? Array.from((e as HTMLSelectElement).options)
              .map((o) => (o.textContent || "").trim())
              .filter(Boolean)
              .slice(0, 50)
          : undefined,
    };
  });

  const buttons = Array.from(
    document.querySelectorAll(
      "button,[role=button],input[type=submit],a.btn,.mat-button,.mdc-button",
    ),
  )
    .map((el) => ({
      text: (el.textContent || el.getAttribute("aria-label") || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60),
      disabled:
        (el as HTMLButtonElement).disabled === true ||
        el.getAttribute("aria-disabled") === "true",
    }))
    .filter((b) => b.text.length > 0)
    .slice(0, 40);

  const forms = Array.from(document.querySelectorAll("form")).map((f) => ({
    action: f.getAttribute("action") || "",
    method: (f.getAttribute("method") || "get").toLowerCase(),
    fields: f.querySelectorAll("input,select,textarea").length,
  }));

  const pdfLinks = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => (a as HTMLAnchorElement).href)
    .filter((h) => /\.pdf($|\?)|download|document|attachment/i.test(h))
    .slice(0, 40);

  const banners = Array.from(
    document.querySelectorAll(
      ".alert,.error,.message,.snackbar,[role=alert],.mat-error,.mat-snack-bar-container,.notification",
    ),
  )
    .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 20);

  return {
    url: location.href,
    title: document.title,
    headings: Array.from(document.querySelectorAll("h1,h2,h3"))
      .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 30),
    forms,
    inputs,
    buttons,
    pdfLinks,
    banners,
    bodyText: (document.body ? document.body.innerText : "")
      .replace(/\n{3,}/g, "\n\n")
      .slice(0, 5000),
  };
};

// SPA qadam imzosi (URL + title + forma soni + 1-sarlavha) — o'zgarsa = yangi qadam.
const STEP_SIG_FN = () =>
  location.href +
  " | " +
  document.title +
  " | f" +
  document.querySelectorAll("form").length +
  " | i" +
  document.querySelectorAll("input,select,textarea").length +
  " | " +
  (document.querySelector("h1,h2")
    ? (document.querySelector("h1,h2") as HTMLElement).textContent || ""
    : "");

// Sahifa hozir YUKLANAYAPTIMI? (Angular/Material spinner, progress-bar, ngx-spinner,
// "Loading" splash). page.evaluate ichida ishlaydi — FAQAT anonim inline (named/const
// funksiya YO'Q). true = hali loading, snapshot kutadi; false = tinch, surat olsa bo'ladi.
const PAGE_BUSY_FN = () => {
  if (document.readyState !== "complete") return true;
  const sel =
    "mat-spinner,mat-progress-spinner,mat-progress-bar," +
    ".mat-mdc-progress-spinner,.mat-mdc-progress-bar," +
    ".mat-progress-spinner,.mat-progress-bar," +
    ".ngx-spinner-overlay,[role=progressbar]," +
    ".loading-overlay,.app-loading,.loading-spinner,.spinner-overlay,.page-loader";
  const nodes = document.querySelectorAll(sel);
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as HTMLElement;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    const st = window.getComputedStyle(el);
    if (
      st.display === "none" ||
      st.visibility === "hidden" ||
      Number(st.opacity) === 0
    )
      continue;
    return true;
  }
  // VFS "Loading" splash: juda kam matn + "loading"/"yuklan" so'zi.
  const body = document.body;
  if (body) {
    const txt = (body.innerText || "").trim();
    if (
      txt.length > 0 &&
      txt.length < 120 &&
      /loading|please wait|yuklan/i.test(txt)
    )
      return true;
  }
  return false;
};

function nowIso(): string {
  return new Date().toISOString();
}

function pad(n: number, w = 3): string {
  return String(n).padStart(w, "0");
}

function slugUrl(u: string, max = 40): string {
  try {
    const p = new URL(u);
    const s = (p.pathname + p.search).replace(/[^a-z0-9]+/gi, "-");
    return (p.hostname.replace(/[^a-z0-9]+/gi, "-") + "-" + s)
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, max);
  } catch {
    return u.replace(/[^a-z0-9]+/gi, "-").slice(0, max) || "page";
  }
}

function safeName(s: string, max = 60): string {
  return (
    s
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, max) || "x"
  );
}

function defaultOutDir(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  return path.join(process.cwd(), "uploads", "flow-capture", ts);
}

function loginUrl(): string {
  return (
    (process.env.BOOKING_LOGIN_URL || "").trim() ||
    "https://visa.vfsglobal.com/uzb/en/lva/login"
  );
}

function dashboardUrl(): string {
  return (
    (process.env.BOOKING_DASHBOARD_URL || "").trim() ||
    "https://visa.vfsglobal.com/uzb/en/lva/dashboard"
  );
}

/**
 * Brauzerni ochib, foydalanuvchi qo'lda o'tayotgan sahifalarni yozadi.
 * Promise faqat brauzer yopilganda / vaqt tugaganda / "q" bosilganda hal bo'ladi.
 */
export async function runFlowCapture(
  opts: FlowCaptureOptions = {},
): Promise<FlowCaptureResult> {
  const log: CaptureLogger = opts.log || (() => {});
  const startedAt = Date.now();
  const profileKey =
    opts.profileKey ||
    (process.env.SLOT_MONITOR_PROFILE_KEY || "").trim() ||
    (process.env.SLOT_MONITOR_EMAIL || "").trim() ||
    "flow-capture";
  const openMs = Math.max(10_000, opts.openMs ?? 600_000);
  const pollMs = Math.max(400, opts.pollMs ?? 1200);
  const settleMaxMs = Math.max(0, opts.settleMaxMs ?? 9000);
  const settleStableMs = Math.max(0, opts.settleStableMs ?? 700);
  const heartbeatMs = Math.max(0, opts.heartbeatMs ?? 0);
  // Token tiklash DEFAULT O'CHIQ — passiv rejim. Aks holda eskirgan token
  // "Session Expired (401)" sahifasiga olib boradi. Login'ni qo'lda qilasiz.
  const restore = opts.restore === true;
  const interactive = opts.interactive !== false;
  const proxy = opts.proxy === true;

  // --- Yozuv papkalari ---
  const dir = opts.outDir || defaultOutDir();
  const shotsDir = path.join(dir, "screenshots");
  const pagesDir = path.join(dir, "pages");
  const netDir = path.join(dir, "network");
  const dlDir = path.join(dir, "downloads");
  for (const d of [dir, shotsDir, pagesDir, netDir, dlDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
  const logFile = path.join(dir, "log.txt");
  const logStream = fs.createWriteStream(logFile, { flags: "a" });
  const emit: CaptureLogger = (level, msg) => {
    logStream.write(`${nowIso()} [${level}] ${msg}\n`);
    log(level, msg);
  };

  const snapshots: CapturedSnapshot[] = [];
  const net: CapturedNet[] = [];
  const downloads: CapturedDownload[] = [];
  // Har bir ochiq tab (sahifa) holati — multi-tab kuzatish uchun.
  const tabs: {
    page: Page;
    idx: number;
    lastSig: string;
    settling: boolean;
  }[] = [];
  let netSeq = 0;
  let snapSeq = 0;
  let tabSeq = 0;
  let finishing = false;

  emit("info", `Yozuv papkasi: ${dir}`);

  // --- Brauzer ochish (KO'RINADI — foydalanuvchi qo'lda ishlaydi) ---
  const session = await openBrowserContext(
    profileDirFor("login", profileKey),
    { profileKey, noProxy: !proxy },
    { cdpProfileBase: slotMonitorProfileBase(), cdpFreshProfile: false },
  );
  const context: BrowserContext = session.context;
  emit("info", "Brauzer ochildi");

  const page: Page = await context.newPage();
  // Hozir kuzatilayotgan (faol) tab — qo'lda snapshot / heartbeat shu tabni oladi.
  let activePage: Page = page;

  // --- NETWORK yozish (XHR/fetch/document payload + javob) ---
  const recordResponse = async (res: Response): Promise<void> => {
    if (finishing) return;
    let rec: CapturedNet | null = null;
    try {
      const req = res.request();
      const method = req.method();
      const url = res.url();
      const rt = req.resourceType();
      const status = res.status();
      const headers = res.headers();
      const mime = (headers["content-type"] || "").split(";")[0].trim();
      const isPdf = /application\/pdf/i.test(mime) || /\.pdf($|\?)/i.test(url);
      const isText =
        /json|text|xml|javascript|html|csv|x-www-form-urlencoded/i.test(mime);
      // Faqat MA'NOLI so'rovlar uchun body saqlaymiz (XHR/fetch/document/PDF).
      // Rasm/shrift/media/stylesheet/script — faqat metadata (manifestda ko'rinadi).
      const meaningful =
        rt === "xhr" ||
        rt === "fetch" ||
        rt === "document" ||
        isPdf ||
        (isText && rt !== "script" && rt !== "stylesheet");

      netSeq += 1;
      const seq = netSeq;
      let size = 0;
      let savedBody = false;
      let file: string | undefined;

      if (meaningful) {
        let bodyBuf: Buffer | null = null;
        try {
          bodyBuf = await res.body();
          size = bodyBuf.length;
        } catch {
          bodyBuf = null;
        }

        if (isPdf && bodyBuf) {
          // PDF inline kelgan — downloads'ga saqlaymiz.
          const fn = `${pad(seq, 4)}-${safeName(slugUrl(url, 30))}.pdf`;
          const fp = path.join(dlDir, fn);
          fs.writeFileSync(fp, bodyBuf);
          downloads.push({
            time: nowIso(),
            filename: fn,
            url,
            file: path.relative(dir, fp),
            size,
          });
          emit("pdf", `inline PDF -> downloads/${fn} (${kb(size)})`);
        }

        // So'rov yozuvini faylga yozamiz.
        const reqBody = safePostData(req);
        let respText: string | null = null;
        if (bodyBuf && (isText || mime === "")) {
          respText = bodyBuf.toString("utf8");
          if (respText.length > 500_000) {
            respText = respText.slice(0, 500_000) + "\n...[TRUNCATED]";
          }
        }
        const fn = `${pad(seq, 4)}-${method}-${status}-${safeName(
          slugUrl(url, 36),
        )}.json`;
        const fp = path.join(netDir, fn);
        const payload = {
          seq,
          time: nowIso(),
          method,
          url,
          resourceType: rt,
          status,
          requestHeaders: req.headers(),
          requestBody: reqBody,
          responseHeaders: headers,
          responseMime: mime,
          responseSize: size,
          responseBody: respText,
        };
        try {
          fs.writeFileSync(fp, JSON.stringify(payload, null, 2));
          savedBody = !!respText;
          file = path.relative(dir, fp);
        } catch {
          /* yozib bo'lmadi — metadata baribir qoladi */
        }

        // Faqat ma'noli (api/form) so'rovlarni konsolga chiqaramiz.
        if (rt === "xhr" || rt === "fetch" || rt === "document" || isPdf) {
          const tail = shortUrl(url);
          emit(
            "net",
            `${method.padEnd(4)} ${status} ${tail} ${gray2(
              `(${rt}, ${kb(size)})`,
            )}`,
          );
        }
      }

      rec = {
        seq,
        time: nowIso(),
        method,
        url,
        resourceType: rt,
        status,
        mime,
        size,
        savedBody,
        file,
      };
    } catch {
      rec = null;
    }
    if (rec) net.push(rec);
  };
  // --- DOWNLOAD yozish (PDF va boshqa fayllar) ---
  const handleDownload = async (d: Download): Promise<void> => {
    try {
      const fn = safeName(d.suggestedFilename() || "download.bin", 80);
      const fp = path.join(dlDir, `${pad(downloads.length + 1, 2)}-${fn}`);
      await d.saveAs(fp);
      let size = 0;
      try {
        size = fs.statSync(fp).size;
      } catch {
        /* ignore */
      }
      downloads.push({
        time: nowIso(),
        filename: fn,
        url: d.url(),
        file: path.relative(dir, fp),
        size,
      });
      emit(
        "pdf",
        `yuklab olindi -> downloads/${path.basename(fp)} (${kb(size)})`,
      );
    } catch (e) {
      emit("warn", `download xato: ${errMsg(e)}`);
    }
  };
  // --- SNAPSHOT (skrinshot + HTML + tuzilma JSON) ---
  // target = qaysi tabni suratga olamiz (default: faol tab).
  const snapshot = async (
    event: string,
    target: Page = activePage,
  ): Promise<void> => {
    if (finishing || target.isClosed()) return;
    snapSeq += 1;
    const seq = snapSeq;
    const base = `${pad(seq)}-${safeName(event, 24)}`;
    const png = path.join(shotsDir, `${base}.png`);
    const html = path.join(pagesDir, `${base}.html`);
    const json = path.join(pagesDir, `${base}.json`);
    const tabIdx = tabs.find((t) => t.page === target)?.idx ?? 1;
    let url = "";
    let title = "";
    let forms = 0;
    let inputs = 0;
    let buttons = 0;
    let expiredNote = "";
    try {
      url = target.url();
      await target
        .screenshot({ path: png, fullPage: true, timeout: 15000 })
        .catch(() => target.screenshot({ path: png, timeout: 15000 }));
      const content = await target.content().catch(() => "");
      if (content) fs.writeFileSync(html, content);
      const info = (await target
        .evaluate(PAGE_INFO_FN)
        .catch(() => null)) as ReturnType<typeof PAGE_INFO_FN> | null;
      if (info) {
        fs.writeFileSync(json, JSON.stringify(info, null, 2));
        title = info.title || "";
        forms = info.forms.length;
        inputs = info.inputs.length;
        buttons = info.buttons.length;
        // "Session Expired (401)" / page-not-found sahifasini ANIQLAYMIZ —
        // lekin hech narsa qilmaymiz (avtomatik login YO'Q). Faqat kutamiz;
        // siz qo'lda "Sign In" qilasiz, tool yozishda davom etadi.
        const bt = (info.bodyText || "").toLowerCase();
        const lu = (info.url || url).toLowerCase();
        if (
          lu.includes("page-not-found") ||
          lu.includes("session-expired") ||
          bt.includes("session expired or invalid") ||
          bt.includes("session has expired") ||
          bt.includes("(401)")
        ) {
          expiredNote =
            "Session Expired (401) aniqlandi — KUTILMOQDA. Qo'lda Sign In qiling; " +
            "tool avtomatik hech narsa qilmaydi, har qadamni yozib boradi.";
        }
      }
    } catch (e) {
      emit("warn", `snapshot xato: ${errMsg(e)}`);
    }
    snapshots.push({
      seq,
      time: nowIso(),
      event,
      tab: tabIdx,
      url,
      title,
      forms,
      inputs,
      buttons,
      png: path.relative(dir, png),
      html: path.relative(dir, html),
      json: path.relative(dir, json),
    });
    emit(
      "snap",
      `#${pad(seq)} ${gray2(`tab${tabIdx}`)} ${event.padEnd(8)} ${shortUrl(
        url,
      )} ${gray2(`(forma=${forms} maydon=${inputs} tugma=${buttons})`)}`,
    );
    if (expiredNote) emit("warn", expiredNote);
  };

  // --- Loading tugashini kutish (Angular/Material spinner) ---
  // Imzo o'zgargach DARROV surat olmaymiz: avval loading ketsin va sahifa imzosi
  // settleStableMs barqaror tursin. Aks holda "Loading..." oraliq holati tushadi.
  const waitSettled = async (target: Page): Promise<void> => {
    if (settleMaxMs <= 0) return;
    const start = Date.now();
    let lastSeen = "";
    let stableSince = Date.now();
    while (Date.now() - start < settleMaxMs) {
      if (finishing || target.isClosed()) return;
      let busy = false;
      let sig = "";
      try {
        busy = (await target.evaluate(PAGE_BUSY_FN)) as boolean;
        sig = (await target.evaluate(STEP_SIG_FN)) as string;
      } catch {
        // navigatsiya ketmoqda — bir oz kutib qayta urinamiz.
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      if (sig !== lastSeen) {
        lastSeen = sig;
        stableSince = Date.now();
      }
      if (!busy && Date.now() - stableSince >= settleStableMs) return;
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  // Loading tinchigach snapshot oladi va tabning yakuniy imzosini saqlaydi.
  const settleAndSnap = async (
    event: string,
    state: { page: Page; idx: number; lastSig: string; settling: boolean },
  ): Promise<void> => {
    if (state.settling) return;
    state.settling = true;
    try {
      await waitSettled(state.page);
      if (finishing || state.page.isClosed()) return;
      await snapshot(event, state.page);
      state.lastSig = await state.page
        .evaluate(STEP_SIG_FN)
        .catch(() => state.lastSig);
    } finally {
      state.settling = false;
    }
  };

  // --- Tab ro'yxatga olish (asosiy + yangi ochilgan tablar) ---
  // Har bir tabga network/download/yopilish listenerlari ulanadi va u poll
  // halqasiga qo'shiladi. Yangi tab ochilsa — boshlang'ich snapshot olinadi.
  const registerPage = (p: Page, isMain: boolean) => {
    tabSeq += 1;
    const idx = tabSeq;
    const state = { page: p, idx, lastSig: "", settling: false };
    tabs.push(state);
    activePage = p;
    p.on("response", (res) => void recordResponse(res));
    p.on("requestfailed", (req) => {
      if (finishing) return;
      const f = req.failure();
      emit(
        "warn",
        `REQFAIL ${req.method()} ${shortUrl(req.url())} (${
          f?.errorText || "?"
        })`,
      );
    });
    p.on("download", (d) => void handleDownload(d));
    p.on("close", () => {
      if (finishing) return;
      const open = tabs.filter((t) => !t.page.isClosed());
      if (open.length === 0) {
        finish("hamma tab yopildi");
      } else {
        activePage = open[open.length - 1].page;
        emit("nav", `tab #${idx} yopildi (${open.length} ta ochiq qoldi)`);
      }
    });
    if (!isMain) {
      emit("nav", `yangi tab #${idx} ochildi`);
      // DOM tayyor + loading tugagach boshlang'ich snapshot (poll dublikatini oldini olish).
      void p
        .waitForLoadState("domcontentloaded", { timeout: 30000 })
        .catch(() => {})
        .then(async () => {
          if (finishing || p.isClosed()) return;
          await settleAndSnap("yangi-tab", state);
        });
    }
  };

  registerPage(page, true);
  // Foydalanuvchi yangi tab ochsa (target=_blank / window.open) — kuzatamiz.
  context.on("page", (p: Page) => {
    if (tabs.some((t) => t.page === p)) return;
    registerPage(p, false);
  });

  // --- Boshlanish navigatsiyasi (PASSIV: avtomatik login/dashboard YO'Q) ---
  // Faqat berilgan URL (yoki login sahifasi) ochiladi. Token tiklash va
  // dashboard'ga avtomatik o'tish DEFAULT O'CHIQ — aks holda eskirgan token
  // "Session Expired (401)" sahifasiga olib boradi. Login/navigatsiyani SIZ
  // qo'lda qilasiz; tool faqat kuzatib, tartib bilan yozadi.
  try {
    let target = opts.startUrl || loginUrl();
    if (restore) {
      // Ixtiyoriy (--restore): saqlangan token bo'lsa tiklab, dashboard'ga o'tamiz.
      await page
        .goto(loginUrl(), { waitUntil: "domcontentloaded", timeout: 45000 })
        .catch(() => {});
      const hadToken = await restoreSession(page, profileKey).catch(
        () => false,
      );
      emit(
        "info",
        hadToken
          ? "Saqlangan token tiklandi (--restore)"
          : "Token yo'q — qo'lda login qiling",
      );
      if (hadToken && !opts.startUrl) target = dashboardUrl();
    } else {
      emit(
        "info",
        "Passiv rejim — login va navigatsiyani QO'LDA qiling (avtomatik hech narsa qilinmaydi)",
      );
    }
    await page
      .goto(target, { waitUntil: "domcontentloaded", timeout: 45000 })
      .catch(() => {});
    emit("nav", `boshlang'ich sahifa: ${shortUrl(page.url())}`);
  } catch (e) {
    emit("warn", `boshlang'ich navigatsiya: ${errMsg(e)}`);
  }

  // Boshlang'ich snapshot — loading tugagach (Angular bootstrap).
  if (tabs[0]) {
    await settleAndSnap("start", tabs[0]);
  } else {
    await snapshot("start", page);
  }

  // --- Tugash mexanizmi (vaqt / yopilish / "q") ---
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));
  const finish = (reason: string) => {
    if (finishing) return;
    finishing = true;
    emit("info", `Tugatilmoqda (${reason})`);
    resolveDone();
  };

  const deadline = setTimeout(() => finish("vaqt tugadi"), openMs);
  context.on("close", () => finish("brauzer yopildi"));
  // Tab yopilishi registerPage ichida boshqariladi — bitta tab yopilsa
  // to'xtamaymiz; faqat HAMMA tab yoki brauzer yopilganda tugaymiz.

  // SPA qadam o'zgarishini HAR BIR ochiq tabda kuzatamiz.
  const pollTimer = setInterval(() => {
    if (finishing) return;
    for (const t of tabs) {
      if (t.page.isClosed() || t.settling) continue;
      t.page
        .evaluate(STEP_SIG_FN)
        .then((sig: string) => {
          if (!finishing && sig && sig !== t.lastSig && !t.settling) {
            t.lastSig = sig;
            activePage = t.page;
            // Loading tugagach surat olamiz (oraliq "Loading" holatini o'tkazib).
            void settleAndSnap("step", t);
          }
        })
        .catch(() => {});
    }
  }, pollMs);

  // Majburiy davriy snapshot (ixtiyoriy).
  const hbTimer =
    heartbeatMs > 0
      ? setInterval(() => {
          if (!finishing) void snapshot("auto", activePage);
        }, heartbeatMs)
      : null;

  // Klaviatura: Enter = qo'lda snapshot, q = chiqish.
  const onStdin = (chunk: Buffer) => {
    const s = chunk.toString().trim().toLowerCase();
    if (s === "q" || s === "quit" || s === "exit") {
      finish("foydalanuvchi to'xtatdi");
    } else {
      void snapshot("manual", activePage);
    }
  };
  if (interactive && process.stdin.isTTY) {
    try {
      process.stdin.resume();
      process.stdin.on("data", onStdin);
    } catch {
      /* stdin yo'q — e'tiborsiz */
    }
  }

  await done;

  // --- Tozalash + manifest ---
  clearTimeout(deadline);
  clearInterval(pollTimer);
  if (hbTimer) clearInterval(hbTimer);
  if (interactive && process.stdin.isTTY) {
    try {
      process.stdin.off("data", onStdin);
      process.stdin.pause();
    } catch {
      /* ignore */
    }
  }

  // Token saqlash — FAQAT logged-in holatda. Login/expired/404 sahifasida
  // saqlasak, mavjud yaxshi sessiyani bo'sh holat bilan buzib qo'yamiz. Shuning
  // uchun bunday sahifalarda saqlamaymiz (qo'lda muvaffaqiyatli login bo'lsa — saqlaymiz).
  try {
    const savePage = !page.isClosed()
      ? page
      : tabs.find((t) => !t.page.isClosed())?.page;
    if (savePage) {
      const u = savePage.url().toLowerCase();
      const loggedOut =
        /\/login(\b|\/|\?|$)/.test(u) ||
        u.includes("page-not-found") ||
        u.includes("session-expired");
      if (!loggedOut) await saveSession(savePage, profileKey);
    }
  } catch {
    /* ignore */
  }

  const durationMs = Date.now() - startedAt;
  const manifest = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: nowIso(),
    durationMs,
    profileKey,
    startUrl: opts.startUrl || null,
    counts: {
      tabs: tabSeq,
      snapshots: snapshots.length,
      requests: net.length,
      downloads: downloads.length,
    },
    snapshots,
    downloads,
    network: net,
  };
  const manifestPath = path.join(dir, "manifest.json");
  try {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (e) {
    emit("warn", `manifest yozilmadi: ${errMsg(e)}`);
  }

  try {
    await session.close();
  } catch {
    /* ignore */
  }
  logStream.end();

  return {
    dir,
    tabs: tabSeq,
    snapshots: snapshots.length,
    requests: net.length,
    downloads: downloads.length,
    durationMs,
    manifestPath,
  };
}

// ---- kichik yordamchilar (Node tarafi — named OK) ----

function safePostData(req: import("playwright").Request): string | null {
  try {
    const d = req.postData();
    if (!d) return null;
    return d.length > 100_000 ? d.slice(0, 100_000) + "...[TRUNCATED]" : d;
  } catch {
    return null;
  }
}

function shortUrl(u: string): string {
  try {
    const p = new URL(u);
    const tail = (p.pathname + p.search).slice(0, 60);
    return p.hostname + tail;
  } catch {
    return u.slice(0, 80);
  }
}

function kb(n: number): string {
  if (!n) return "0b";
  if (n < 1024) return `${n}b`;
  return `${(n / 1024).toFixed(1)}kb`;
}

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 160);
}

// Konsolga oz gray (ANSI pipe'da ishlaydi). Module ichida faqat shu yer rang
// beradi; asosiy prezentatsiya CLI'da.
function gray2(s: string): string {
  if ((process.env.LOG_COLOR || "true").toLowerCase() === "false") return s;
  return `\x1b[90m${s}\x1b[0m`;
}
