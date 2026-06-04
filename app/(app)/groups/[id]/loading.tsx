import { PageHeaderSkel, StatCardsSkel, TableSkel } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkel />
      <StatCardsSkel count={4} />
      <TableSkel rows={8} cols={6} />
    </div>
  );
}
