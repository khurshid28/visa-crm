import {
  DocumentText,
  Image as ImageIcon,
  TickCircle,
  DocumentDownload,
} from "iconsax-react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import ListControls from "@/components/ListControls";
import Pagination from "@/components/Pagination";
import DocumentsGallery, { type DocItem } from "@/components/DocumentsGallery";
import DocTypeTabs from "@/components/DocTypeTabs";

export const dynamic = "force-dynamic";

const PER_PAGE = 20;

// PDF mavjud deb hisoblanadigan statuslar.
const PDF_STATUSES = ["ORDERED", "BOOKED"] as const;

type SearchParams = { q?: string; type?: string; page?: string };

function searchClause(q: string): Prisma.ApplicantWhereInput {
  return {
    OR: [
      { surname: { contains: q } },
      { name: { contains: q } },
      { passportNumber: { contains: q } },
      { generatedEmail: { contains: q } },
    ],
  };
}

const HAS_PHOTO: Prisma.ApplicantWhereInput = { passportPhoto: { not: null } };
const HAS_PERSON: Prisma.ApplicantWhereInput = {
  person: { is: { photo: { not: null } } },
};
const HAS_PDF: Prisma.ApplicantWhereInput = {
  OR: [
    { status: { in: [...PDF_STATUSES] } },
    { appointmentRef: { not: null } },
  ],
};
const HAS_ANY: Prisma.ApplicantWhereInput = {
  OR: [HAS_PHOTO, HAS_PERSON, ...HAS_PDF.OR!],
};

function typeClause(type: string): Prisma.ApplicantWhereInput {
  if (type === "photo") return HAS_PHOTO;
  if (type === "person") return HAS_PERSON;
  if (type === "pdf") return HAS_PDF;
  return HAS_ANY;
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const q = (searchParams.q ?? "").trim();
  const type = (searchParams.type ?? "").trim();
  const page = Math.max(1, Number(searchParams.page) || 1);

  const and: Prisma.ApplicantWhereInput[] = [typeClause(type)];
  if (q) and.push(searchClause(q));
  const where: Prisma.ApplicantWhereInput = { AND: and };

  const [total, photoCount, personCount, pdfCount, rows] = await Promise.all([
    prisma.applicant.count({ where: { AND: [HAS_ANY, ...(q ? [searchClause(q)] : [])] } }),
    prisma.applicant.count({ where: HAS_PHOTO }),
    prisma.applicant.count({ where: HAS_PERSON }),
    prisma.applicant.count({ where: HAS_PDF }),
    prisma.applicant.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        surname: true,
        name: true,
        passportNumber: true,
        status: true,
        passportPhoto: true,
        appointmentRef: true,
        personId: true,
        createdAt: true,
        updatedAt: true,
        orderFinishedAt: true,
        group: { select: { id: true, name: true } },
      },
    }),
  ]);

  const filteredTotal = await prisma.applicant.count({ where });
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PER_PAGE));

  // Standart (person) rasm bor personId'larni blob yuklamasdan aniqlaymiz.
  const personIds = rows
    .map((r) => r.personId)
    .filter((x): x is number => x != null);
  const withPersonPhoto = personIds.length
    ? new Set(
        (
          await prisma.person.findMany({
            where: { id: { in: personIds }, photo: { not: null } },
            select: { id: true },
          })
        ).map((p) => p.id),
      )
    : new Set<number>();

  const items: DocItem[] = rows.map((r) => ({
    id: r.id,
    surname: r.surname,
    name: r.name,
    passportNumber: r.passportNumber,
    groupId: r.group?.id ?? 0,
    groupName: r.group?.name ?? null,
    status: r.status,
    hasPhoto: !!r.passportPhoto,
    hasPersonPhoto: r.personId != null && withPersonPhoto.has(r.personId),
    canPdf:
      PDF_STATUSES.includes(r.status as (typeof PDF_STATUSES)[number]) ||
      !!r.appointmentRef,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    pdfAt: r.orderFinishedAt ? r.orderFinishedAt.toISOString() : null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Hujjatlar
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Passport rasmlari va tasdiq PDF'larini ko'rish, qidirish va yuklab olish
        </p>
      </div>

      {/* Stat kartalar */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Jami hujjatli" value={total} icon={<DocumentText size={20} variant="Bold" />} tone="bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300" />
        <StatCard label="Passport rasm" value={photoCount} icon={<ImageIcon size={20} variant="Bold" />} tone="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300" />
        <StatCard label="Standart rasm" value={personCount} icon={<TickCircle size={20} variant="Bold" />} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300" />
        <StatCard label="PDF tayyor" value={pdfCount} icon={<DocumentDownload size={20} variant="Bold" />} tone="bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300" />
      </div>

      <ListControls searchPlaceholder="Ism, familiya, pasport yoki email..." />

      <DocTypeTabs />

      <DocumentsGallery items={items} />

      {filteredTotal > PER_PAGE && (
        <div className="table-wrap">
          <Pagination page={page} totalPages={totalPages} total={filteredTotal} />
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-slate-500">{label}</p>
        <p className="text-xl font-bold text-slate-900 dark:text-slate-100">
          {value}
        </p>
      </div>
    </div>
  );
}
