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

    // Kod (yoki "uzbek") ni o'z ichiga olgan variantni bosamiz.
    const picked = await page.evaluate((wanted) => {
      const opts = Array.from(
        document.querySelectorAll(
          "mat-option, .mat-mdc-option, .mat-option, [role='option'], .iti__country, li.country",
        ),
      ) as HTMLElement[];
      if (opts.length === 0) return false;
      let chosen =
        opts.find((o) => (o.textContent || "").includes("+" + wanted)) ||
        opts.find((o) => (o.textContent || "").includes(wanted)) ||
        opts.find((o) => (o.textContent || "").toLowerCase().includes("uzbek"));
      if (!chosen) return false;
      chosen.scrollIntoView({ block: "center" });
      chosen.click();
      return true;
    }, want);

    await humanPause(150, 350);
    if (picked) {
      step(`Dial code tanlandi (+${want}) ✓`);
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
    const boxes = page.locator(
      "mat-checkbox, .mat-mdc-checkbox, .mat-checkbox, input[type='checkbox']",
    );
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
        if (s >= 400) {
          pageErrors.push(`HTTP ${s}: ${res.url().slice(0, 80)}`.slice(0, 200));
        }
      });

      // Warmup: login bilan bir xil — avval yengilroq sahifa (region cookie +
      // Cloudflare). .env: BOOKING_WARMUP_URL.
      const warmupUrl = (process.env.BOOKING_WARMUP_URL || "").trim();
      if (warmupUrl && warmupUrl !== url && attempt === 0) {
        step("Asosiy sahifa (warmup) ochilmoqda...");
        await p
          .goto(warmupUrl, { waitUntil: "commit", timeout: 45000 })
          .catch(() => {});
        await waitForCloudflareClear(p, step);
        if (await acceptCookies(p)) step("Cookie qabul qilindi");
        await humanPause(400, 800);
        step("Warmup tugadi, register sahifasiga o'tilmoqda...");
      }

      step("Register sahifasi ochilmoqda...");
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
      step(
        gotoError
          ? "Sahifa ochilmadi (proxy/ulanish xatosi)"
          : `Sahifa ochildi (HTTP ${base.statusCode ?? "?"})`,
      );

      if (!gotoError && shouldLogExitIp()) {
        base.exitIp = await readExitIp(p);
        step(`Exit IP: ${base.exitIp || "—"}`);
      }

      const cleared = gotoError ? false : await waitForCloudflareClear(p, step);
      const blocked = gotoError || base.statusCode === 403 || !cleared;
      lastGotoError = gotoError;
      if (!gotoError && base.statusCode != null) pageOpened = true;

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

    if (await acceptCookies(page)) step("Cookie qabul qilindi");

    // EMAIL — Angular Material register formasi.
    const emailSel =
      '#email, input[formcontrolname="email"], input[type="email"]';
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
    }
    await humanPause();

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

    // MOBILE NUMBER — lokal raqam (dial codesiz).
    const phoneSel =
      '#mobileNumber, input[formcontrolname="mobileNumber"], input[formcontrolname="mobile"], input[formcontrolname="phoneNumber"], input[type="tel"]';
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
    if (opts?.submit && base.registerButtonFound && base.registerButtonEnabled) {
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
