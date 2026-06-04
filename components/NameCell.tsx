import { Call } from "iconsax-react";
import { abbreviateName } from "@/lib/name";

// Qisqartirilgan ism va tagida telefon raqamini ko'rsatadi.
export default function NameCell({
  surname,
  name,
  phone,
  className = "",
}: {
  surname?: string | null;
  name?: string | null;
  phone?: string | null;
  className?: string;
}) {
  const short = abbreviateName(surname, name);

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className="font-medium text-slate-800 dark:text-slate-100">
        {short}
      </span>
      {phone ? (
        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
          <Call size={11} variant="Bold" className="text-brand-500" />
          {phone}
        </span>
      ) : (
        <span className="text-xs text-slate-300">—</span>
      )}
    </div>
  );
}
