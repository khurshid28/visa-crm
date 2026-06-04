import { NextRequest, NextResponse } from "next/server";
import {
  getSlotMonitorState,
  getSlotQueueStats,
  runSlotMonitorTick,
  setSlotMonitorState,
} from "@/lib/slot-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [state, queue] = await Promise.all([
    getSlotMonitorState(),
    getSlotQueueStats(),
  ]);
  return NextResponse.json({ state, queue });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "").toLowerCase();

  if (action === "configure") {
    const slotAt = body.slotAt ? new Date(String(body.slotAt)) : null;
    if (!slotAt || Number.isNaN(slotAt.getTime())) {
      return NextResponse.json(
        { error: "slotAt noto'g'ri yoki yo'q" },
        { status: 400 },
      );
    }
    const state = await setSlotMonitorState({
      active: true,
      paused: false,
      slotAt: slotAt.toISOString(),
      lastMessage: "Monitoring ishga tushdi (har 10 soniyada tekshiradi)",
      lastCheckAt: null,
    });
    return NextResponse.json({ ok: true, state });
  }

  if (action === "pause") {
    const state = await setSlotMonitorState({
      paused: true,
      lastMessage: "PAUSE: buyurtma yuborish vaqtincha to'xtatildi",
    });
    return NextResponse.json({ ok: true, state });
  }

  if (action === "go") {
    const state = await setSlotMonitorState({
      paused: false,
      active: true,
      lastMessage: "GO: monitoring davom etadi",
    });
    return NextResponse.json({ ok: true, state });
  }

  if (action === "stop") {
    const state = await setSlotMonitorState({
      active: false,
      paused: false,
      lastMessage: "Monitoring qo'lda to'xtatildi",
    });
    return NextResponse.json({ ok: true, state });
  }

  if (action === "tick") {
    const out = await runSlotMonitorTick();
    return NextResponse.json({ ok: true, ...out });
  }

  return NextResponse.json(
    { error: "Noma'lum action (configure|pause|go|stop|tick)" },
    { status: 400 },
  );
}
