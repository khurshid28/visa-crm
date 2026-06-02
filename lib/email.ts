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
