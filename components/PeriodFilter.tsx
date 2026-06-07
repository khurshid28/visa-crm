"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Calendar } from "iconsax-react";

const OPTIONS = [
  { value: "7", label: "7 kun" },
  { value: "30", label: "30 kun" },
  { value: "90", label: "90 kun" },
  { value: "365", label: "1 yil" },
];

/**
 * URL-asoslangan davr (period) filtri — `?days=` parametriga yoziladi.
 * Segmentli (segmented) tugmalar, server komponent qayta o'qiydi.
 */
export default function PeriodFilter({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setDays(days: string) {
    const next = new URLSearchParams(params.toString());
    next.set("days", days);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-white p-1 shadow-soft ring-1 ring-slate-100 dark:bg-slate-900/60 dark:ring-slate-800">
      <span className="flex items-center gap-1.5 pl-2 pr-1 text-xs font-medium text-slate-400">
        <Calendar size={14} variant="Bold" className="text-brand-500" />
      </span>
      {OPTIONS.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => setDays(o.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              active
                ? "bg-brand-500 text-white shadow"
                : "text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
