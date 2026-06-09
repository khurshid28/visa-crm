// ====================================================================
//  AVTOMATLASHTIRISH — public API (barrel)
// ====================================================================
//  Eski `import { ... } from "@/lib/automation"` chaqiruvlari shu yerga keladi.
//  Kod modullarga bo'lingan:
//   - types.ts      — umumiy tiplar
//   - human.ts      — inson kabi kutish (rand, humanPause)
//   - browser.ts    — brauzer/context/proxy/CDP/profil
//   - page-utils.ts — sahifa yordamchilari (forma, cookie, token, IP)
//   - turnstile.ts  — Cloudflare Turnstile / challenge yechuvchi
//   - login.ts      — loginToBooking
//   - register.ts   — registerToBooking (yangi akkaunt yaratish)
//   - booking.ts    — runBooking (register/order)
//   - activation.ts — runActivation
//   - slot.ts       — checkSlotOpen
//   - calendar.ts   — detectCalendar (kalendar bor/yo'q + bo'sh kunlar)
// ====================================================================

export type {
  AutomationApplicant,
  AutomationResult,
  ActivationResult,
  SlotCheckResult,
  CalendarDetectResult,
  LoginResult,
  RegisterResult,
} from "./types";

export { sanitizeProfileKey } from "./browser";
export { loginToBooking } from "./login";
export { registerToBooking } from "./register";
export { runBooking } from "./booking";
export { runActivation } from "./activation";
export { checkSlotOpen } from "./slot";
export { detectCalendar } from "./calendar";

// Flow capture — slot ochilgandan keyingi noma'lum sahifalarni qo'lda
// o'tib yozib olish (skrinshot + HTML + network + PDF + manifest). Lokal tahlil.
export { runFlowCapture } from "./flow-capture";
export type {
  FlowCaptureOptions,
  FlowCaptureResult,
  CapturedSnapshot,
  CapturedNet,
  CapturedDownload,
} from "./flow-capture";

// Cloudflare Turnstile / challenge yechuvchi (qayta ishlatiladigan).
export {
  solveTurnstile,
  waitForTurnstile,
  waitForCloudflareClear,
  clickTurnstile,
  osClickTurnstile,
  hasTurnstileToken,
} from "./turnstile";
