import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import GroupDetail from "@/components/GroupDetail";

export const dynamic = "force-dynamic";

export default async function GroupPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  if (Number.isNaN(id)) notFound();

  const group = await prisma.group.findUnique({
    where: { id },
    include: { applicants: { orderBy: { id: "asc" } } },
  });
  if (!group) notFound();

  // FAILED arizachilar uchun oxirgi muvaffaqiyatsiz urinish logini olib,
  // qaysi bosqichda (register/order) xato bo'lganini ko'rsatamiz.
  const failedIds = group.applicants
    .filter((a) => a.status === "FAILED")
    .map((a) => a.id);
  let errorByApplicant: Record<number, { stage: string; note: string }> = {};
  if (failedIds.length) {
    const logs = await prisma.automationLog.findMany({
      where: { applicantId: { in: failedIds }, ok: false },
      orderBy: { createdAt: "desc" },
      select: { applicantId: true, stage: true, note: true },
    });
    for (const l of logs) {
      if (l.applicantId == null || errorByApplicant[l.applicantId]) continue;
      errorByApplicant[l.applicantId] = {
        stage: l.stage,
        note: l.note ?? "",
      };
    }
  }

  const groupData = JSON.parse(JSON.stringify(group));
  for (const a of groupData.applicants) {
    const err = errorByApplicant[a.id];
    a.errorStage = err?.stage ?? null;
    a.errorNote = err?.note ?? a.resultNote ?? null;
  }

  return (
    <div className="space-y-6">
      <Link
        href="/groups"
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        <span className="text-base leading-none">←</span> Guruhlar
      </Link>
      <GroupDetail group={groupData} />
    </div>
  );
}
