"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Gallery,
  Image as ImageIcon,
  TickCircle,
  DocumentText,
} from "iconsax-react";

const TABS = [
  { value: "", label: "Hammasi", icon: Gallery },
  { value: "photo", label: "Passport rasm", icon: ImageIcon },
  { value: "person", label: "Standart rasm", icon: TickCircle },
  { value: "pdf", label: "PDF", icon: DocumentText },
];

// Hujjat turi bo'yicha filtr — URL'dagi ?type= ga yoziladi, ?page=1 ga qaytadi.
export default function DocTypeTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get("type") ?? "";

  function select(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set("type", value);
    else sp.delete("type");
    sp.delete("page");
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map((t) => {
        const on = active === t.value;
        const Icon = t.icon;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => select(t.value)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-all ${
              on
                ? "bg-brand-600 text-white shadow-sm"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900/60 dark:text-slate-300 dark:ring-slate-800 dark:hover:bg-slate-800/60"
            }`}
          >
            <Icon size={16} variant="Bold" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
