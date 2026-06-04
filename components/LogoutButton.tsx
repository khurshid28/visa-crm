"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogoutCurve } from "iconsax-react";
import { useToast } from "@/components/Toast";

export default function LogoutButton({
  collapsed = false,
}: {
  collapsed?: boolean;
}) {
  const router = useRouter();
  const { toast, confirm } = useToast();
  const [loading, setLoading] = useState(false);

  async function logout() {
    const ok = await confirm({
      title: "Tizimdan chiqasizmi?",
      message: "Joriy sessiya yakunlanadi va qayta kirish talab qilinadi.",
      confirmLabel: "Chiqish",
      danger: true,
    });
    if (!ok) return;

    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      toast("Tizimdan muvaffaqiyatli chiqdingiz", "success");
      router.push("/login");
      router.refresh();
    } catch {
      setLoading(false);
      toast("Chiqishda xatolik yuz berdi", "error");
    }
  }

  if (collapsed) {
    return (
      <button
        onClick={logout}
        disabled={loading}
        title="Chiqish"
        aria-label="Chiqish"
        className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition-all hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-500/10 dark:hover:text-red-400"
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <LogoutCurve size={20} variant="Bold" />
        )}
      </button>
    );
  }

  return (
    <button
      onClick={logout}
      disabled={loading}
      className="group flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 transition-all hover:-translate-y-0.5 hover:border-red-200 hover:bg-red-50 hover:text-red-600 hover:shadow-sm disabled:translate-y-0 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:border-red-500/30 dark:hover:bg-red-500/10 dark:hover:text-red-400"
    >
      {loading ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Chiqilmoqda...
        </>
      ) : (
        <>
          <LogoutCurve
            size={18}
            variant="Bold"
            className="transition-transform group-hover:-translate-x-0.5"
          />
          Chiqish
        </>
      )}
    </button>
  );
}
