// Har bir arizachi uchun tizim email manzilini yaratadi.
// Format: {ism}.{familiya}{id}@DOMEN  (faqat lotin harf/raqam)
// Masalan: sadriddin.orziev123@uzbekviza.uz
// Domen .env dan keladi. Klientda ham ishlashi uchun NEXT_PUBLIC_ ham o'qiymiz.

export const EMAIL_DOMAIN =
  process.env.EMAIL_DOMAIN?.trim() ||
  process.env.NEXT_PUBLIC_EMAIL_DOMAIN?.trim() ||
  "uzbekviza.uz";

function slug(part: string): string {
  return part
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

// id berilsa ism qismining oxiriga to'g'ridan-to'g'ri (nuqtasiz) qo'shiladi.
export function buildEmail(name: string, surname: string, id?: number): string {
  const firstName = slug(String(name).split(/\s+/)[0] || "");
  const last = slug(surname);
  const base = [firstName, last].filter(Boolean).join(".") || "user";
  const suffix = id != null ? `${id}` : "";
  return `${base}${suffix}@${EMAIL_DOMAIN}`;
}

// Har bir arizachi uchun tizim (VFS/Google akkaunt) parolini deterministik
// yaratadi. Email kabi — DBda saqlanmaydi, har safar bir xil chiqadi.
//
// Google "juda oddiy / keng tarqalgan" parollarni rad etadi. Shuning uchun:
//   - uzunligi >= 12 belgi
//   - katta + kichik harf + raqam + maxsus belgi
//   - oddiy lug'at so'zi bo'lmasligi uchun ichiga hashdan kelgan belgilar
// Format namunasi: "Sadriddin#5025Kp9!" kabi.
export function buildPassword(
  name: string,
  surname: string,
  passportNumber?: string,
): string {
  const first = slug(String(name).split(/\s+/)[0] || "");
  const cap = first ? first[0].toUpperCase() + first.slice(1) : "User";
  const base = cap.length >= 4 ? cap : (cap + "viza").slice(0, 4);

  const digits = String(passportNumber || "").replace(/\D/g, "");
  // Passport raqami oxirgi 4 raqami; bo'lmasa familiyadan barqaror son.
  let tail = digits.slice(-4);
  if (tail.length < 4) {
    let h = 0;
    const s = slug(surname) || "viza";
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 10000;
    tail = String(h).padStart(4, "0");
  }

  // Barqaror hash (ism+familiya+passport) — qo'shimcha entropiya uchun.
  const seedStr = `${slug(name)}|${slug(surname)}|${digits}`;
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash = hash >>> 0;

  // Hashdan bir nechta harf (katta + kichik aralash) hosil qilamiz —
  // lug'at so'ziga o'xshamasligi va kuchli bo'lishi uchun.
  // MUHIM: belgisiz siljitish (>>>) ishlatamiz — oddiy (>>) katta hash'larni
  // manfiy qiladi va indeks/charCode buziladi (undefined, noto'g'ri belgilar).
  const up1 = String.fromCharCode(65 + (hash % 26)); // A-Z
  const up2 = String.fromCharCode(65 + ((hash >>> 7) % 26)); // A-Z
  const lo1 = String.fromCharCode(97 + ((hash >>> 5) % 26)); // a-z
  const lo2 = String.fromCharCode(97 + ((hash >>> 11) % 26)); // a-z
  const extraDigit = String((hash >>> 10) % 10); // 0-9

  // Maxsus belgilar (Google qabul qiladiganlar) — kengroq to'plam.
  const symbols = "!@#$%^&*-_=+?";
  const sym1 = symbols[hash % symbols.length];
  const sym2 = symbols[(hash >>> 13) % symbols.length];
  const sym3 = symbols[(hash >>> 17) % symbols.length];

  // Yig'amiz: Ism + belgi + 4 raqam + harflar(katta/kichik) + raqam + belgilar.
  return `${base}${sym1}${tail}${up1}${lo1}${sym2}${up2}${lo2}${extraDigit}${sym3}`;
}
