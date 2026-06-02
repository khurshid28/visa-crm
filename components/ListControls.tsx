"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SearchNormal1, Filter, CloseCircle } from "iconsax-react";
import Select from "@/components/Select";

type Option = { value: string; label: string };

/**
 * URL-asoslangan qidiruv + status filtri.
 * Qiymatlar `?q=` va `?status=` parametrlariga yoziladi, `?page` 1 ga qaytadi.
 */
export default function ListControls({
  searchPlaceholder = "Qidirish...",
  statusOptions,
}: {
  searchPlaceholder?: string;
  statusOptions?: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");
  const status = params.get("status") ?? "";

  // URL tashqaridan o'zgarsa, inputni sinxronlaymiz.
  useEffect(() => {
    setQ(params.get("q") ?? "");
  }, [params]);

  // Debounce: yozishni to'xtatgach URL yangilanadi.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => {
      update({ q, page: "1" });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function update(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="relative flex-1 sm:min-w-[280px]">
        <SearchNormal1
          size={17}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-9 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 transition hover:text-slate-500"
            aria-label="Tozalash"
          >
            <CloseCircle size={17} variant="Bold" />
          </button>
        )}
      </div>

      {statusOptions && statusOptions.length > 0 && (
        <Select
          className="min-w-[200px]"
          value={status}
          onChange={(v) => update({ status: v, page: "1" })}
          placeholder="Barcha statuslar"
          leftIcon={
            <Filter
              size={16}
              variant="Bold"
              className={status ? "text-brand-600" : "text-slate-400"}
            />
          }
          options={[
            { value: "", label: "Barcha statuslar" },
            ...statusOptions,
          ]}
        />
      )}
    </div>
  );
}
