import Link from "next/link";
import { ArrowRight2 } from "iconsax-react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GROUP_STATUS, GROUP_STATUS_KEYS } from "@/lib/status";
import { countryName, countryIso2 } from "@/lib/options";
import StatusBadge from "@/components/StatusBadge";
import { fmtDateTime } from "@/lib/date";
import UploadGroup from "@/components/UploadGroup";
import ListControls from "@/components/ListControls";
import Pagination from "@/components/Pagination";
import GroupPauseToggle from "@/components/GroupPauseToggle";

export const dynamic = "force-dynamic";

const PER_PAGE = 12;

const STATUS_OPTIONS = GROUP_STATUS_KEYS.map((k) => ({
  value: k,
  label: GROUP_STATUS[k].label,
}));

type SearchParams = { q?: string; status?: string; page?: string };

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const q = (searchParams.q ?? "").trim();
  const status = (searchParams.status ?? "").trim();
  const page = Math.max(1, Number(searchParams.page) || 1);

  const where: Prisma.GroupWhereInput = {};
  if (status && GROUP_STATUS_KEYS.includes(status)) {
    where.status = status as Prisma.GroupWhereInput["status"];
  }
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { fileName: { contains: q } },
    ];
  }

  const [total, groups, slotRows] = await Promise.all([
    prisma.group.count({ where }),
    prisma.group.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        _count: { select: { applicants: true } },
        applicants: { select: { status: true, complete: true } },
        slot: { select: { name: true, fromCountry: true, toCountry: true } },
      },
    }),
    prisma.slot.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, fromCountry: true, toCountry: true },
    }),
  ]);

  const slotOptions = slotRows.map((s) => ({
    id: s.id,
    name: s.name,
    fromCountry: s.fromCountry,
    toCountry: s.toCountry,
    fromName: countryName(s.fromCountry),
    toName: countryName(s.toCountry),
    fromIso2: countryIso2(s.fromCountry).toLowerCase(),
    toIso2: countryIso2(s.toCountry).toLowerCase(),
  }));

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Guruhlar</h1>
          <p className="mt-1 text-sm text-slate-500">
            Excel yuklab yangi guruh qo'shing
          </p>
        </div>
        <UploadGroup slots={slotOptions} />
      </div>

      <ListControls
        searchPlaceholder="Guruh nomi yoki fayl bo'yicha qidirish..."
        statusOptions={STATUS_OPTIONS}
      />

      <div className="table-wrap">
        <table className="table-base">
          <thead>
            <tr>
              <th>ID</th>
              <th>Nomi</th>
              <th>Yo'nalish</th>
              <th>Arizachilar</th>
              <th>Status</th>
              <th>Sana</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const appCount = g._count.applicants;
              const complete = g.applicants.filter((a) => a.complete).length;
              const registered = g.applicants.filter(
                (a) => a.status === "REGISTERED",
              ).length;
              return (
                <tr key={g.id}>
                  <td>
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      #{g.id}
                    </span>
                  </td>
                  <td className="font-medium text-slate-800">{g.name}</td>
                  <td>
                    {g.slot ? (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                        {countryIso2(g.slot.fromCountry) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`https://flagcdn.com/${countryIso2(
                              g.slot.fromCountry,
                            ).toLowerCase()}.svg`}
                            alt=""
                            className="h-[13px] w-[18px] rounded-sm object-cover ring-1 ring-black/5"
                          />
                        )}
                        <span className="text-brand-500">→</span>
                        {countryIso2(g.slot.toCountry) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`https://flagcdn.com/${countryIso2(
                              g.slot.toCountry,
                            ).toLowerCase()}.svg`}
                            alt=""
                            className="h-[13px] w-[18px] rounded-sm object-cover ring-1 ring-black/5"
                          />
                        )}
                        {countryName(g.slot.toCountry)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300 dark:text-slate-600">
                        —
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        {appCount}
                      </span>
                      <span className="flex flex-col gap-0.5 text-[11px] leading-tight">
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          {complete} to'liq
                        </span>
                        <span className="inline-flex items-center gap-1 text-brand-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                          {registered} registered
                        </span>
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={g.status} kind="group" />
                      {registered > 0 && (
                        <GroupPauseToggle groupId={g.id} paused={g.paused} />
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap">
                    {g.slotOpenAt ? (
                      <span className="inline-flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
                        {fmtDateTime(g.slotOpenAt)}
                      </span>
                    ) : (
                      <span className="text-slate-300 dark:text-slate-600">
                        {fmtDateTime(g.createdAt)}
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    <Link
                      href={`/groups/${g.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-100 transition-all hover:-translate-y-0.5 hover:bg-brand-100 hover:shadow"
                    >
                      Ochish
                      <ArrowRight2 size={14} variant="Bold" />
                    </Link>
                  </td>
                </tr>
              );
            })}
            {groups.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-400">
                  {q || status
                    ? "Filtrga mos guruh topilmadi"
                    : "Hali guruh yo'q. Yuqoridan Excel yuklang."}
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
