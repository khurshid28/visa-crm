import { NextRequest, NextResponse } from "next/server";
import { checkSlotSuper } from "@/lib/auth";
import { loadSettingsIntoEnv } from "@/lib/settings";
import {
  proxyHealthForApi,
  checkProxyHealth,
  resetProxyHealth,
} from "@/lib/proxy";
import { proxyUsageReport } from "@/lib/proxy-usage";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Oxirgi top-up yozuvlari (daftar) — UI'da ko'rsatish uchun.
async function recentTopups() {
  return prisma.proxyTopup.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      gb: true,
      amountUsd: true,
      note: true,
      createdBy: true,
      createdAt: true,
    },
  });
}

// GET — proksi holati + trafik hisoboti (kunlik, worker bo'yicha) + balans
// + oxirgi to'ldirishlar. Admin sessiyasi yetarli (middleware tekshiradi).
export async function GET(req: NextRequest) {
  await loadSettingsIntoEnv();
  const days = Math.min(
    90,
    Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 14),
  );
  const [report, topups] = await Promise.all([
    proxyUsageReport({ days }),
    recentTopups(),
  ]);
  return NextResponse.json({
    health: proxyHealthForApi(),
    ...report,
    topups,
  });
}

// POST — ikki amal:
//   action="recheck" — health keshini tozalab proksini QAYTA tekshiradi
//                       (oddiy admin yetarli).
//   action="topup"   — "proksi to'landi" daftariga yozadi (N GB, izoh) va
//                       blokni ochadi (kesh reset + qayta tekshir). SUPER kerak.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const action = String(body.action || "");

  if (action === "recheck") {
    resetProxyHealth();
    const health = await checkProxyHealth();
    return NextResponse.json({ ok: true, health });
  }

  if (action === "topup") {
    const superUser = String(body.superUsername || "");
    const superPass = String(body.superPassword || "");
    if (!checkSlotSuper(superUser, superPass)) {
      return NextResponse.json(
        { error: "Super login yoki parol noto'g'ri" },
        { status: 401 },
      );
    }

    const gb = Number(body.gb);
    if (!Number.isFinite(gb) || gb <= 0) {
      return NextResponse.json(
        { error: "GB qiymati noto'g'ri (0 dan katta bo'lishi kerak)" },
        { status: 400 },
      );
    }
    const amountUsdRaw = Number(body.amountUsd);
    const amountUsd =
      Number.isFinite(amountUsdRaw) && amountUsdRaw > 0 ? amountUsdRaw : null;
    const note = String(body.note || "").slice(0, 500) || null;

    await prisma.proxyTopup.create({
      data: {
        gb,
        amountUsd,
        note,
        createdBy: superUser || null,
      },
    });

    // Balans to'ldirildi — blokni ochamiz: keshni tozalab qayta tekshiramiz.
    resetProxyHealth();
    const health = await checkProxyHealth();
    const [report, topups] = await Promise.all([
      proxyUsageReport(),
      recentTopups(),
    ]);
    return NextResponse.json({ ok: true, health, ...report, topups });
  }

  return NextResponse.json({ error: "Noma'lum amal" }, { status: 400 });
}
