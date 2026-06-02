// Ism-familiyani qisqartiradi: birinchi so'z to'liq, qolganlari bosh harf.
// "SHARIPOV ZOIR TOLIB UGLI" -> "SHARIPOV.Z.T"
// Otasining ismi qo'shimchalari (ugli/qizi/o'g'li ...) tashlab yuboriladi.

const PATRONYMIC_SUFFIXES = new Set([
  "UGLI",
  "OGLI",
  "O'G'LI",
  "OʻGʻLI",
  "QIZI",
  "KIZI",
  "QIZ",
]);

export function fullName(
  surname?: string | null,
  name?: string | null,
): string {
  return [surname, name].filter(Boolean).join(" ").trim();
}

export function abbreviateName(
  surname?: string | null,
  name?: string | null,
): string {
  const words = fullName(surname, name).split(/\s+/).filter(Boolean);
  if (words.length === 0) return "—";
  if (words.length === 1) return words[0];

  const first = words[0];
  const initials = words
    .slice(1)
    .filter((w) => !PATRONYMIC_SUFFIXES.has(w.toUpperCase()))
    .map((w) => w[0].toUpperCase());

  return initials.length > 0 ? `${first}.${initials.join(".")}` : first;
}
