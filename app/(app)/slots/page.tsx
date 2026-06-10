import { listSlots } from "@/lib/slots";
import SlotsManager from "@/components/SlotsManager";
import SiteCheckPanel from "@/components/SiteCheckPanel";

export const dynamic = "force-dynamic";

export default async function SlotsPage() {
  const slots = await listSlots();
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <SlotsManager slots={slots} />
      <SiteCheckPanel />
    </div>
  );
}
