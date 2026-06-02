// Bir martalik backfill: mavjud Applicant'lardan passport bo'yicha
// noyob Person yozuvlarini yaratadi va personId ni bog'laydi.
// Ishga tushirish:  node prisma/backfill-persons.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const applicants = await prisma.applicant.findMany({
    orderBy: { id: "asc" },
  });
  console.log(`Jami ${applicants.length} applicant topildi.`);

  let createdPersons = 0;
  let linked = 0;
  const cache = new Map(); // passport -> personId

  for (const a of applicants) {
    const passport = (a.passportNumber || "").trim();
    if (!passport) continue;

    let personId = cache.get(passport);
    if (!personId) {
      const existing = await prisma.person.findUnique({
        where: { passportNumber: passport },
      });
      if (existing) {
        personId = existing.id;
      } else {
        const person = await prisma.person.create({
          data: {
            passportNumber: passport,
            surname: a.surname,
            name: a.name,
            nationality: a.nationality,
            gender: a.gender,
            birthdate: a.birthdate,
            passportValidity: a.passportValidity,
            phone: a.phone,
          },
        });
        personId = person.id;
        createdPersons++;
      }
      cache.set(passport, personId);
    }

    if (a.personId !== personId) {
      await prisma.applicant.update({
        where: { id: a.id },
        data: { personId },
      });
      linked++;
    }
  }

  console.log(`Yaratilgan Person: ${createdPersons}, bog'langan: ${linked}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
