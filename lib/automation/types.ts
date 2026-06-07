// ====================================================================
//  AVTOMATLASHTIRISH — umumiy tiplar (login / register / order / slot)
// ====================================================================

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

export type Stage = "register" | "login" | "order";

export type SlotCheckResult = {
  open: boolean;
  note: string;
  url: string;
};

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
  token: string | null; // auth token (JWT/session) — booking bosqichi uchun
  tokenSource: string | null; // token qayerdan olindi (localStorage/cookie kaliti)
};
