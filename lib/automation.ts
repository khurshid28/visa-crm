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
  url: string;
};

type Stage = "register" | "order";

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

function urlForStage(stage: Stage): string | null {
  const u =
    stage === "order"
      ? process.env.BOOKING_ORDER_URL
      : process.env.BOOKING_REGISTER_URL;
  return u && u.trim() ? u.trim() : null;
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

  let browser: import("playwright").Browser | null = null;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: envHeadless() });
    const context = await browser.newContext();
    const page = await context.newPage();
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

    await browser.close();
    browser = null;

    const hasClosed = closedMarks.some((m) => body.includes(m));
    const hasOpen = openMarks.some((m) => body.includes(m));
    // Yopiq belgisi ustun: avval yopiqlikni tekshiramiz.
    if (hasClosed) {
      return { open: false, note: "Saytda slot yopiq", url };
    }
    if (hasOpen) {
      return { open: true, note: "Saytda slot ochiq", url };
    }
    return {
      open: false,
      note: "Slot holati aniqlanmadi (belgi topilmadi)",
      url,
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return {
      open: false,
      note: `Slot tekshirish xatosi: ${msg.slice(0, 200)}`,
      url,
    };
  }
}

/** Sahifa matnidan tasdiqlash / appointment raqamini ajratib oladi. */
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
 * Bitta arizachi uchun bitta bosqichni bajaradi.
 * Playwright dinamik import qilinadi (build/serverless'ni buzmaslik uchun).
 */
export async function runBooking(
  stage: Stage,
  applicant: AutomationApplicant,
): Promise<AutomationResult> {
  const url = urlForStage(stage);
  if (!url) {
    return {
      ok: false,
      ref: null,
      note: `URL sozlanmagan (.env: BOOKING_${stage === "order" ? "ORDER" : "REGISTER"}_URL)`,
      filled: [],
      url: "",
    };
  }

  let browser: import("playwright").Browser | null = null;
  const filled: string[] = [];

  try {
    // Dinamik import — modul faqat ishlash vaqtida yuklanadi.
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: envHeadless() });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

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
    }

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

    await browser.close();
    browser = null;

    const note =
      `${stage === "order" ? "Buyurtma" : "Ro'yxat"}: ` +
      `${filled.length} maydon to'ldirildi` +
      (submitted ? ", forma yuborildi" : ", submit tugmasi topilmadi") +
      (ref ? `, ref: ${ref}` : "");

    return { ok: filled.length > 0 || submitted, ref, note, filled, url };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      ref: null,
      note: `Avtomatlashtirish xatosi: ${msg.slice(0, 200)}`,
      filled,
      url,
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

      // Oddiy matn inputi / textarea.
      try {
        await el.fill(value, { timeout: 4000 });
        return true;
      } catch {
        // ba'zi inputlar fill'ni qabul qilmaydi — type bilan urinib ko'ramiz.
        await el.click({ timeout: 2000 }).catch(() => {});
        await el.type(value, { timeout: 4000 }).catch(() => {});
        return true;
      }
    }
  } catch {
    // jim — natijaga ta'sir qilmaydi.
  }
  return false;
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
