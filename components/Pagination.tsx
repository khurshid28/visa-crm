"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft2, ArrowRight2 } from "iconsax-react";

/**
 * URL-asoslangan pagination (`?page=`).
 * Mavjud boshqa parametrlar (q, status) saqlanadi.
 */
export default function Pagination({
  page,
  totalPages,
  total,
}: {
  page: number;
  totalPages: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function go(p: number) {
    const sp = new URLSearchParams(params.toString());
    sp.set("page", String(p));
    router.push(`${pathname}?${sp.toString()}`);
  }

  const pages = pageList(page, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <p className="text-xs text-slate-400">
        Jami <span className="font-medium text-slate-600">{total}</span> ta ·{" "}
        {page}/{Math.max(1, totalPages)}-sahifa
      </p>

      <div className="flex items-center gap-1">
        <button
          className="icon-btn disabled:opacity-40"
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          aria-label="Oldingi"
        >
          <ArrowLeft2 size={16} />
        </button>

        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`g${i}`} className="px-1.5 text-sm text-slate-400">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => go(p)}
              className={`min-w-8 rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
                p === page
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {p}
            </button>
          ),
        )}

        <button
          className="icon-btn disabled:opacity-40"
          onClick={() => go(page + 1)}
          disabled={page >= totalPages}
          aria-label="Keyingi"
        >
          <ArrowRight2 size={16} />
        </button>
      </div>
    </div>
  );
}

// 1 … 4 5 [6] 7 8 … 20 ko'rinishidagi ro'yxat.
function pageList(page: number, total: number): (number | "…")[] {
  if (total <= 7)
    return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(total - 1, page + 1);
  if (start > 2) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("…");
  out.push(total);
  return out;
}
