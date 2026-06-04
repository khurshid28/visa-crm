import Link from "next/link";
import { People, Profile2User } from "iconsax-react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { APPLICANT_STATUS, APPLICANT_STATUS_KEYS } from "@/lib/status";
import ListControls from "@/components/ListControls";
import Pagination from "@/components/Pagination";
import NameCell from "@/components/NameCell";
import UserViewButton from "@/components/UserViewButton";
import StatusBadge from "@/components/StatusBadge";
import { fmtDateTime } from "@/lib/date";
export const dynamic = "force-dynamic";

const PER_PAGE = 15;

const STATUS_OPTIONS = APPLICANT_STATUS_KEYS.map((k) => ({
  value: k,
  label: APPLICANT_STATUS[k].label,
}));

type SearchParams = { q?: string; status?: string; page?: string };

export default async function UsersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const q = (searchParams.q ?? "").trim();
  const status = (searchParams.status ?? "").trim();
  const page = Math.max(1, Number(searchParams.page) || 1);

  const where: Prisma.ApplicantWhereInput = {};
  if (status && APPLICANT_STATUS_KEYS.includes(status)) {
    where.status = status as Prisma.ApplicantWhereInput["status"];
  }
  if (q) {
    where.OR = [
      { surname: { contains: q } },
      { name: { contains: q } },
      { passportNumber: { contains: q } },
      { generatedEmail: { contains: q } },
      { phone: { contains: q } },
    ];
  }

  const [total, applicants] = await Promise.all([
    prisma.applicant.count({ where }),
    prisma.applicant.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: { group: { select: { id: true, name: true } } },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  // Standart (person) rasm bor personId'larni blob yuklamasdan aniqlaymiz.
  const personIds = applicants
    .map((a) => a.personId)
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

  // PDF tayyor deb hisoblanadigan statuslar.
  const PDF_STATUSES = ["ORDERED", "BOOKED"];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Userlar</h1>
          <p className="mt-1 text-sm text-slate-500">
            Barcha arizachilar bo'yicha qidiruv va filtr
          </p>
        </div>
      </div>

      <ListControls
        searchPlaceholder="Ism, familiya, pasport, email yoki telefon..."
        statusOptions={STATUS_OPTIONS}
      />

      <div className="table-wrap">
        <table className="table-base">
          <thead>
            <tr>
              <th>ID</th>
              <th>Familiya / Ism</th>
              <th>Pasport</th>
              <th>Tizim email</th>
              <th>Guruh</th>
              <th>Status</th>
              <th>Sana</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {applicants.map((a) => {
              const initials = `${a.surname?.[0] ?? ""}${a.name?.[0] ?? ""}`
                .toUpperCase()
                .trim();
              return (
                <tr key={a.id}>
                  <td>
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      #{a.id}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-100 to-brand-50 text-xs font-bold text-brand-700 ring-1 ring-brand-100">
                        {initials || "?"}
                      </span>
                      <NameCell surname={a.surname} name={a.name} phone={a.phone} />
                    </div>
                  </td>
                  <td className="font-mono text-xs text-slate-600">
                    {a.passportNumber}
                  </td>
                  <td className="text-slate-600">
                    {a.generatedEmail || (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td>
                    {a.group ? (
                      <Link
                        href={`/groups/${a.group.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-200"
                      >
                        <Profile2User size={13} variant="Bold" />
                        {a.group.name}
                      </Link>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-400">
                    {fmtDateTime(a.createdAt)}
                  </td>
                  <td className="text-right">
                    <UserViewButton
                      user={{
                        id: a.id,
                        groupId: a.groupId,
                        surname: a.surname,
                        name: a.name,
                        passportNumber: a.passportNumber,
                        nationality: a.nationality ?? null,
                        gender: a.gender ?? null,
                        birthdate: a.birthdate ? String(a.birthdate) : null,
                        passportValidity: a.passportValidity
                          ? String(a.passportValidity)
                          : null,
                        phone: a.phone ?? null,
                        email: a.email ?? null,
                        generatedEmail: a.generatedEmail ?? null,
                        subcategory: a.subcategory ?? null,
                        city: a.city ?? null,
                        category: a.category ?? null,
                        source: a.source ?? null,
                        status: a.status,
                        complete: a.complete,
                        appointmentRef: a.appointmentRef ?? null,
                        resultNote: a.resultNote ?? null,
                        hasPhoto: !!a.passportPhoto,
                        hasPersonPhoto:
                          a.personId != null &&
                          withPersonPhoto.has(a.personId),
                        canPdf:
                          PDF_STATUSES.includes(a.status) ||
                          !!a.appointmentRef,
                        group: a.group
                          ? { id: a.group.id, name: a.group.name }
                          : null,
                      }}
                    />
                  </td>
                </tr>
              );
            })}
            {applicants.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="py-12 text-center text-sm text-slate-400"
                >
                  <People
                    size={28}
                    className="mx-auto mb-2 text-slate-300"
                    variant="Bold"
                  />
                  {q || status
                    ? "Filtrga mos arizachi topilmadi"
                    : "Hali arizachi yo'q"}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {total > 0 && (
          <div className="border-t border-slate-100">
            <Pagination page={page} totalPages={totalPages} total={total} />
          </div>
        )}
      </div>
    </div>
  );
}
