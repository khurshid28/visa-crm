import {
  PageHeaderSkel,
  StatCardsSkel,
  SkelBox,
} from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkel />
      <StatCardsSkel count={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <SkelBox className="mb-4 h-4 w-32" />
          <SkelBox className="h-64 w-full" />
        </div>
        <div className="card p-5">
          <SkelBox className="mb-4 h-4 w-32" />
          <SkelBox className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}
