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
  clickTurnstile,
  waitForCloudflareClear,
  waitForTurnstile,
  readExitIp,
  readAuthToken,
  extractTokenFromBody,
  fillFieldReliably,
  dumpDebug,
  dumpStorage,
} from "./page-utils";

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
    const proxyOn = isProxyEnabled();

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
        { profileKey, ipAttempt: attempt },
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
      // Warmup faqat BIRINCHI urinishda (retry'larda takrorlash vaqt/trafik isrofi).
      if (warmupUrl && attempt === 0) {
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

    // Cookie banner login sahifasida ham chiqishi mumkin.
    if (await acceptCookies(page)) step("Cookie qabul qilindi");

    // EMAIL — Angular Material: ko'rinadigan input #email (yashirin #username emas).
    const emailSel = '#email, input[formcontrolname="username"]';
    await page
      .waitForSelector(emailSel, { state: "visible", timeout: 20000 })
      .catch(() => {});

    // TEZLIK: Cloudflare Turnstile token sahifa yuklanishi bilan FONda yechila
    // boshlaydi. Shuning uchun captcha kutishni SHU YERDA (email/parol to'ldirish
    // bilan PARALLEL) ishga tushiramiz — token email/parol yozilayotganda tayyor
    // bo'ladi va keyin qo'shimcha kutish ~0 bo'ladi.
    const captchaPromise = waitForTurnstile(page);

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
    await page.waitForTimeout(800).catch(() => {});

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
      /429001|access restricted for user|unusual activity|temporarily restricted/.test(
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
