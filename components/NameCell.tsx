"use client";

import { useState } from "react";
import { Eye } from "iconsax-react";
import { abbreviateName, fullName } from "@/lib/name";

// Qisqartirilgan ismni ko'rsatadi; "ko'rish" bossangiz to'liq ochiladi.
export default function NameCell({
  surname,
  name,
  className = "",
}: {
  surname?: string | null;
  name?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const full = fullName(surname, name);
  const short = abbreviateName(surname, name);
  const collapsible = full.toUpperCase() !== short.toUpperCase();

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="font-medium text-slate-800">{open ? full : short}</span>
      {collapsible && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-brand-600 transition hover:bg-brand-50"
          title={open ? "Yopish" : "To'liq ko'rish"}
        >
          <Eye size={12} variant="Bold" />
          {open ? "Yopish" : "View"}
        </button>
      )}
    </span>
  );
}
