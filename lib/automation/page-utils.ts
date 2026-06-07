// ====================================================================
//  SAHIFA YORDAMCHILARI — forma to'ldirish, cookie, Turnstile, token, IP
// ====================================================================
//  Bu modul Playwright Page bilan ishlaydigan umumiy yordamchilar:
//   - forma: fillSmartField, fillFieldReliably, clickSubmit
//   - cookie/captcha: acceptCookies, clickTurnstile, waitForCloudflareClear,
//     waitForTurnstile
//   - token/IP: readExitIp, readAuthToken, extractTokenFromBody
//   - debug: dumpDebug, dumpStorage, extractRef
// ====================================================================

import * as fs from "fs";
import * as path from "path";
import { proxyIpEchoUrl } from "../proxy";
import { rand, humanPause } from "./human";

/**
 * Debug: sahifa skrinshot + HTML + matn'ni uploads/debug ga saqlaydi.
 * Email/forma topilmaganda nima ko'rinayotganini bilish uchun.
 */
export async function dumpDebug(
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

/** Sahifa matnidan tasdiqlash/appointment raqamini ajratadi. */
export function extractRef(text: string): string | null {
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
export async function readExitIp(
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
 * Login muvaffaqiyatli bo'lgach auth token'ni (JWT/session) o'qiydi.
 * Token kalit nomi har xil bo'lishi mumkin (accessToken, token, id_token...),
 * shuning uchun JWT shaklidagi (eyJ... 3 qism) yoki token-ga o'xshash kalitlarni
 * qidiramiz. Topilsa {token, source} qaytaradi.
 */
export async function readAuthToken(
  page: import("playwright").Page,
): Promise<{ token: string; source: string } | null> {
  try {
    const found = await page.evaluate(() => {
      const isJwt = (v: string) =>
        typeof v === "string" && /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v.trim());
      const keyLooks = (k: string) =>
        /token|jwt|auth|session|bearer|access|id_token/i.test(k);
      const scan = (store: Storage, label: string) => {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (!k) continue;
          const raw = store.getItem(k) || "";
          // To'g'ridan-to'g'ri JWT.
          if (isJwt(raw)) return { token: raw, source: `${label}:${k}` };
          // JSON ichida token bo'lishi mumkin.
          try {
            const obj = JSON.parse(raw);
            const stack: unknown[] = [obj];
            while (stack.length) {
              const cur = stack.pop();
              if (cur && typeof cur === "object") {
                for (const [kk, vv] of Object.entries(
                  cur as Record<string, unknown>,
                )) {
                  if (typeof vv === "string" && (isJwt(vv) || keyLooks(kk))) {
                    if (isJwt(vv) || vv.length > 20)
                      return { token: vv, source: `${label}:${k}.${kk}` };
                  } else if (vv && typeof vv === "object") {
                    stack.push(vv);
                  }
                }
              }
            }
          } catch {
            /* JSON emas */
          }
          // Kalit nomi token-ga o'xshasa va qiymat uzun bo'lsa.
          if (keyLooks(k) && raw.length > 20)
            return { token: raw, source: `${label}:${k}` };
        }
        return null;
      };
      return (
        scan(window.localStorage, "localStorage") ||
        scan(window.sessionStorage, "sessionStorage")
      );
    });
    if (found && found.token) {
      return { token: found.token.slice(0, 4000), source: found.source };
    }
  } catch {
    /* ignore */
  }
  // 2) Cookie'lardan qidiramiz.
  try {
    const cookies = await page.context().cookies();
    for (const ck of cookies) {
      const v = ck.value || "";
      if (
        /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v) ||
        (/token|jwt|auth|session|access/i.test(ck.name) && v.length > 20)
      ) {
        return { token: v.slice(0, 4000), source: `cookie:${ck.name}` };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Login XHR javobi (JSON yoki matn) ichidan token'ni ajratadi. JWT (eyJ...)
 * yoki token-ga o'xshash kalitlarni (accessToken/token/id_token/...) qidiradi.
 */
export function extractTokenFromBody(body: string): string | null {
  const t = (body || "").trim();
  if (!t) return null;
  const isJwt = (v: unknown): v is string =>
    typeof v === "string" && /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v.trim());
  const keyLooks = (k: string) =>
    /token|jwt|bearer|access|id_token|refresh/i.test(k);
  // Avval JSON sifatida.
  try {
    const obj = JSON.parse(t);
    const stack: unknown[] = [obj];
    while (stack.length) {
      const cur = stack.pop();
      if (cur && typeof cur === "object") {
        for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
          if (isJwt(v)) return v.slice(0, 4000);
          if (typeof v === "string" && keyLooks(k) && v.length > 20)
            return v.slice(0, 4000);
          if (v && typeof v === "object") stack.push(v);
        }
      }
    }
  } catch {
    /* JSON emas */
  }
  // Xom matnda JWT bo'lsa.
  const m = t.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
  return m ? m[0].slice(0, 4000) : null;
}

/**
 * DEBUG: barcha localStorage/sessionStorage kalitlari + cookie nomlarini
 * uploads/debug ga saqlaydi (token qayerdaligini topish uchun).
 */
export async function dumpStorage(
  page: import("playwright").Page,
): Promise<void> {
  try {
    const data = await page.evaluate(() => {
      const dump = (store: Storage) => {
        const out: Record<string, string> = {};
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (k) out[k] = (store.getItem(k) || "").slice(0, 300);
        }
        return out;
      };
      return {
        localStorage: dump(window.localStorage),
        sessionStorage: dump(window.sessionStorage),
      };
    });
    const cookies = await page.context().cookies();
    const dir = path.join(process.cwd(), "uploads", "debug");
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(
      path.join(dir, `storage-${ts}.json`),
      JSON.stringify(
        {
          url: page.url(),
          ...data,
          cookies: cookies.map((c) => ({
            name: c.name,
            valueLen: (c.value || "").length,
            value: (c.value || "").slice(0, 120),
          })),
        },
        null,
        2,
      ),
      "utf8",
    );
    // eslint-disable-next-line no-console
    console.log(`[debug] storage saqlandi: storage-${ts}.json`);
  } catch {
    /* ignore */
  }
}

/**
 * Sahifadagi input/select/textarea ni kalit so'zlar bo'yicha topib to'ldiradi.
 * Element atributlari (name/id/placeholder/aria-label) + bog'langan <label>
 * matni tekshiriladi. Birinchi mos kelgan bo'sh element to'ldiriladi.
 */
export async function fillSmartField(
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
 * Maydonni ISHONCHLI to'ldiradi: bosadi, tozalaydi, inson kabi yozadi va
 * qiymatni TEKSHIRADI. Chala bo'lsa (harf tushib qolsa) 3 martagacha qayta
 * yozadi. Oxirgi chora — fill() bilan to'liq qo'yadi. Email/parol uchun.
 */
export async function fillFieldReliably(
  page: import("playwright").Page,
  el: import("playwright").Locator,
  value: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await el.click({ timeout: 5000 }).catch(() => {});
      await el.fill("", { timeout: 3000 }).catch(() => {});
      await page.keyboard.press("Control+A").catch(() => {});
      await page.keyboard.press("Delete").catch(() => {});
      await el.type(value, { delay: rand(60, 140), timeout: 15000 });
      await humanPause(120, 280);
      const current = await el.inputValue().catch(() => "");
      if (current === value) return true;
    } catch {
      /* keyingi urinish */
    }
  }
  // Oxirgi chora: fill() bilan to'liq qo'yamiz (to'liq, lekin inson kabi emas).
  try {
    await el.fill(value, { timeout: 5000 });
    const current = await el.inputValue().catch(() => "");
    return current === value;
  } catch {
    return false;
  }
}

/**
 * Cookie banner (OneTrust va boshqalar) chiqsa — "Accept all" tugmasini bosadi.
 * Hech qachon throw qilmaydi. Bosilsa true qaytaradi.
 */
export async function acceptCookies(
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
export async function clickTurnstile(
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
export async function waitForCloudflareClear(
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
 * Widget kech render bo'lishi mumkin (Angular SPA) — shu sababli avval
 * widget PAYDO BO'LISHINI biroz kutamiz, keyin token kutamiz.
 */
export async function waitForTurnstile(
  page: import("playwright").Page,
): Promise<{ present: boolean; solved: boolean }> {
  const timeoutMs = Number(process.env.BOOKING_CAPTCHA_TIMEOUT_MS || "30000");
  // Widget paydo bo'lishini kutish vaqti (sahifa to'liq yuklanishini kutmaymiz,
  // shuning uchun Turnstile kech render bo'lishi mumkin).
  const appearMs = Number(process.env.BOOKING_CAPTCHA_APPEAR_MS || "12000");
  try {
    // Widget paydo bo'lishini kutamiz (iframe / hidden input / .cf-turnstile).
    await page
      .waitForFunction(
        () => {
          const hasInput = !!document.querySelector(
            'input[name="cf-turnstile-response"], [id^="cf-chl-widget"]',
          );
          const hasWidget = !!document.querySelector(
            '.cf-turnstile, iframe[src*="challenges.cloudflare.com"]',
          );
          return hasInput || hasWidget;
        },
        { timeout: appearMs },
      )
      .catch(() => {});

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
export async function clickSubmit(
  page: import("playwright").Page,
): Promise<boolean> {
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
