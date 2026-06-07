import { NextRequest, NextResponse } from "next/server";
import { checkSlotSuper } from "@/lib/auth";
import { createSlot, listSlots } from "@/lib/slots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const slots = await listSlots();
  return NextResponse.json({ slots });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  // Slot yaratish — alohida super-login/parol talab qilinadi (admin emas).
  const superUser = String(body.superUsername || "");
  const superPass = String(body.superPassword || "");
  if (!checkSlotSuper(superUser, superPass)) {
    return NextResponse.json(
      { error: "Super login yoki parol noto'g'ri" },
      { status: 401 },
    );
  }

  const name = String(body.name || "").trim();
  const fromCountry = String(body.fromCountry || "UZB");
  const toCountry = String(body.toCountry || "LVA");
  if (!name) {
    return NextResponse.json({ error: "Slot nomi kerak" }, { status: 400 });
  }

  const slotAt = body.slotAt ? String(body.slotAt) : null;
  const rawWin = Number(body.windowMinutes);
  const windowMinutes =
    Number.isFinite(rawWin) && rawWin > 0 ? Math.round(rawWin) : 10;
  const rawLead = Number(body.registerLeadMinutes);
  const registerLeadMinutes =
    Number.isFinite(rawLead) && rawLead >= 0 ? Math.round(rawLead) : 5;

  const slot = await createSlot({
    name,
    fromCountry,
    toCountry,
    slotAt,
    windowMinutes,
    registerLeadMinutes,
    centre: body.centre ? String(body.centre) : null,
    category: body.category ? String(body.category) : null,
    subCategory: body.subCategory ? String(body.subCategory) : null,
  });
  return NextResponse.json({ ok: true, slot });
}
