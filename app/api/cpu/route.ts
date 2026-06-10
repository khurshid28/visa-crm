import { NextResponse } from "next/server";
import { getCpuStat } from "@/lib/cpu";

// ====================================================================
//  CPU — jonli yuklama (load) holati
// ====================================================================
//  Bosh dashboarddagi banner va "Workerlar" sahifasidagi CPU kartasi
//  shu endpointni so'rab turadi. Har so'rovda qisqa (200ms) namuna olib,
//  band foizini, yadrolar sonini va xotirani qaytaradi. 80% dan oshsa
//  `over: true` bo'ladi (UI qizil banner ko'rsatadi).
//  middleware.ts himoyalaydi (sessiyasiz 401).
// ====================================================================

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const stat = await getCpuStat();
  return NextResponse.json(stat);
}
