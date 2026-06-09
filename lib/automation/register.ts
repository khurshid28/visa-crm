// ====================================================================
//  REGISTER — VFS booking saytida yangi akkaunt yaratish (BOOKING_REGISTER_URL)
// ====================================================================
//  Login logikasining aynan o'xshashi, lekin ro'yxatdan o'tish formasi uchun:
//   email + password + confirm password + dial code (+998) + mobile number +
//   3 ta checkbox (privacy / data-transfer / terms) + Cloudflare Turnstile.
//  Proxy (sticky, email bo'yicha) + CDP/stealth + IP'ga mos timezone/til +
//  Turnstile token kutish — hammasi login bilan bir xil.
//
//  DIQQAT: hozircha "Register" tugmasini BOSMAYDI (opts.submit=true bo'lmasa).
//  Faqat formani to'liq to'ldirib, tugma bosishga tayyor holatgacha olib boradi.
//  Keyingi bosqich: register bosilgach gmailga kod keladi va aktivatsiya
//  qilinadi (runActivation / mail-listener).
// ====================================================================

import { isProxyEnabled, shouldLogExitIp } from "../proxy";
import type { RegisterResult } from "./types";
import { humanPause } from "./human";
import {
  openBrowserContext,
  profileDirFor,
  applyResourceBlocking,
} from "./browser";
import {
  acceptCookies,
  readExitIp,
  fillFieldReliably,
  dumpDebug,
  dumpNetwork,
  type NetCapture,
} from "./page-utils";
import {
  clickTurnstile,
  waitForCloudflareClear,
  waitForTurnstile,
} from "./turnstile";

type Page = import("playwright").Page;

/**
 * Telefon raqamini dial code (998) va lokal raqamga ajratadi.
 *  "+998901234567" / "998901234567" / "901234567" / "0901234567" -> "901234567"
 * dialCode old qo'shimchasi va bosh "0" olib tashlanadi.
 */
function splitPhone(
  phone: string,
  dialCode: string,
): { dial: string; local: string } {
  const dial = (dialCode || "998").replace(/\D/g, "") || "998";
  let local = (phone || "").replace(/[\s()-]/g, "").replace(/^\+/, "");
  if (local.startsWith(dial)) local = local.slice(dial.length);
  local = local.replace(/^0+/, "");
  return { dial, local };
}

/**
 * VFS S3/CloudFront ba'zan TOZA profilda sahifani topa olmay "NoSuchKey" 404
 * qaytaradi (one-pager/bookappointment/bookappointment.htm). Bu FLAKY — bir
 * necha marta qayta yuklasak (CloudFront origin'i "qiziydi") 2-3-urinishda
 * haqiqiy SPA keladi. Shuning uchun 404/NoSuchKey bo'lsa qayta yuklaymiz.
 * { response, gotoError, statusCode, noSuchKey } qaytaradi (throw qilmaydi).
 */
async function loadWithHealing(
  p: Page,
  targetUrl: string,
  step: (m: string) => void,
  pageErrors: string[],
  opts: {
    waitUntil: "commit" | "domcontentloaded";
    maxReloads: number;
    label: string;
  },
): Promise<{
  response: import("playwright").Response | null;
  gotoError: boolean;
  statusCode: number | null;
  noSuchKey: boolean;
}> {
  let response: import("playwright").Response | null = null;
  let gotoError = false;
  let statusCode: number | null = null;
  let noSuchKey = false;
  for (let load = 0; load <= opts.maxReloads; load++) {
    gotoError = false;
    try {
      response = await p.goto(targetUrl, {
        waitUntil: opts.waitUntil,
        timeout: 45000,
      });
    } catch (e) {
      gotoError = true;
      const m = e instanceof Error ? e.message : String(e);
      pageErrors.push(`goto(${opts.label}): ${m}`.slice(0, 200));
      break; // proxy/tunnel xatosi — qayta yuklash yordam bermaydi
    }
    statusCode = response ? response.status() : null;
    // 404 yoki status yo'q bo'lsa — bu VFS NoSuchKey sahifasimi tekshiramiz.
    let body = "";
    if (statusCode === 404 || statusCode === 403 || statusCode == null) {
      body = (
        await p
          .locator("body")
          .innerText()
          .catch(() => "")
      )
        .slice(0, 400)
        .toLowerCase();
    }
    noSuchKey =
      statusCode === 404 ||
      /nosuchkey|specified key does not exist|404 not found/.test(body);
    if (!noSuchKey) break; // sahifa keldi (yoki boshqa holat) — chiqamiz
    if (load < opts.maxReloads) {
      step(
        `${opts.label}: VFS 404 (NoSuchKey) — qayta yuklanmoqda (#${load + 1})...`,
      );
      await waitForCloudflareClear(p, step).catch(() => {});
      if (await acceptCookies(p)) step("Cookie qabul qilindi");
      await humanPause(900, 1600);
    }
  }
  return { response, gotoError, statusCode, noSuchKey };
}

/**
 * VFS rate-limit / blok holatini aniqlaydi (register oqimida HAR QADAMda
 * tekshirib turamiz — config API 429 bo'lsa SPA `page-not-found`ga redirect
 * qiladi va forma YO'QOLADI; keyin maydonlarni 60s behuda kutib o'tirmaymiz).
 *  - 429201 "Permission Issue" (register, ~2 soat cooldown)
 *  - 429001 "unusual activity" (login/akkaunt bloki)
 * Topilsa qisqa kod-satr qaytaradi (masalan "429201"), aks holda null.
 */
async function detectRegisterBlock(p: Page): Promise<string | null> {
  try {
    const url = p.url().toLowerCase();
    const txt = (
      await p
        .locator("body")
        .innerText()
        .catch(() => "")
    ).toLowerCase();
    if (txt.includes("429201") || txt.includes("permission issue"))
      return "429201";
    if (txt.includes("429001") || txt.includes("unusual activity"))
      return "429001";
    if (/multiple requests within a short period/.test(txt)) return "429";
    if (url.includes("page-not-found")) return "page-not-found";
    return null;
  } catch {
    return null;
  }
}

/**
 * "Dial Code" dropdownidan +998 (yoki berilgan kod) ni tanlaydi.
 * VFS Angular Material mat-select (yoki native select / qidiruvli overlay)
 * bo'lishi mumkin — bir necha usulni ketma-ket sinaydi. Hech qachon throw qilmaydi.
 */
async function selectDialCode(
  page: Page,
  dialCode: string,
  step: (m: string) => void,
): Promise<boolean> {
  const want = (dialCode || "998").replace(/\D/g, "") || "998";

  // 1) NATIVE <select> — "dial"/"code"/"country" so'zli select bo'lsa.
  try {
    const nativePicked = await page.evaluate((wanted) => {
      const selects = Array.from(
        document.querySelectorAll("select"),
      ) as HTMLSelectElement[];
      for (const sel of selects) {
        const block = (
          sel.closest("label, .field, .form-group, div")?.textContent || ""
        ).toLowerCase();
        const attrs = (
          (sel.getAttribute("name") || "") +
          " " +
          (sel.getAttribute("id") || "") +
          " " +
          (sel.getAttribute("formcontrolname") || "") +
          " " +
          (sel.getAttribute("aria-label") || "")
        ).toLowerCase();
        if (!/dial|code|country|phone|mobile/.test(block + " " + attrs))
          continue;
        for (const opt of Array.from(sel.options)) {
          const t = (opt.text + " " + opt.value).toLowerCase();
          if (t.includes(wanted) || t.includes("uzbek")) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
      }
      return false;
    }, want);
    if (nativePicked) {
      step(`Dial code tanlandi (+${want}) ✓`);
      return true;
    }
  } catch {
    /* keyingi usul */
  }

  // 2) Angular Material mat-select (yoki [role=combobox]) — "dial" yorlig'iga
  //    eng yaqin tetikni topib OCHAMIZ.
  try {
    const opened = await page.evaluate(() => {
      // VFS register dial code = <mat-select formcontrolname="dialcode">.
      // ANIQ shu tetikni birinchi sinaymiz, keyin yorliq/birinchi tetik.
      const exact = document.querySelector(
        'mat-select[formcontrolname="dialcode"]',
      ) as HTMLElement | null;
      if (exact) {
        exact.scrollIntoView({ block: "center" });
        exact.click();
        return true;
      }
      const triggers = Array.from(
        document.querySelectorAll(
          "mat-select, .mat-mdc-select, .mat-select, [role='combobox'], .iti, .iti__selected-flag, ngx-intl-tel-input .dropdown-toggle",
        ),
      ) as HTMLElement[];
      if (triggers.length === 0) return false;
      let target: HTMLElement | null = null;
      for (const t of triggers) {
        const block = (
          t.closest(
            ".mat-mdc-form-field, mat-form-field, .field, .form-group, div",
          )?.parentElement || t.parentElement
        )?.textContent;
        if ((block || "").toLowerCase().includes("dial")) {
          target = t;
          break;
        }
      }
      // Yorliq topilmasa — sahifadagi BIRINCHI tetik (odatda dial code birinchi).
      if (!target) target = triggers[0];
      if (!target) return false;
      target.scrollIntoView({ block: "center" });
      target.click();
      return true;
    });
    if (!opened) {
      step("Dial code dropdown topilmadi");
      return false;
    }

    // Overlay variantlari render bo'lishini kutamiz.
    await page
      .waitForSelector(
        "mat-option, .mat-mdc-option, .mat-option, [role='option'], .iti__country, li.country",
        { timeout: 3000, state: "visible" },
      )
      .catch(() => {});

    // Qidiruv inputi bo'lsa — kodni yozamiz (uzun ro'yxatni filtrlaydi).
    try {
      const searchInput = page
        .locator(
          ".cdk-overlay-container input, .mat-select-search-input, input.iti__search-input, input[type='search']",
        )
        .first();
      if ((await searchInput.count()) > 0 && (await searchInput.isVisible())) {
        await searchInput.fill(want).catch(() => {});
        await humanPause(200, 450);
      }
    } catch {
      /* qidiruv yo'q — to'g'ridan-to'g'ri ro'yxatdan tanlaymiz */
    }

    // Kod (yoki "uzbek") ni o'z ichiga olgan variantni bosamiz. +998 ANIQ
    // mosligini birinchi qidiramiz (boshqa davlat matnida "998" bo'lib qolmasin).
    const picked = await page.evaluate((wanted) => {
      const opts = Array.from(
        document.querySelectorAll(
          "mat-option, .mat-mdc-option, .mat-option, [role='option'], .iti__country, li.country",
        ),
      ) as HTMLElement[];
      if (opts.length === 0) return false;
      const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
      const chosen =
        opts.find((o) => norm(o.textContent || "").includes("+" + wanted)) ||
        opts.find((o) =>
          norm(o.textContent || "")
            .toLowerCase()
            .includes("uzbek"),
        ) ||
        opts.find((o) => norm(o.textContent || "").includes(wanted));
      if (!chosen) return false;
      chosen.scrollIntoView({ block: "center" });
      chosen.click();
      return true;
    }, want);

    await humanPause(150, 350);
    if (picked) {
      // TASDIQLASH: mat-select qiymati endi +998 ni ko'rsatyaptimi?
      const shown = await page
        .evaluate(() => {
          const v = document.querySelector(
            'mat-select[formcontrolname="dialcode"] .mat-mdc-select-value, mat-select[formcontrolname="dialcode"] .mat-select-value, mat-select[formcontrolname="dialcode"]',
          );
          return (v?.textContent || "").replace(/\s+/g, " ").trim();
        })
        .catch(() => "");
      if (shown.includes(want)) {
        step(`Dial code tanlandi (+${want}) ✓`);
      } else {
        step(`Dial code bosildi (+${want}) — qiymat: "${shown || "—"}"`);
      }
      return true;
    }
    step("Dial code varianti topilmadi (+" + want + ")");
    return false;
  } catch {
    return false;
  }
}

/**
 * Roziliklarga oid checkboxlar (privacy / data-transfer / terms) ni belgilaydi.
 * mat-checkbox yoki oddiy input[type=checkbox] bo'lishi mumkin. Belgilanmaganini
 * bosadi va belgilanganini qoldiradi. { total, checked } qaytaradi.
 */
async function checkConsentBoxes(
  page: Page,
  step: (m: string) => void,
): Promise<{ total: number; checked: number }> {
  let total = 0;
  let checked = 0;
  try {
    // VFS register = 3 ta <mat-checkbox> (processPerDataAgreed /
    // intTransPerDataAgreed / termAndConditionAgreed). mat-checkbox wrapper'ni
    // nishonlaymiz (ichki yashirin input'ni EMAS — aks holda ikki marta toggle
    // bo'lib qolardi). mat-checkbox bo'lmasa oddiy input[type=checkbox]'ga o'tamiz.
    let boxes = page.locator("mat-checkbox, .mat-mdc-checkbox, .mat-checkbox");
    if ((await boxes.count()) === 0) {
      boxes = page.locator("input[type='checkbox']");
    }
    total = await boxes.count();
    for (let i = 0; i < total; i++) {
      const box = boxes.nth(i);
      // Joriy holat: belgilangan bo'lsa o'tkazib yuboramiz.
      const isChecked = await box
        .evaluate((node: Element) => {
          if (node instanceof HTMLInputElement) return node.checked;
          const inner = node.querySelector(
            "input[type='checkbox']",
          ) as HTMLInputElement | null;
          if (inner) return inner.checked;
          const aria = node.getAttribute("aria-checked");
          if (aria != null) return aria === "true";
          return /(^|\s)(mat-mdc-checkbox-checked|mat-checkbox-checked)(\s|$)/.test(
            node.className || "",
          );
        })
        .catch(() => false);
      if (isChecked) {
        checked += 1;
        continue;
      }
      // Bosamiz: mat-checkbox ichidagi label/ko'rinadigan qism (input yashirin
      // bo'lishi mumkin — force bilan bosamiz). Inson kabi qisqa pauza.
      const clickTarget = box
        .locator("label, .mdc-checkbox, .mat-checkbox-inner-container")
        .first();
      const hasInner = (await clickTarget.count()) > 0;
      try {
        if (hasInner) await clickTarget.click({ timeout: 4000, force: true });
        else await box.click({ timeout: 4000, force: true });
      } catch {
        await box.click({ timeout: 4000, force: true }).catch(() => {});
      }
      await humanPause(180, 420);
      const nowChecked = await box
        .evaluate((node: Element) => {
          if (node instanceof HTMLInputElement) return node.checked;
          const inner = node.querySelector(
            "input[type='checkbox']",
          ) as HTMLInputElement | null;
          if (inner) return inner.checked;
          const aria = node.getAttribute("aria-checked");
          if (aria != null) return aria === "true";
          return /(^|\s)(mat-mdc-checkbox-checked|mat-checkbox-checked)(\s|$)/.test(
            node.className || "",
          );
        })
        .catch(() => false);
      if (nowChecked) checked += 1;
    }
    step(`Checkboxlar: ${checked}/${total} belgilandi`);
  } catch {
    /* jim */
  }
  return { total, checked };
}

/**
 * Booking saytida REGISTER qiladi (BOOKING_REGISTER_URL). Login bilan bir xil
 * stack: proxy (sticky, email bo'yicha) + stealth + IP'ga mos timezone/til +
 * Turnstile token kutish. Formani to'liq to'ldiradi, Register tugmasini
 * tayyorlaydi (default: BOSMAYDI). opts.submit=true bersangiz bosadi.
 * Hech qachon exception tashlamaydi — natija obyektini qaytaradi.
 */
export async function registerToBooking(
  email: string,
  password: string,
  phone: string,
  opts?: {
    profileKey?: string | null;
    onStep?: (msg: string) => void;
    noProxy?: boolean;
    dialCode?: string;
    submit?: boolean; // true bo'lsa Register bosiladi (default: bosilmaydi)
    cdpProfileBase?: string;
    cdpFreshProfile?: boolean;
  },
): Promise<RegisterResult> {
  const step = (msg: string) => {
    try {
      opts?.onStep?.(msg);
    } catch {
      /* ignore */
    }
  };
  const dialWanted = opts?.dialCode || "998";
  const { dial, local } = splitPhone(phone, dialWanted);
  const fullPhone = `+${dial}${local}`;
  const url = (process.env.BOOKING_REGISTER_URL || "").trim();
  const base: RegisterResult = {
    ok: false,
    note: "",
    url,
    finalUrl: "",
    captchaPresent: false,
    captchaSolved: false,
    filledEmail: false,
    filledPassword: false,
    filledConfirm: false,
    dialCodeSelected: false,
    filledPhone: false,
    checkboxesTotal: 0,
    checkboxesChecked: 0,
    registerButtonFound: false,
    registerButtonEnabled: false,
    submitted: false,
    email,
    password,
    phone: fullPhone,
    exitIp: null,
    statusCode: null,
    pageError: null,
  };
  if (!url) {
    return { ...base, note: "URL sozlanmagan (.env: BOOKING_REGISTER_URL)" };
  }

  const pageErrors: string[] = [];
  const netCaptures: NetCapture[] = [];
  let closeSession: (() => Promise<void>) | null = null;
  // Sticky proxy: shu user (email) doim bir xil IP oladi (register profil bilan).
  const profileKey = opts?.profileKey || email;

  try {
    let page: Page | null = null;
    const maxIpRetries = Math.max(
      1,
      Number(process.env.BOOKING_PROXY_IP_RETRIES || "4"),
    );
    const proxyOn = isProxyEnabled() && !opts?.noProxy;
    let lastGotoError = false;
    let lastNoSuchKey = false;
    let lastLandedBad = false;
    let pageOpened = false;

    for (let attempt = 0; attempt < maxIpRetries; attempt++) {
      if (closeSession) {
        await closeSession().catch(() => {});
        closeSession = null;
      }

      const session = await openBrowserContext(
        profileDirFor("register", profileKey),
        { profileKey, ipAttempt: attempt, noProxy: opts?.noProxy },
        {
          cdpProfileBase: opts?.cdpProfileBase,
          cdpFreshProfile: opts?.cdpFreshProfile,
        },
      );
      closeSession = session.close;
      await applyResourceBlocking(session.context);
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
        const u = res.url();
        if (s >= 400) {
          pageErrors.push(`HTTP ${s}: ${u.slice(0, 80)}`.slice(0, 200));
        }
        // To'liq ushlash: VFS form/config/auth API'lari (ayniqsa xato bo'lsa) —
        // qaysi header/param kamligini bilish uchun request+response saqlaymiz.
        const isVfsApi =
          /lift-api|litf-api|lift\.vfsglobal|vfsglobal\.com\/(.*\/)?(configuration|data|account|user|register|log|otp|token)/i.test(
            u,
          );
        if (
          isVfsApi &&
          (s >= 400 || /configuration\/fields|\/data\//i.test(u))
        ) {
          void (async () => {
            try {
              const req = res.request();
              const reqHeaders = await req.allHeaders().catch(() => ({}));
              const resHeaders = await res.allHeaders().catch(() => ({}));
              let body = "";
              try {
                body = (await res.text()).slice(0, 4000);
              } catch {
                /* body o'qib bo'lmadi */
              }
              netCaptures.push({
                url: u,
                method: req.method(),
                status: s,
                requestHeaders: reqHeaders,
                requestBody: req.postData() || null,
                responseHeaders: resHeaders,
                responseBody: body,
              });
            } catch {
              /* ignore */
            }
          })();
        }
      });

      // To'g'ridan-to'g'ri REGISTER sahifasi — login/warmup YO'Q (foydalanuvchi
      // talabiga ko'ra). Ortiqcha sahifa ochish (login -> register) VFS
      // API'larini IKKI barobar chaqiradi va sticky IP'ni tezroq rate-limit
      // (429) qiladi — natijada forma render bo'lmay page-not-found'ga tushadi.
      // Shuning uchun faqat register'ni ochamiz. NoSuchKey 404 flaky bo'lsa
      // healing qayta yuklaydi (CloudFront qiziydi).
      step("Register sahifasi ochilmoqda...");
      const healed = await loadWithHealing(p, url, step, pageErrors, {
        waitUntil: "domcontentloaded",
        maxReloads: Math.max(
          0,
          Number(process.env.BOOKING_REGISTER_RELOAD_RETRIES || "4"),
        ),
        label: "register",
      });
      const gotoError = healed.gotoError;
      base.statusCode = healed.statusCode;
      const noSuchKey = healed.noSuchKey;

      if (!gotoError && !noSuchKey && attempt === 0 && shouldLogExitIp()) {
        base.exitIp = await readExitIp(p);
        step(`Exit IP: ${base.exitIp || "—"}`);
      }

      // Forma render bo'lishini KUTAMIZ: email maydoni CHIQADI, YOKI VFS config
      // API (configuration/fields) 429 bo'lsa SPA `page-not-found`ga REDIRECT
      // qiladi. Redirect ASINXRON (goto HTTP 200 qaytargan bo'lsa ham keyin
      // bo'ladi) — shu sabab navigatsiyadan keyin kutib, so'ng URL'ni tekshiramiz.
      if (!gotoError && !noSuchKey) {
        await p
          .waitForFunction(
            () =>
              !!document.querySelector(
                '#inputEmail, input[formcontrolname="emailid"], #email, input[formcontrolname="email"], input[type="email"]',
              ) || /page-not-found/i.test(location.href),
            undefined,
            { timeout: 20000 },
          )
          .catch(() => {});
      }

      // VFS backend xatosi: register o'rniga /page-not-found'ga tushadi (500/429).
      const landedBad = !gotoError && /page-not-found/i.test(p.url());
      if (landedBad) pageErrors.push(`landed: ${p.url().slice(0, 90)}`);

      step(
        gotoError
          ? "Sahifa ochilmadi (proxy/ulanish xatosi)"
          : noSuchKey
            ? `VFS 404 (NoSuchKey) — sahifa kelmadi (HTTP ${base.statusCode ?? "?"})`
            : landedBad
              ? "VFS backend xatosi — page-not-found'ga tushdi"
              : `Sahifa tayyor (HTTP ${base.statusCode ?? "?"})`,
      );

      const cleared = gotoError ? false : await waitForCloudflareClear(p, step);
      // 404/NoSuchKey yoki page-not-found = sahifa kelmadi -> yangi IP bilan
      // qayta urinamiz (region cookie / rate-limit IP'ga bog'liq bo'lishi mumkin).
      const blocked =
        gotoError ||
        base.statusCode === 403 ||
        base.statusCode === 404 ||
        noSuchKey ||
        landedBad ||
        !cleared;
      lastGotoError = gotoError;
      lastNoSuchKey = noSuchKey;
      lastLandedBad = landedBad;
      if (!gotoError && base.statusCode != null && !noSuchKey && !landedBad)
        pageOpened = true;

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

    if (!pageOpened && lastGotoError) {
      if (closeSession) await closeSession().catch(() => {});
      closeSession = null;
      base.pageError = pageErrors.slice(0, 10).join(" | ");
      return {
        ...base,
        note: "Proxy/VPN ulanmadi (ERR_TUNNEL_CONNECTION_FAILED) — internet/proxy balansini tekshiring",
      };
    }

    // Barcha urinishlardan keyin ham VFS NoSuchKey 404 — sahifa kelmadi.
    // Formani topishga urinmaymiz (yo'q). Aniq xabar qaytaramiz.
    if (!pageOpened && lastNoSuchKey) {
      await dumpDebug(page, "register-404").catch(() => {});
      if (closeSession) await closeSession().catch(() => {});
      closeSession = null;
      base.finalUrl = page.url();
      base.pageError = pageErrors.slice(0, 10).join(" | ");
      return {
        ...base,
        note: "VFS 404 (NoSuchKey) — register sahifasi kelmadi (CloudFront/region). Qayta urinib ko'ring yoki boshqa IP.",
      };
    }

    // Barcha urinishlardan keyin ham backend xatosi (page-not-found, 500/429).
    // Ko'pincha IP rate-limit/flagged — boshqa IP bilan urinish kerak.
    if (!pageOpened && lastLandedBad) {
      await dumpDebug(page, "register-pnf").catch(() => {});
      await humanPause(600, 900); // async body o'qishlar tugashi uchun
      dumpNetwork(netCaptures, "register-pnf-net");
      if (closeSession) await closeSession().catch(() => {});
      closeSession = null;
      base.finalUrl = page.url();
      base.pageError = pageErrors.slice(0, 10).join(" | ");
      return {
        ...base,
        note: "VFS backend xatosi (500 / page-not-found) — IP rate-limit bo'lishi mumkin. Boshqa IP bilan qayta urinib ko'ring.",
      };
    }

    if (await acceptCookies(page)) step("Cookie qabul qilindi");

    // EMAIL — VFS register: <input id="inputEmail" formcontrolname="emailid"
    // type="text"> (DIQQAT: formcontrolname "email" EMAS "emailid", type=email EMAS).
    const emailSel =
      '#inputEmail, input[formcontrolname="emailid"], input[placeholder="jane.doe@email.com"], #email, input[formcontrolname="email"], input[type="email"]';
    await page
      .waitForSelector(emailSel, { state: "visible", timeout: 20000 })
      .catch(() => {});

    // Turnstile token sahifa yuklanishi bilan FONda yechila boshlaydi — formani
    // to'ldirish bilan PARALLEL kutamiz (login bilan bir xil).
    const captchaPromise = waitForTurnstile(
      page,
      Number(process.env.BOOKING_CAPTCHA_AUTOPASS_MS || "6000"),
    );

    const emailEl = page.locator(emailSel).first();
    if ((await emailEl.count()) > 0) {
      const ok = await fillFieldReliably(page, emailEl, email);
      base.filledEmail = ok;
      step(ok ? "Email kiritildi" : "Email to'liq kiritilmadi (chala)");
    } else {
      step("Email maydoni topilmadi!");
      await dumpDebug(page, "register-noemail").catch(() => {});
      await humanPause(600, 900); // async body o'qishlar tugashi uchun
      dumpNetwork(netCaptures, "register-noemail-net");
    }
    await humanPause();

    // RATE-LIMIT GUARD: VFS config API 429 bo'lsa email'dan keyin sahifa
    // page-not-found'ga redirect bo'ladi va forma YO'QOLADI. Shu yerda
    // tekshiramiz — bloklangan bo'lsa qolgan maydonlarni 60s behuda kutmaymiz.
    const blockCode = await detectRegisterBlock(page);
    if (blockCode) {
      step(
        blockCode === "429201"
          ? "VFS rate-limit (429201) — Permission Issue, ~2 soat cooldown"
          : blockCode === "429001"
            ? "VFS akkaunt bloki (429001) — unusual activity"
            : blockCode === "page-not-found"
              ? "VFS page-not-found — config API 429 (rate-limit)"
              : "VFS rate-limit (429) — ko'p so'rov",
      );
      await dumpDebug(page, "register-ratelimit").catch(() => {});
      base.finalUrl = page.url();
      base.pageError = [`block: ${blockCode}`, ...pageErrors]
        .slice(0, 10)
        .join(" | ");
      if (closeSession) await closeSession().catch(() => {});
      closeSession = null;
      return {
        ...base,
        note:
          blockCode === "429201"
            ? "VFS rate-limit (429201 Permission Issue) — ~2 soat kuting yoki boshqa IP. Ko'p urinish bloklaydi."
            : blockCode === "429001"
              ? "VFS akkaunt bloklandi (429001 unusual activity) — kuting yoki boshqa akkaunt."
              : "VFS page-not-found (config API 429 rate-limit) — boshqa IP bilan urinib ko'ring.",
      };
    }

    // PASSWORD — ko'rinadigan parol inputi (confirm'dan farqli birinchisi).
    const passSel =
      '#password, input[formcontrolname="password"], input[type="password"]';
    const passEl = page.locator(passSel).first();
    if ((await passEl.count()) > 0) {
      const ok = await fillFieldReliably(page, passEl, password);
      base.filledPassword = ok;
      step(ok ? "Parol kiritildi" : "Parol to'liq kiritilmadi (chala)");
    } else {
      step("Parol maydoni topilmadi!");
    }
    await humanPause();

    // CONFIRM PASSWORD — confirmPassword formcontrol yoki 2-parol inputi.
    const confirmSel =
      '#confirmPassword, input[formcontrolname="confirmPassword"], input[formcontrolname="confirmpassword"], input[formcontrolname="cnfPassword"]';
    let confirmEl = page.locator(confirmSel).first();
    if ((await confirmEl.count()) === 0) {
      // Zaxira: ikkinchi password inputi (birinchisi asosiy parol).
      confirmEl = page.locator('input[type="password"]').nth(1);
    }
    if ((await confirmEl.count()) > 0) {
      const ok = await fillFieldReliably(page, confirmEl, password);
      base.filledConfirm = ok;
      step(ok ? "Confirm parol kiritildi" : "Confirm parol chala");
    } else {
      step("Confirm parol maydoni topilmadi!");
    }
    await humanPause();

    // DIAL CODE (+998) — telefon kodi dropdowni.
    base.dialCodeSelected = await selectDialCode(page, dial, step);
    await humanPause();

    // MOBILE NUMBER — lokal raqam (dial codesiz). VFS: formcontrolname="contact"
    // type="text" (DIQQAT: "mobileNumber" EMAS "contact").
    const phoneSel =
      'input[formcontrolname="contact"], #mobileNumber, input[formcontrolname="mobileNumber"], input[formcontrolname="mobile"], input[formcontrolname="phoneNumber"], input[type="tel"]';
    let phoneEl = page.locator(phoneSel).first();
    if ((await phoneEl.count()) === 0) {
      // Zaxira: "mobile"/"phone" so'zli ko'rinadigan input.
      phoneEl = page
        .locator(
          'input[name*="mobile" i], input[name*="phone" i], input[placeholder*="mobile" i], input[placeholder*="number" i]',
        )
        .first();
    }
    if ((await phoneEl.count()) > 0) {
      const ok = await fillFieldReliably(page, phoneEl, local);
      base.filledPhone = ok;
      step(ok ? `Telefon kiritildi (${local})` : "Telefon chala");
    } else {
      step("Telefon (mobile number) maydoni topilmadi!");
    }
    await humanPause();

    // 3 ta CHECKBOX (privacy / data-transfer / terms).
    const cb = await checkConsentBoxes(page, step);
    base.checkboxesTotal = cb.total;
    base.checkboxesChecked = cb.checked;
    await humanPause();

    // Cloudflare Turnstile — parallel boshlangan kutishni yig'amiz.
    step("Cloudflare Turnstile tekshirilmoqda...");
    let captcha = await captchaPromise;
    base.captchaPresent = captcha.present;
    base.captchaSolved = captcha.solved;

    if (captcha.present && !captcha.solved) {
      step("Captcha o'zi o'tmadi — ustiga bosilmoqda...");
      const clicked = await clickTurnstile(page);
      if (clicked) step("Captcha ustiga bosildi, token kutilmoqda...");
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

    await humanPause(150, 400);

    // Cookie banner Register tugmasini to'sib qo'yishi mumkin — yana yopamiz.
    if (await acceptCookies(page)) step("Cookie qabul qilindi");

    // "Register" tugmasini TOPAMIZ (lekin default: BOSMAYMIZ).
    const regBtn = page
      .locator(
        'button:has-text("Register"), button[type="submit"]:has-text("Register"), button[type="submit"]',
      )
      .first();
    base.registerButtonFound = (await regBtn.count()) > 0;
    if (base.registerButtonFound) {
      base.registerButtonEnabled = await regBtn.isEnabled().catch(() => false);
      step(
        base.registerButtonEnabled
          ? "Register tugmasi TAYYOR (faol) ✓"
          : "Register tugmasi hali NOFAOL (forma to'liq emas yoki captcha kutilmoqda)",
      );
    } else {
      step("Register tugmasi topilmadi!");
    }

    // opts.submit=true bo'lsagina bosamiz. Default: bosmaymiz (foydalanuvchi
    // so'ragan — register bosilishigacha olib boramiz, bosmaymiz).
    if (
      opts?.submit &&
      base.registerButtonFound &&
      base.registerButtonEnabled
    ) {
      await regBtn.click({ timeout: 8000 }).catch(() => {});
      base.submitted = true;
      step("Register bosildi");
      await page.waitForTimeout(1500).catch(() => {});
    } else if (!opts?.submit) {
      step("Register BOSILMADI (so'rovga ko'ra — tayyor holatda to'xtatildi)");
    }

    base.finalUrl = page.url();

    // Natija: forma to'liq to'ldirildimi?
    const formReady =
      base.filledEmail &&
      base.filledPassword &&
      base.filledConfirm &&
      base.filledPhone;
    base.ok = opts?.submit
      ? base.submitted
      : formReady && base.registerButtonFound;
    base.note = base.ok
      ? opts?.submit
        ? "Register bosildi (natija sahifada)"
        : "Forma to'ldirildi — Register bosishga tayyor (bosilmadi)"
      : !formReady
        ? "Forma to'liq to'ldirilmadi (ba'zi maydon topilmadi)"
        : "Register tugmasi topilmadi/nofaol";

    if (!base.ok) {
      await dumpDebug(page, "register-result").catch(() => {});
    }

    // Brauzerni ushlab turish (debug): BOOKING_KEEP_OPEN_MS — ko'rib turish uchun.
    const keepMs = Number(process.env.BOOKING_KEEP_OPEN_MS || "0");
    if (keepMs > 0) {
      step(`Brauzer ${Math.round(keepMs / 1000)}s ochiq qoldirilmoqda...`);
      await page.waitForTimeout(keepMs).catch(() => {});
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
      note: `Register xatosi: ${msg.slice(0, 200)}`,
      pageError: pageErrors.slice(0, 10).join(" | "),
    };
  }
}
