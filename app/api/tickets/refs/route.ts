import { NextRequest, NextResponse } from "next/server";
import { searchRefs, type TicketRefKind } from "@/lib/tickets";

const KINDS: TicketRefKind[] = ["slot", "group", "user", "document"];

// GET /api/tickets/refs?kind=slot&q=... — bog'lash uchun obyekt qidirish
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind") as TicketRefKind | null;
  const q = sp.get("q") ?? "";
  if (!kind || !KINDS.includes(kind)) {
    return NextResponse.json({ error: "kind noto'g'ri" }, { status: 400 });
  }
  const results = await searchRefs(kind, q);
  return NextResponse.json({ results });
}
