// ====================================================================
//  IDENTITY GENERATOR — to'liq register uchun email + parol + telefon
// ====================================================================
//  VFS register'ni "ful" (to'liq) sinash/ishlatish uchun har safar YANGI
//  shaxs ma'lumotlarini generatsiya qiladi:
//    - email  : ism.familiya{id}@uzbekvisa.uz  (catch-all domen — aktivatsiya
//               xati info@uzbekvisa.uz qutiga tushadi, listener ushlaydi)
//    - parol  : kuchli tasodifiy (katta/kichik harf + raqam + maxsus belgi)
//    - telefon: haqiqiy O'zbekiston mobil raqami (operator prefiks + 7 raqam)
//
//  buildEmail() bilan bir xil domen (.env EMAIL_DOMAIN) ishlatiladi — shuning
//  uchun generatsiya qilingan email catch-all orqali kuzatiladi.
// ====================================================================

import { buildEmail, EMAIL_DOMAIN } from "./email";

// Tasodifiy tanlash yordamchisi.
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Ko'p uchraydigan o'zbek ism/familiyalari (lotin) — email realistik ko'rinishi
// uchun. buildEmail() ularni kichik harfga o'tkazib, nuqta bilan birlashtiradi.
const FIRST_NAMES = [
  "Sardor",
  "Jasur",
  "Bekzod",
  "Aziz",
  "Dilshod",
  "Otabek",
  "Shoxrux",
  "Bobur",
  "Akmal",
  "Ulugbek",
  "Sherzod",
  "Javohir",
  "Doston",
  "Husan",
  "Sanjar",
  "Farrux",
  "Diyor",
  "Islom",
  "Nodir",
  "Temur",
  "Aziza",
  "Nigora",
  "Malika",
  "Gulnora",
  "Dilnoza",
  "Kamola",
  "Shahnoza",
  "Madina",
] as const;

const LAST_NAMES = [
  "Karimov",
  "Rashidov",
  "Yusupov",
  "Tursunov",
  "Aliyev",
  "Ergashev",
  "Saidov",
  "Ibragimov",
  "Nazarov",
  "Umarov",
  "Qodirov",
  "Mirzayev",
  "Yuldashev",
  "Rahimov",
  "Sobirov",
  "Hasanov",
  "Komilov",
  "Abdullayev",
  "Orziev",
  "Tashpulatov",
] as const;

// O'zbekiston mobil operator prefiks(lar)i (2 raqam): Beeline 90/91,
// Ucell 93/94, UMS/Mobiuz 88/95/97/98, Uzmobile 99/33.
const PHONE_PREFIXES = [
  "90",
  "91",
  "93",
  "94",
  "95",
  "97",
  "98",
  "99",
  "88",
  "33",
] as const;

/**
 * Haqiqiy O'zbekiston mobil raqamini generatsiya qiladi (dial codesiz, lokal).
 * Format: <prefiks 2 raqam><7 tasodifiy raqam> = 9 raqam. Masalan "901234567".
 * register formasiga aynan shu lokal qism kiritiladi (dial code alohida +998).
 */
export function generatePhone(): string {
  const prefix = pick(PHONE_PREFIXES);
  let rest = "";
  for (let i = 0; i < 7; i++) rest += Math.floor(Math.random() * 10);
  return prefix + rest;
}

/**
 * Kuchli tasodifiy parol generatsiya qiladi — VFS talabiga AYNAN mos:
 *   "min 8, max 15 belgi; kamida 1 katta harf, 1 kichik harf, 1 raqam va
 *    1 maxsus belgi ($ @ # ! % * ?)".
 * Tuzilishi: 1 katta + 6 kichik + 3 raqam + 1 maxsus = 11 belgi (8..15 oralig'ida).
 * MUHIM: maxsus belgi FAQAT VFS ruxsat etgan to'plamdan ($@#!%*?). Avval "&"
 * ishlatilardi — u ruxsat etilmagan, shu sabab parol rad etilib, Register
 * tugmasi NOFAOL qolardi. Adashtiruvchi belgilar (I/l/O/0/1) chiqarilgan.
 * Masalan "Xmkprtq284#".
 */
export function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // I/O yo'q
  const lower = "abcdefghijkmnpqrstuvwxyz"; // l yo'q
  const digit = "23456789"; // 0/1 yo'q
  const symbol = "$@#!%*?"; // VFS ruxsat etgan maxsus belgilar (& YO'Q!)
  const pickCh = (s: string) => s[Math.floor(Math.random() * s.length)];
  let body = "";
  for (let i = 0; i < 6; i++) body += pickCh(lower);
  let nums = "";
  for (let i = 0; i < 3; i++) nums += pickCh(digit);
  return pickCh(upper) + body + nums + pickCh(symbol);
}

export type GeneratedIdentity = {
  name: string; // ism (masalan "Sardor")
  surname: string; // familiya (masalan "Karimov")
  email: string; // ism.familiya{id}@uzbekvisa.uz (catch-all)
  password: string; // kuchli tasodifiy parol
  phone: string; // lokal mobil raqam (9 raqam, masalan "901234567")
  fullPhone: string; // to'liq raqam (+998901234567)
};

/**
 * To'liq register uchun YANGI shaxs ma'lumotlarini generatsiya qiladi:
 * tasodifiy ism/familiya + noyob id + catch-all email + parol + telefon.
 * Email .env EMAIL_DOMAIN (uzbekvisa.uz) domenida — aktivatsiya xati
 * info@uzbekvisa.uz qutiga tushib, mail-listener uni ushlaydi.
 */
export function generateIdentity(): GeneratedIdentity {
  const name = pick(FIRST_NAMES);
  const surname = pick(LAST_NAMES);
  // Noyob 5 xonali id — email local-part'ini takrorlanmas qiladi (listener
  // local-part bo'yicha mos userni topadi, to'qnashuv bo'lmaydi).
  const id = Math.floor(Math.random() * 90000) + 10000;
  const email = buildEmail(name, surname, id);
  const phone = generatePhone();
  return {
    name,
    surname,
    email,
    password: generatePassword(),
    phone,
    fullPhone: `+998${phone}`,
  };
}

// Generatsiya qilingan email qaysi domenda ekanini bilish kerak bo'lsa.
export { EMAIL_DOMAIN };
