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

  return (
    <div className="space-y-6">
      <Link href="/groups" className="text-sm text-brand-600 hover:underline">
        ← Guruhlar
      </Link>
      <GroupDetail group={JSON.parse(JSON.stringify(group))} />
    </div>
  );
}
