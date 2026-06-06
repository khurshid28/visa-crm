import { listSlots } from "@/lib/slots";
import SlotsManager from "@/components/SlotsManager";

export const dynamic = "force-dynamic";

export default async function SlotsPage() {
  const slots = await listSlots();
  return (
    <div className="mx-auto max-w-6xl">
      <SlotsManager slots={slots} />
    </div>
  );
}
