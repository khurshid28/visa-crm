"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Danger, CloseSquare, Cpu } from "iconsax-react";

type CpuStat = {
  percent: number;
  threshold: number;
  over: boolean;
  cores: number;
  memPercent: number;
};

// ===========================================================================
//  Global "CPU yuqori" banneri — butun saytda (har sahifada) ko'rinadi.
//  /api/cpu ni so'rab turadi; band foizi 80% (chegara) dan oshsa qizil
//  banner chiqaradi. Foydalanuvchi yopishi mumkin, lekin keyingi tekshiruvda
//  hali ham yuqori bo'lsa qayta chiqadi.
// ===========================================================================

export default function HighCpuBanner() {
  const [stat, setStat] = useState<CpuStat | null>(null);
  const [dismissedAt, setDismissedAt] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cpu", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as CpuStat | null;
      if (res.ok && json) setStat(json);
    } catch {
      // jim — banner shunchaki ko'rinmaydi
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 10_000);
    return () => window.clearInterval(id);
  }, [load]);

  // Yopilgandan keyin 2 daqiqa ko'rsatmaymiz (hali ham yuqori bo'lsa qaytadi).
  const recentlyDismissed = Date.now() - dismissedAt < 2 * 60 * 1000;
  if (!stat?.over || recentlyDismissed) return null;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 to-amber-50 px-4 py-3 shadow-sm dark:border-rose-500/30 dark:from-rose-500/10 dark:to-amber-500/5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300">
        <Danger size={20} variant="Bold" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-800 dark:text-rose-200">
          <Cpu size={15} variant="Bold" />
          CPU yuklamasi yuqori — {stat.percent}%
          <span className="font-normal text-rose-500">
            (chegara {stat.threshold}%)
          </span>
        </p>
        <p className="truncate text-xs text-rose-600/90 dark:text-rose-300/80">
          {stat.cores} yadro · RAM {stat.memPercent}%. Workerlar sekinlashishi
          mumkin — active workerlarni kamaytiring yoki CPU qo'shing.
        </p>
      </div>
      <Link
        href="/workers"
        className="hidden shrink-0 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 sm:inline-block"
      >
        Workerlar
      </Link>
      <button
        onClick={() => setDismissedAt(Date.now())}
        className="shrink-0 rounded-lg p-1.5 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20"
        aria-label="Yopish"
      >
        <CloseSquare size={18} />
      </button>
    </div>
  );
}
