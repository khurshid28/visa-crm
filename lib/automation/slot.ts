// ====================================================================
//  SLOT — saytda vaqt oynasi ochiq-yopiqligini tekshirish (monitoring)
// ====================================================================
//  URL .env dan: BOOKING_SLOT_URL. Ochiqlik belgilari .env dan moslashtiriladi:
//   BOOKING_SLOT_OPEN_TEXT   — sahifada shu matn bo'lsa = ochiq
//   BOOKING_SLOT_CLOSED_TEXT — sahifada shu matn bo'lsa = yopiq
//  Har 5 soniyada ishlaydi — har safar YANGI (rotating) IP ishlatadi.
// ====================================================================

import type { SlotCheckResult } from "./types";
import { openBrowserContext } from "./browser";

/**
 * Saytda slot (vaqt oynasi) ochiq-yopiqligini Playwright bilan tekshiradi.
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
