// Barcha arizachilarning generatedPassword'ini joriy (to'g'ri) algoritm bilan
// qayta hisoblab yozadi. Eski buzuq ("undefined" li) parollarni tuzatadi.
// Ishga tushirish: node prisma/regen-passwords.mjs

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function slug(part) {
  return String(part || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function buildPassword(name, surname, passportNumber) {
  const first = slug(String(name).split(/\s+/)[0] || "");
  const cap = first ? first[0].toUpperCase() + first.slice(1) : "User";
  const base = cap.length >= 4 ? cap : (cap + "viza").slice(0, 4);

  const digits = String(passportNumber || "").replace(/\D/g, "");
  let tail = digits.slice(-4);
  if (tail.length < 4) {
    let h = 0;
    const s = slug(surname) || "viza";
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 10000;
    tail = String(h).padStart(4, "0");
  }

  const seedStr = `${slug(name)}|${slug(surname)}|${digits}`;
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash ^= seedStr.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash = hash >>> 0;

  const up1 = String.fromCharCode(65 + (hash % 26));
  const up2 = String.fromCharCode(65 + ((hash >>> 7) % 26));
  const lo1 = String.fromCharCode(97 + ((hash >>> 5) % 26));
  const lo2 = String.fromCharCode(97 + ((hash >>> 11) % 26));
  const extraDigit = String((hash >>> 10) % 10);

  const symbols = "!@#$%^&*-_=+?";
  const sym1 = symbols[hash % symbols.length];
  const sym2 = symbols[(hash >>> 13) % symbols.length];
  const sym3 = symbols[(hash >>> 17) % symbols.length];

  return `${base}${sym1}${tail}${up1}${lo1}${sym2}${up2}${lo2}${extraDigit}${sym3}`;
}

async function main() {
  const rows = await prisma.applicant.findMany({
    select: { id: true, name: true, surname: true, passportNumber: true },
  });

  console.log(`Jami: ${rows.length} ta arizachi`);
  let done = 0;
  for (const a of rows) {
    const pwd = buildPassword(a.name, a.surname, a.passportNumber);
    await prisma.applicant.update({
      where: { id: a.id },
      data: { generatedPassword: pwd },
    });
    done++;
  }
  console.log(`Qayta yozildi: ${done} ta`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
