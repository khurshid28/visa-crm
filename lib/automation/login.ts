// ====================================================================
//  LOGIN — VFS booking saytiga kirish (BOOKING_LOGIN_URL)
// ====================================================================
//  Proxy (sticky, email bo'yicha) + CDP/stealth + IP'ga mos timezone/til +
//  Turnstile token kutish + login XHR javobidan token tutib olish.
// ====================================================================

import { isProxyEnabled, shouldLogExitIp } from "../proxy";
import type { LoginResult } from "./types";
import { humanPause } from "./human";
import {
  openBrowserContext,
  profileDirFor,
  applyResourceBlocking,
} from "./browser";
import {
  acceptCookies,
  readExitIp,
  readAuthToken,
  extractTokenFromBody,
  fillFieldReliably,
  dumpDebug,
  dumpStorage,
} from "./page-utils";
import {
  clickTurnstile,
  waitForCloudflareClear,
  waitForTurnstile,
} from "./turnstile";

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
  opts?: {
    profileKey?: string | null;
    onStep?: (msg: string) => void;
    noProxy?: boolean;
    cdpProfileBase?: string;
    cdpFreshProfile?: boolean;
  },
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
    token: null,
    tokenSource: null,
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
    // Boshlang'ich IP "salt" (.env: BOOKING_PROXY_IP_START, default 0). Akkauntning
    // asosiy sticky IP'si rate-limit (429) bo'lib qolsa, 1+ qo'yib BIRINCHI
    // urinishdanoq YANGI sticky IP'dan boshlash mumkin (o'sha akkaunt, boshqa IP).
    const ipStart = Math.max(
      0,
      Number(process.env.BOOKING_PROXY_IP_START || "0"),
    );
    const proxyOn = isProxyEnabled() && !opts?.noProxy;

    // Login POST javobidan token'ni TUTIB OLAMIZ (eng ishonchli yo'l): VFS
    // /login bosilganda XHR javobida token JSON ichida keladi. Shu yerda
    // ushlab qolamiz (localStorage'ga yozilmasligi mumkin).
    let capturedToken: string | null = null;
    let capturedTokenSource: string | null = null;
    // Login API (lift-api.../user/login) javob status'i — 429/4xx bo'lsa login
    // muvaffaqiyatsiz (rate-limit yoki noto'g'ri parol).
    let loginApiStatus: number | null = null;
    // Oxirgi urinish proxy/tunnel uzilishi bilan tugadimi? (VPN/proxy o'lik bo'lsa
    // bekorga davom etmaymiz — aniq xato qaytaramiz).
    let lastGotoError = false;
    let pageOpened = false;
    // DIAGNOSTIKA: har so'rov vaqti (.env: BOOKING_TIMING=true) — loop tashqarisida
    // yig'amiz, natija qismida eng sekinlarni chop etamiz.
    const timingOn =
      (process.env.BOOKING_TIMING || "").toLowerCase() === "true";
    const timings: { url: string; ms: number; type: string }[] = [];

    for (let attempt = 0; attempt < maxIpRetries; attempt++) {
      // Avvalgi (bloklangan) sessiyani yopamiz.
      if (closeSession) {
        await closeSession().catch(() => {});
        closeSession = null;
      }

      const session = await openBrowserContext(
        profileDirFor("login", profileKey),
        { profileKey, ipAttempt: ipStart + attempt, noProxy: opts?.noProxy },
        {
          cdpProfileBase: opts?.cdpProfileBase,
          cdpFreshProfile: opts?.cdpFreshProfile,
        },
      );
      closeSession = session.close;
      // Proxy trafigini tejash: og'ir resurslarni bloklaymiz.
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

      // DIAGNOSTIKA: har so'rov qancha ms ketganini o'lchaymiz (.env: BOOKING_TIMING=true).
      // Eng sekin so'rovlarni aniqlash uchun — qaysi joy sekin ekanini ko'rsatadi.
      const reqStart = new Map<string, number>();
      if (timingOn && attempt === 0) {
        p.on("request", (req: import("playwright").Request) => {
          reqStart.set(req.url(), Date.now());
        });
        p.on("requestfinished", (req: import("playwright").Request) => {
          const t0 = reqStart.get(req.url());
          if (t0 != null) {
            timings.push({
              url: req.url(),
              ms: Date.now() - t0,
              type: req.resourceType(),
            });
          }
        });
      }
      // Token'ni login/auth XHR javobidan tutib olamiz.
      p.on("response", (res: import("playwright").Response) => {
        if (capturedToken) return;
        const u = res.url().toLowerCase();
        if (!/login|auth|token|signin|session|account/.test(u)) return;
        // challenges.cloudflare — token emas, o'tkazib yuboramiz.
        if (u.includes("challenges.cloudflare.com") || u.includes("/cdn-cgi/"))
          return;
        // Login API status'ini eslab qolamiz (user/login).
        if (/\/user\/login|\/login\b/.test(u)) {
          loginApiStatus = res.status();
        }
        res
          .text()
          .then((body) => {
            if (capturedToken || !body) return;
            const tok = extractTokenFromBody(body);
            if (tok) {
              capturedToken = tok;
              capturedTokenSource = `response:${res.url().slice(0, 80)}`;
            }
          })
          .catch(() => {});
      });

      // Warmup: avval asosiy sahifani ochamiz (region cookie/sessiya o'rnatadi
      // va Cloudflare'ni yengilroq sahifada o'taymiz). .env: BOOKING_WARMUP_URL.
      const warmupUrl = (process.env.BOOKING_WARMUP_URL || "").trim();
      // Warmup faqat BIRINCHI urinishda VA warmup URL login URL'dan FARQ qilsa.
      // Bir xil bo'lsa — login sahifasi IKKI MARTA yuklanardi (sof takror, ~5s
      // isrof). To'g'ridan-to'g'ri login navigatsiyasi Cloudflare'ni baribir
      // hal qiladi, shuning uchun bir xil URL'da warmup'ni o'tkazib yuboramiz.
      if (warmupUrl && warmupUrl !== url && attempt === 0) {
        step("Asosiy sahifa (warmup) ochilmoqda...");
        await p
          .goto(warmupUrl, { waitUntil: "commit", timeout: 45000 })
          .catch(() => {});
        await waitForCloudflareClear(p, step);
        // Cookie banner chiqsa — qabul qilamiz.
        if (await acceptCookies(p)) step("Cookie qabul qilindi");
        await humanPause(400, 800);
        step("Warmup tugadi, login sahifasiga o'tilmoqda...");
      }

      step("Login sahifasi ochilmoqda...");
      // Proxy tuneli uzilishi mumkin (ERR_TUNNEL_CONNECTION_FAILED) — buni
      // ham "blok" deb hisoblab yangi IP bilan qayta urinamiz.
      // TEZLIK: "domcontentloaded" — Angular bundle yuklanadi (email inputni
      // render qilish uchun shart), LEKIN "networkidle" (barcha so'rovlar
      // tinishini, ~10s) KUTMAYMIZ. Email maydoni pastda waitForSelector bilan.
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

      // Cloudflare interstitial ("Just a moment" / "Checking your browser") bo'lsa
      // — JS challenge avtomatik hal bo'lishini kutamiz (managed challenge).
      const cleared = gotoError ? false : await waitForCloudflareClear(p, step);
      const blocked = gotoError || base.statusCode === 403 || !cleared;
      lastGotoError = gotoError;
      if (!gotoError && base.statusCode != null) pageOpened = true;

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

    // PROXY/VPN O'LIK: sahifa biror marta ham ochilmadi va oxirgi urinish tunnel
    // uzilishi bilan tugadi — bekorga davom etmaymiz (email/captcha kutib o'tirmaymiz).
    if (!pageOpened && lastGotoError) {
      if (closeSession) await closeSession().catch(() => {});
      closeSession = null;
      base.pageError = pageErrors.slice(0, 10).join(" | ");
      return {
        ...base,
        note: "Proxy/VPN ulanmadi (ERR_TUNNEL_CONNECTION_FAILED) — internet/proxy balansini tekshiring",
      };
    }

    // 403 BLOK: barcha IP qayta urinishlaridan keyin ham sahifa HTTP 403 qaytardi
    // (VFS WAF: {"code":"403201"}). Bu IP darajasidagi blok EMAS — har urinishda
    // YANGI IP olindi, lekin hammasi 403 oldi => akkaunt/WAF darajasidagi cooldown
    // (429201 bilan bir xil sabab). U sahifada email/parol/captcha YO'Q, shuning
    // uchun bekorga 50s+ kutmasdan DARROV chiqamiz va brauzerni yopamiz.
    if (base.statusCode === 403) {
      step("BLOK: barcha IP 403 (akkaunt/WAF cooldown — 403201) ✗");
      base.finalUrl = page.url();
      base.note =
        "BLOKLANGAN (HTTP 403 / 403201). Har urinishda yangi IP olindi, lekin hammasi 403 — bu IP emas, akkaunt/WAF darajasidagi cooldown. ~1-2 soat kutilsin (bitta qurilma, VPN/cache tozalab); yangi IP yordam bermaydi.";
      pageErrors.push("403201: WAF/akkaunt blok (barcha IP 403)");
      await dumpDebug(page, "login-blocked-403").catch(() => {});
      if (closeSession) await closeSession().catch(() => {});
      closeSession = null;
      base.pageError = pageErrors.slice(0, 10).join(" | ");
      return base;
    }

    // Cookie banner login sahifasida ham chiqishi mumkin.
    if (await acceptCookies(page)) step("Cookie qabul qilindi");

    // EMAIL — Angular Material: ko'rinadigan input #email (yashirin #username emas).
    // MUHIM: VFS ko'p urinishdan keyin login'ni page-not-found'ga yo'naltirib
    // "Permission Issue (429201) — 2 soat cooldown" ko'rsatadi. U sahifada
    // email/parol/captcha YO'Q. Shuning uchun email maydoni YOKI blok sahifasi
    // — qaysi avval chiqsa, shuni kutamiz (oddiy loginda email ~1-2s da chiqadi,
    // qo'shimcha kechikish YO'Q; blokda esa 60s+ behuda qidirmasdan DARROV chiqamiz).
    const emailSel = '#email, input[formcontrolname="username"]';
    const appeared = await Promise.race([
      page
        .waitForSelector(emailSel, { state: "visible", timeout: 20000 })
        .then(() => "email" as const)
        .catch(() => null),
      page
        .waitForFunction(
          () => {
            const u = location.href.toLowerCase();
            const t = (
              document.body && document.body.innerText
                ? document.body.innerText
                : ""
            ).toLowerCase();
            return (
              u.indexOf("page-not-found") >= 0 ||
              t.indexOf("429201") >= 0 ||
              t.indexOf("permission issue") >= 0 ||
              t.indexOf("cooldown period") >= 0 ||
              t.indexOf("multiple requests within a short period") >= 0
            );
          },
          { timeout: 20000, polling: 500 },
        )
        .then(() => "blocked" as const)
        .catch(() => null),
    ]);

    // BLOK ANIQLANDI — 2 soat cooldown. Boshqa IP yordam bermaydi (akkaunt
    // darajasidagi blok), shuning uchun bu yerda davom etmaymiz.
    if (appeared === "blocked") {
      step("AKKAUNT/IP BLOKLANDI (429201 — Permission Issue) ✗");
      base.finalUrl = page.url();
      base.note =
        "AKKAUNT/IP VAQTINCHA BLOKLANGAN (429201 — Permission Issue). VFS: ~2 soat kutilsin (bitta qurilmada, VPN/cache tozalab). Boshqa IP yordam bermaydi — bu akkaunt darajasidagi blok.";
      pageErrors.push("429201: permission issue (2 soat cooldown)");
      await dumpDebug(page, "login-blocked-429201").catch(() => {});
      if (closeSession) await closeSession().catch(() => {});
      closeSession = null;
      base.pageError = pageErrors.slice(0, 10).join(" | ");
      return base;
    }

    // TEZLIK: Cloudflare Turnstile token sahifa yuklanishi bilan FONda yechila
    // boshlaydi. Shuning uchun captcha kutishni SHU YERDA (email/parol to'ldirish
    // bilan PARALLEL) ishga tushiramiz — token email/parol yozilayotganda tayyor
    // bo'ladi va keyin qo'shimcha kutish ~0 bo'ladi.
    // QISQA auto-pass oynasi: token shu vaqtda kelmasa interaktiv checkbox bor
    // demak — to'liq 30s kutmasdan darrov bosamiz (vaqt tejash). Klikdan keyin
    // to'liq BOOKING_CAPTCHA_TIMEOUT_MS kutiladi.
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
      // Debug: sahifa holatini saqlaymiz (nima ko'rinayotganini bilish uchun).
      await dumpDebug(page, "login-noemail").catch(() => {});
    }
    await humanPause();

    // PASSWORD — ko'rinadigan input #password (yashirin #password1 emas).
    const passSel = '#password, input[formcontrolname="password"]';
    const passEl = page.locator(passSel).first();
    if ((await passEl.count()) > 0) {
      const ok = await fillFieldReliably(page, passEl, password);
      base.filledPassword = ok;
      step(ok ? "Parol kiritildi" : "Parol to'liq kiritilmadi (chala)");
    } else {
      step("Parol maydoni topilmadi!");
    }
    await humanPause();

    // Cloudflare Turnstile — email/parol bilan PARALLEL boshlangan kutishни
    // shu yerda yig'amiz (ko'pincha token allaqachon tayyor — qo'shimcha kutish ~0).
    step("Cloudflare Turnstile tekshirilmoqda...");
    let captcha = await captchaPromise;
    base.captchaPresent = captcha.present;
    base.captchaSolved = captcha.solved;

    // Token avtomatik to'lmagan bo'lsa — checkbox ustiga inson kabi bosamiz
    // (tasodifiy nuqtalarda) va yana token to'lishini kutamiz.
    if (captcha.present && !captcha.solved) {
      step("Captcha o'zi o'tmadi — ustiga bosilmoqda...");
      // step uzatamiz — OS-klik ichidagi bosqichlar (qaysi klik, qachon token,
      // CF tekshiruvi) ko'rinadi. clickTurnstile endi to'liq token byudjetini
      // o'zi kutadi, shuning uchun pastdagi tasdiqlash QISQA (ikki marta 30s emas).
      const clicked = await clickTurnstile(page, step);
      if (clicked) {
        step("Captcha ustiga bosildi, token kutilmoqda...");
      }
      captcha = await waitForTurnstile(
        page,
        Number(process.env.BOOKING_CAPTCHA_CONFIRM_MS || "4000"),
      );
      base.captchaPresent = captcha.present;
      base.captchaSolved = captcha.solved;
    }

    // CAPTCHA RAD ETILDI / iframe chiqmadi (troubleshoot) — SAHIFANI QAYTA
    // YUKLAB toza Turnstile widget bilan qayta urinamiz (yangi brauzer EMAS).
    // VFS Turnstile ba'zan "Verification failed" beradi yoki iframe juda kech
    // render bo'ladi — reload ko'pincha yangi, tez ishlaydigan widget keltiradi.
    const captchaReloads = Math.max(
      0,
      Number(process.env.BOOKING_CAPTCHA_RELOAD_RETRIES || "2"),
    );
    for (
      let rl = 0;
      rl < captchaReloads && captcha.present && !captcha.solved;
      rl++
    ) {
      step(
        `Captcha o'tmadi — sahifa qayta yuklanmoqda (${rl + 1}/${captchaReloads})...`,
      );
      await page
        .goto(url, { waitUntil: "domcontentloaded", timeout: 45000 })
        .catch(() => {});
      await waitForCloudflareClear(page, step).catch(() => {});
      if (await acceptCookies(page)) step("Cookie qabul qilindi");

      // Yangi sahifada email/parolni qayta to'ldiramiz (reload tozalaydi).
      const reCaptcha = waitForTurnstile(
        page,
        Number(process.env.BOOKING_CAPTCHA_AUTOPASS_MS || "6000"),
      );
      await page
        .waitForSelector(emailSel, { state: "visible", timeout: 20000 })
        .catch(() => {});
      const reEmail = page.locator(emailSel).first();
      if ((await reEmail.count()) > 0) {
        base.filledEmail = await fillFieldReliably(page, reEmail, email);
      }
      await humanPause();
      const rePass = page.locator(passSel).first();
      if ((await rePass.count()) > 0) {
        base.filledPassword = await fillFieldReliably(page, rePass, password);
      }
      await humanPause();
      step("Email/parol qayta kiritildi");

      captcha = await reCaptcha;
      if (captcha.present && !captcha.solved) {
        const clicked = await clickTurnstile(page, step);
        if (clicked) step("Captcha ustiga bosildi, token kutilmoqda...");
        captcha = await waitForTurnstile(
          page,
          Number(process.env.BOOKING_CAPTCHA_CONFIRM_MS || "4000"),
        );
      }
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

    // Cookie banneri Sign In tugmasini to'sib qo'yishi mumkin — yana yopamiz.
    if (await acceptCookies(page)) step("Cookie qabul qilindi");

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

    // Login natijasini kutamiz: dashboard'ga o'tishni (URL o'zgarishi) kutamiz.
    step("Natija kutilmoqda...");
    await page
      .waitForURL((u) => !/\/login(\b|\/|$)/i.test(u.toString()), {
        timeout: 20000,
      })
      .catch(() => {});
    // URL o'zgargach qisqa kutish — dashboard DOM/token o'rnashishi uchun
    // (networkidle butun sahifa yuklanishini kutadi, bizga shart emas).
    await page.waitForTimeout(350).catch(() => {});

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
    const notFound = /page-not-found|not-found|404/.test(
      base.finalUrl.toLowerCase(),
    );
    const hasError = /invalid|incorrect|wrong|failed|error|noto'g'ri|xato/.test(
      bodyText,
    );
    // AKKAUNT CHEKLOVI (429001): VFS akkauntni "unusual activity" deb vaqtincha
    // bloklaydi (oddiy IP rate-limit EMAS — bu akkaunt darajasida). Sahifada
    // "Access Restricted for User ID (429001)" ko'rinadi. Bu akkaunt biroz
    // dam olishi kerak — boshqa IP/proxy yordam bermaydi.
    const accountRestricted =
      /429001|429201|access restricted for user|unusual activity|temporarily restricted|permission issue|cooldown period|multiple requests within a short period/.test(
        bodyText,
      );
    // Login API (user/login) 4xx/429 qaytarsa — muvaffaqiyatsiz (rate-limit yoki
    // noto'g'ri parol). 429 = juda ko'p urinish, biroz kutish kerak.
    const apiBad = loginApiStatus != null && loginApiStatus >= 400;
    base.ok =
      base.submitted &&
      !hasError &&
      !stillOnLogin &&
      !notFound &&
      !apiBad &&
      !accountRestricted;

    base.note = base.ok
      ? "Login muvaffaqiyatli (taxminiy)"
      : accountRestricted
        ? "AKKAUNT VAQTINCHA BLOKLANGAN (429001 — unusual activity). Bu akkauntni biroz tindiring; boshqa IP yordam bermaydi."
        : apiBad
          ? loginApiStatus === 429
            ? "Login API 429 (juda ko'p urinish — biroz kuting)"
            : `Login API xatosi (HTTP ${loginApiStatus})`
          : hasError
            ? "Login xato xabari aniqlandi"
            : stillOnLogin
              ? "Hali login sahifasida (parol/captcha tekshiring)"
              : notFound
                ? "Sahifa topilmadi (login API javobi xato bo'lishi mumkin)"
                : "Login holati noaniq";

    // Login muvaffaqiyatli bo'lsa — auth token'ni (JWT/session) o'qiymiz.
    if (base.ok) {
      // 1-navbat: login XHR javobidan tutilgan token (eng ishonchli).
      if (capturedToken) {
        base.token = capturedToken;
        base.tokenSource = capturedTokenSource;
        step(`Token olindi ✓ (${capturedTokenSource})`);
      } else {
        // 2-navbat: localStorage/sessionStorage/cookie.
        const tok = await readAuthToken(page);
        if (tok) {
          base.token = tok.token;
          base.tokenSource = tok.source;
          step(`Token olindi ✓ (${tok.source})`);
        } else {
          step("Token topilmadi (XHR/localStorage/cookie da yo'q)");
          // DEBUG: barcha storage kalitlari + cookie nomlarini saqlaymiz.
          if (
            (process.env.BOOKING_DUMP_STORAGE || "").toLowerCase() === "true"
          ) {
            await dumpStorage(page).catch(() => {});
          }
        }
      }
    }

    // Login bo'lmasa — sahifa holatini saqlaymiz (VFS xato xabarini ko'rish uchun).
    if (!base.ok) {
      await dumpDebug(page, "login-result").catch(() => {});
    }

    // DIAGNOSTIKA: eng sekin so'rovlar (qaysi joy optimizatsiya kerakligini ko'rsatadi).
    if (timingOn && timings.length) {
      const top = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 15);
      const total = timings.reduce((s, t) => s + t.ms, 0);
      step(
        `Jami ${timings.length} so'rov, eng sekin ${top.length} ta (qfm: ${Math.round(total / timings.length)}ms):`,
      );
      for (const t of top) {
        const host = (() => {
          try {
            return new URL(t.url).host;
          } catch {
            return t.url.slice(0, 40);
          }
        })();
        const tail = t.url.split("/").pop()?.slice(0, 32) || "";
        step(
          `  ${String(t.ms).padStart(6)}ms  ${t.type.padEnd(8)} ${host} ${tail}`,
        );
      }
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
