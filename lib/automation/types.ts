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

// Kalendar (appointment) sahifasini ochib, bo'sh kun bor-yo'qligini aniqlash
// natijasi. detectCalendar() qaytaradi — slot monitoring shu asosida ishlaydi.
export type CalendarDetectResult = {
  open: boolean; // bo'sh kun(lar) topildi => order navbatini ishga tushirsa bo'ladi
  loggedIn: boolean; // tekshiruv logindan o'tib amalga oshdimi
  calendarFound: boolean; // sahifada kalendar/slot vidjeti bormi
  availableDates: string[]; // topilgan bo'sh kunlar (matn, best-effort)
  note: string; // qisqa izoh (lastMessage uchun)
  url: string; // tekshirilgan sahifa URL
  finalUrl: string; // tekshiruv oxiridagi URL (redirect bo'lsa)
  screenshotPath: string | null; // saqlangan skrinshot yo'li (debug/proof)
  exitIp: string | null; // proxy orqali chiqqan tashqi IP
  statusCode: number | null; // sahifa HTTP status kodi
  proxyServer: string | null; // ulangan proxy gateway (host:port) yoki null
  proxyCountry: string | null; // proxy davlati (uz/kz)
  durationMs: number; // tekshiruv davomiyligi (ms)
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

// VFS register sahifasi (BOOKING_REGISTER_URL) — yangi akkaunt yaratish.
// Forma: email, password, confirm password, dial code (+998) + mobile number,
// 3 ta checkbox (privacy/data-transfer/terms), Cloudflare Turnstile, Register.
// registerToBooking() qaytaradi. Hozircha Register tugmasini BOSMAYDI (tayyorlaydi).
export type RegisterResult = {
  ok: boolean; // forma to'liq to'ldirildi va Register bosishga tayyor bo'ldimi
  note: string;
  url: string; // register URL
  finalUrl: string; // urinish oxiridagi URL
  captchaPresent: boolean;
  captchaSolved: boolean;
  filledEmail: boolean;
  filledPassword: boolean;
  filledConfirm: boolean; // confirm password to'ldi
  dialCodeSelected: boolean; // dial code (+998) tanlandi
  filledPhone: boolean; // mobile number to'ldi
  checkboxesTotal: number; // sahifada topilgan checkbox soni
  checkboxesChecked: number; // belgilangan checkbox soni
  registerButtonFound: boolean; // Register tugmasi topildimi
  registerButtonEnabled: boolean; // Register tugmasi faol (bosishga tayyor)mi
  submitted: boolean; // Register bosildimi (default: yo'q — opts.submit=true bo'lsa)
  email: string; // ishlatilgan email
  password: string; // ishlatilgan parol (test uchun — qaysi parol qo'yilganini bilish)
  phone: string; // ishlatilgan to'liq telefon (dial code + number)
  exitIp: string | null;
  statusCode: number | null;
  pageError: string | null;
};
