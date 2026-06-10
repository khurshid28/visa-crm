import { NextRequest, NextResponse } from "next/server";
import {
  checkSlotNow,
  configureSlot,
  controlSlot,
  runSlotTick,
} from "@/lib/slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "ID noto'g'ri" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "").toLowerCase();

  if (action === "pause" || action === "go" || action === "stop") {
    const slot = await controlSlot(id, action);
    return NextResponse.json({ ok: true, slot });
  }

  if (action === "tick") {
    const result = await runSlotTick(id);
    return NextResponse.json({ ok: true, ...result });
  }

  // Qo'lda brauzer tekshiruvi — vaqt oynasiga bog'liq emas, faqat diagnostika.
  if (action === "check") {
    const result = await checkSlotNow(id);
    return NextResponse.json(result);
  }

  if (action === "configure") {
    const slot = await configureSlot(id, {
      name: body.name !== undefined ? String(body.name) : undefined,
      fromCountry: body.fromCountry ? String(body.fromCountry) : undefined,
      toCountry: body.toCountry ? String(body.toCountry) : undefined,
      slotAt: body.slotAt !== undefined ? body.slotAt : undefined,
      windowMinutes:
        body.windowMinutes !== undefined
          ? Number(body.windowMinutes)
          : undefined,
      registerLeadMinutes:
        body.registerLeadMinutes !== undefined
          ? Number(body.registerLeadMinutes)
          : undefined,
      centre: body.centre !== undefined ? String(body.centre) : undefined,
      category: body.category !== undefined ? String(body.category) : undefined,
      subCategory:
        body.subCategory !== undefined ? String(body.subCategory) : undefined,
    });
    return NextResponse.json({ ok: true, slot });
  }

  return NextResponse.json({ error: "Noma'lum amal" }, { status: 400 });
}
