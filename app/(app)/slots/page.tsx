import { listSlots } from "@/lib/slots";
import SlotsManager from "@/components/SlotsManager";
import SiteCheckPanel from "@/components/SiteCheckPanel";

export const dynamic = "force-dynamic";

export default async function SlotsPage() {
  const slots = await listSlots();
  return (
    <div className="space-y-8">
      <SlotsManager slots={slots} />
      <div className="border-t border-slate-200 dark:border-slate-800" />
      <SiteCheckPanel />
    </div>
  );
}
