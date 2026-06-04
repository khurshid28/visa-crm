import { PageHeaderSkel, ControlsSkel, TableSkel } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkel />
      <ControlsSkel />
      <TableSkel rows={8} cols={7} />
    </div>
  );
}
