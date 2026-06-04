import {
  PageHeaderSkel,
  StatCardsSkel,
  ControlsSkel,
  GallerySkel,
} from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkel />
      <StatCardsSkel count={4} />
      <ControlsSkel />
      <GallerySkel count={10} />
    </div>
  );
}
