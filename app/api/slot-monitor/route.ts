import { NextRequest, NextResponse } from "next/server";
import {
  getSlotMonitorState,
  getSlotQueueStats,
  getSlotEvents,
  logSlotEvent,
  runSlotMonitorTick,
  setSlotMonitorState,
} from "@/lib/slot-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [state, queue, events] = await Promise.all([
    getSlotMonitorState(),
    getSlotQueueStats(),
    getSlotEvents(30),
  ]);
  return NextResponse.json({ state, queue, events });
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
    // Davomiylik (slot oynasi) — daqiqada, default 5.
    const rawWin = Number(body.windowMinutes);
    const windowMinutes =
      Number.isFinite(rawWin) && rawWin > 0 ? Math.round(rawWin) : 5;
    const state = await setSlotMonitorState({
      active: true,
      paused: false,
      slotAt: slotAt.toISOString(),
      windowMinutes,
      openedAt: null,
      lastMessage: "Monitoring ishga tushdi (har 5 soniyada tekshiradi)",
      lastCheckAt: null,
    });
    await logSlotEvent("configure", {
      slotAt: slotAt.toISOString(),
      closeAt: new Date(slotAt.getTime() + windowMinutes * 60_000).toISOString(),
      message: state.lastMessage,
      source: "web",
    });
    return NextResponse.json({ ok: true, state });
  }

  if (action === "pause") {
    const state = await setSlotMonitorState({
      paused: true,
      lastMessage: "PAUSE: buyurtma yuborish vaqtincha to'xtatildi",
    });
    await logSlotEvent("pause", {
      slotAt: state.slotAt,
      message: state.lastMessage,
      source: "web",
    });
    return NextResponse.json({ ok: true, state });
  }

  if (action === "go") {
    const state = await setSlotMonitorState({
      paused: false,
      active: true,
      lastMessage: "GO: monitoring davom etadi",
    });
    await logSlotEvent("go", {
      slotAt: state.slotAt,
      message: state.lastMessage,
      source: "web",
    });
    return NextResponse.json({ ok: true, state });
  }

  if (action === "stop") {
    const state = await setSlotMonitorState({
      active: false,
      paused: false,
      openedAt: null,
      lastMessage: "Monitoring qo'lda to'xtatildi",
    });
    await logSlotEvent("stop", {
      slotAt: state.slotAt,
      message: state.lastMessage,
      source: "web",
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
