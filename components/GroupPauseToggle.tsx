"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "iconsax-react";
import { useToast } from "@/components/Toast";

// Guruh jadvalidagi pauza belgisi/tugmasi. Pauzada bo'lsa amber "Pauzada"
// chipi ko'rinadi va bosib pauzadan chiqarish mumkin; aks holda kichik
// "Pauza" tugmasi.
export default function GroupPauseToggle({
  groupId,
  paused,
}: {
  groupId: number;
  paused: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !paused }),
      });
      if (!res.ok) {
        toast("Amal bajarilmadi", "error");
        return;
      }
      toast(
        paused
          ? "Guruh pauzadan chiqarildi"
          : "Guruh pauzaga qo'yildi — slot ochilsa ham chetda qoladi",
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (paused) {
    return (
      <button
        onClick={toggle}
        disabled={busy}
        title="Pauzadan chiqarish — slot ochilsa GO navbatiga qo'shiladi"
        className="group inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-100 to-orange-100 px-2.5 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-300/70 shadow-sm transition hover:from-amber-200 hover:to-orange-200 active:scale-95 disabled:opacity-60 dark:from-amber-500/20 dark:to-orange-500/20 dark:text-amber-300 dark:ring-amber-500/30"
      >
        <Pause size={14} variant="Bold" className="text-amber-600 dark:text-amber-300" />
        Pauzada
        <Play size={12} variant="Bold" className="hidden text-amber-500 group-hover:inline" />
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title="Pauzaga qo'yish — slot ochilsa ham bu guruh chetda qoladi"
      className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-xs font-medium text-slate-400 ring-1 ring-transparent transition hover:bg-amber-50 hover:text-amber-600 hover:ring-amber-200 active:scale-95 disabled:opacity-60 dark:bg-slate-800/50 dark:hover:bg-amber-500/10"
    >
      <Pause size={13} /> Pauza
    </button>
  );
}
