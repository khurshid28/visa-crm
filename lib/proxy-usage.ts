// PROKSI TRAFIK HISOBI — qancha trafik (bayt) ishlatilganini yozib boramiz.
//
// NEGA: IPRoyal kabi proksi GB bo'yicha pul oladi. Har worker (va umumiy)
// qancha trafik ishlatayotganini, sana bo'yicha kunlik hisobotini ko'rsatamiz.
//
// QANDAY: Chrome (CDP) `Network.loadingFinished.encodedDataLength` — haqiqiy
// "simdan o'tgan" yuklab olingan bayt. Bu yerda faqat HISOBNI saqlaymiz;
// o'lchash browser.ts (openBrowserContext) ichida CDP orqali bo'ladi.
//
// KIM ISHLATDI (attribution): worker-pool bitta jarayonda BIR NECHTA lane'ni
// parallel ishlatadi, shuning uchun "joriy worker"ni global o'zgaruvchida
// saqlash xato bo'lardi (poyga). AsyncLocalStorage har bir async zanjirga
// alohida kontekst beradi — to'g'ri attribution.
import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "./prisma";

export type ProxyAttribution = {
  label: string; // worker-01 | slot | web | tizim
  stage?: string; // register | login | order | slot | activation
};

const als = new AsyncLocalStorage<ProxyAttribution>();

const GB = 1024 ** 3;

/** Berilgan attribution kontekstida `fn`ni ishga tushiradi (async-safe). */
export function runWithProxyAttribution<T>(
  meta: ProxyAttribution,
  fn: () => T,
): T {
  return als.run({ label: meta.label || "tizim", stage: meta.stage }, fn);
}

/** Joriy async zanjirning attribution'i (yo'q bo'lsa "tizim"). */
export function currentAttribution(): ProxyAttribution {
  return als.getStore() || { label: "tizim" };
}

/** Mahalliy sana kaliti "YYYY-MM-DD" (UTC emas — local). */
export function usageDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Baytni o'qiladigan ko'rinishga (GB, 3 xona) aylantiradi. */
export function bytesToGb(bytes: number): number {
  return Math.round((bytes / GB) * 1000) / 1000;
}

type RecordArgs = {
  bytes: number;
  requests?: number;
  label?: string;
  stage?: string;
  country?: string;
};

/**
 * Bir brauzer sessiyasi tugagach trafikni bazaga qo'shadi (fire-and-forget).
 * `label`/`stage` berilmasa joriy attribution'dan oladi.
 */
export function recordProxyUsage(args: RecordArgs): void {
  const bytes = Math.max(0, Math.floor(args.bytes || 0));
  if (bytes <= 0) return; // trafik bo'lmasa yozmaymiz

  const attr = currentAttribution();
  const day = usageDayKey();
  const label = (args.label || attr.label || "tizim").slice(0, 64);
  const stage = (args.stage ?? attr.stage ?? "").slice(0, 32);
  const country = (args.country || "").slice(0, 16);
  const requests = Math.max(0, Math.floor(args.requests || 0));

  prisma.proxyUsage
    .upsert({
      where: { day_label_stage_country: { day, label, stage, country } },
      create: {
        day,
        label,
        stage,
        country,
        bytes: BigInt(bytes),
        requests,
        jobs: 1,
      },
      update: {
        bytes: { increment: BigInt(bytes) },
        requests: { increment: requests },
        jobs: { increment: 1 },
      },
    })
    .catch(() => {
      // hisob — yordamchi ma'lumot; xatosi asosiy oqimni to'xtatmasligi kerak
    });
}

/** Bugun jami ishlatilgan trafik (GB) — Telegram ogohlantirishi uchun. */
export async function todayUsageGb(): Promise<number> {
  try {
    const agg = await prisma.proxyUsage.aggregate({
      where: { day: usageDayKey() },
      _sum: { bytes: true },
    });
    return bytesToGb(Number(agg._sum.bytes || 0n));
  } catch {
    return 0;
  }
}

export type ProxyUsageDay = {
  day: string;
  bytes: number;
  gb: number;
  requests: number;
  jobs: number;
};

export type ProxyUsageLabel = {
  label: string;
  bytes: number;
  gb: number;
  requests: number;
  jobs: number;
};

export type ProxyUsageReport = {
  windowDays: number;
  today: { bytes: number; gb: number };
  totals: { bytes: number; gb: number; requests: number; jobs: number };
  daily: ProxyUsageDay[];
  workers: ProxyUsageLabel[];
  balance: {
    purchasedGb: number;
    usedGb: number; // hamma vaqt davomida
    remainingGb: number;
    hasBudget: boolean;
  };
};

/**
 * Hisobot: oxirgi `days` kun bo'yicha kunlik + worker bo'yicha jami, hamda
 * butun davr uchun balans (sotib olingan GB - ishlatilgan GB).
 */
export async function proxyUsageReport(opts?: {
  days?: number;
}): Promise<ProxyUsageReport> {
  const days = Math.min(90, Math.max(1, Math.floor(opts?.days || 14)));
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  const sinceKey = usageDayKey(since);
  const todayKey = usageDayKey();

  const [rows, allTime, topupAgg] = await Promise.all([
    prisma.proxyUsage.findMany({
      where: { day: { gte: sinceKey } },
      select: {
        day: true,
        label: true,
        bytes: true,
        requests: true,
        jobs: true,
      },
    }),
    prisma.proxyUsage.aggregate({ _sum: { bytes: true } }),
    prisma.proxyTopup.aggregate({ _sum: { gb: true } }),
  ]);

  const dayMap = new Map<string, ProxyUsageDay>();
  const labelMap = new Map<string, ProxyUsageLabel>();
  let totalBytes = 0;
  let totalReq = 0;
  let totalJobs = 0;
  let todayBytes = 0;

  for (const r of rows) {
    const b = Number(r.bytes || 0n);
    const req = r.requests || 0;
    const jobs = r.jobs || 0;
    totalBytes += b;
    totalReq += req;
    totalJobs += jobs;
    if (r.day === todayKey) todayBytes += b;

    const d = dayMap.get(r.day) || {
      day: r.day,
      bytes: 0,
      gb: 0,
      requests: 0,
      jobs: 0,
    };
    d.bytes += b;
    d.requests += req;
    d.jobs += jobs;
    dayMap.set(r.day, d);

    const l = labelMap.get(r.label) || {
      label: r.label,
      bytes: 0,
      gb: 0,
      requests: 0,
      jobs: 0,
    };
    l.bytes += b;
    l.requests += req;
    l.jobs += jobs;
    labelMap.set(r.label, l);
  }

  const daily = Array.from(dayMap.values())
    .map((d) => ({ ...d, gb: bytesToGb(d.bytes) }))
    .sort((a, b) => (a.day < b.day ? 1 : -1)); // eng yangi yuqorida

  const workers = Array.from(labelMap.values())
    .map((l) => ({ ...l, gb: bytesToGb(l.bytes) }))
    .sort((a, b) => b.bytes - a.bytes);

  const usedBytesAll = Number(allTime._sum.bytes || 0n);
  const usedGb = bytesToGb(usedBytesAll);
  const purchasedGb = Math.round((topupAgg._sum.gb || 0) * 1000) / 1000;
  const remainingGb = Math.round((purchasedGb - usedGb) * 1000) / 1000;

  return {
    windowDays: days,
    today: { bytes: todayBytes, gb: bytesToGb(todayBytes) },
    totals: {
      bytes: totalBytes,
      gb: bytesToGb(totalBytes),
      requests: totalReq,
      jobs: totalJobs,
    },
    daily,
    workers,
    balance: {
      purchasedGb,
      usedGb,
      remainingGb,
      hasBudget: purchasedGb > 0,
    },
  };
}
