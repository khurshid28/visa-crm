import { listTickets } from "@/lib/tickets";
import TicketsManager from "@/components/TicketsManager";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  const tickets = await listTickets({ archived: false });
  return (
    <div className="mx-auto max-w-6xl">
      <TicketsManager initial={tickets} />
    </div>
  );
}
