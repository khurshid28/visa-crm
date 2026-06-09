// Har bir arizachi uchun tizim email manzilini yaratadi.
// Format: {ism}.{familiya}{id}@DOMEN  (faqat lotin harf/raqam)
// Masalan: sadriddin.orziev123@uzbekvisa.uz
// Domen .env dan keladi. Klientda ham ishlashi uchun NEXT_PUBLIC_ ham o'qiymiz.

export const EMAIL_DOMAIN =
  process.env.EMAIL_DOMAIN?.trim() ||
  process.env.NEXT_PUBLIC_EMAIL_DOMAIN?.trim() ||
  "uzbekvisa.uz";

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

// Har bir arizachi uchun tizim (VFS) parolini deterministik yaratadi.
// DBda saqlanadi (applicant.generatedPassword) — har safar bir xil chiqishi shart.
//
// VFS talabi AYNAN: "min 8, max 15 belgi; kamida 1 katta harf, 1 kichik harf,
// 1 raqam va 1 maxsus belgi ($ @ # ! % * ?)".
//   - maxsus belgi FAQAT shu to'plamdan ($@#!%*?) — boshqasi (^ & - _ = +) RAD etiladi
//   - umumiy uzunlik 15 dan oshmasligi shart (avval 16 belgi edi — rad etilardi)
// Format namunasi: "Sadrid#5025Kp9" kabi (12..14 belgi).
export function buildPassword(
  name: string,
  surname: string,
  passportNumber?: string,
): string {
  const first = slug(String(name).split(/\s+/)[0] || "");
  const cap = first ? first[0].toUpperCase() + first.slice(1) : "User";
  // Bazani 6 belgigacha qisqartiramiz — umumiy uzunlik 15 dan oshmasin
  // (base<=6 + sym1 + tail4 + up1 + lo1 + digit1 = 12..14 belgi).
  const base = (cap.length >= 4 ? cap : (cap + "viza").slice(0, 4)).slice(0, 6);

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

  // Hashdan bir nechta belgi (kuchli, lug'at so'ziga o'xshamasin).
  // MUHIM: belgisiz siljitish (>>>) — oddiy (>>) katta hash'larni manfiy qiladi.
  const up1 = String.fromCharCode(65 + (hash % 26)); // A-Z
  const lo1 = String.fromCharCode(97 + ((hash >>> 5) % 26)); // a-z
  const extraDigit = String((hash >>> 10) % 10); // 0-9

  // Maxsus belgi FAQAT VFS ruxsat etgan to'plamdan ($ @ # ! % * ?).
  const symbols = "$@#!%*?";
  const sym1 = symbols[hash % symbols.length];

  // Yig'amiz: Ism(base) + maxsus + 4 raqam + katta + kichik + raqam = 12..14 belgi.
  return `${base}${sym1}${tail}${up1}${lo1}${extraDigit}`;
}
