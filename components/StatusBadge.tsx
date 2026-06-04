import {
  TickCircle,
  CloseCircle,
  Edit2,
  Clock,
  Calendar,
  Box1,
  ShoppingCart,
  Profile,
  Archive,
  PauseCircle,
  PlayCircle,
  Refresh,
  type Icon,
} from "iconsax-react";
import { APPLICANT_STATUS, GROUP_STATUS } from "@/lib/status";

// Har bir status uchun rang (ring + matn + fon + ikonka) va ikonka.
type Tone = {
  cls: string;
  Icon: Icon;
};

const APPLICANT_TONE: Record<string, Tone> = {
  NEW: {
    cls: "bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
    Icon: Box1,
  },
  EDITED: {
    cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30",
    Icon: Edit2,
  },
  BOOKING: {
    cls: "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30",
    Icon: Refresh,
  },
  REGISTERED: {
    cls: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30",
    Icon: Profile,
  },
  ORDERED: {
    cls: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30",
    Icon: ShoppingCart,
  },
  BOOKED: {
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
    Icon: TickCircle,
  },
  FAILED: {
    cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30",
    Icon: CloseCircle,
  },
  ARCHIVED: {
    cls: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:ring-slate-700",
    Icon: Archive,
  },
};

const GROUP_TONE: Record<string, Tone> = {
  PENDING: {
    cls: "bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
    Icon: Clock,
  },
  READY: {
    cls: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/30",
    Icon: TickCircle,
  },
  SLOT_OPEN: {
    cls: "bg-green-50 text-green-700 ring-green-200 dark:bg-green-500/10 dark:text-green-300 dark:ring-green-500/30",
    Icon: Calendar,
  },
  SLOT_CLOSED: {
    cls: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30",
    Icon: Clock,
  },
  BOOKING: {
    cls: "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/30",
    Icon: Refresh,
  },
  DONE: {
    cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30",
    Icon: TickCircle,
  },
  PAUSED: {
    cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30",
    Icon: PauseCircle,
  },
  ARCHIVED: {
    cls: "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:ring-slate-700",
    Icon: Archive,
  },
};

const FALLBACK: Tone = {
  cls: "bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  Icon: PlayCircle,
};

export default function StatusBadge({
  status,
  kind = "applicant",
  size = "sm",
  className = "",
}: {
  status: string;
  kind?: "applicant" | "group";
  size?: "sm" | "md";
  className?: string;
}) {
  const map = kind === "group" ? GROUP_STATUS : APPLICANT_STATUS;
  const tones = kind === "group" ? GROUP_TONE : APPLICANT_TONE;
  const label = map[status]?.label ?? status;
  const tone = tones[status] ?? FALLBACK;
  const Ico = tone.Icon;

  const pad = size === "md" ? "px-3 py-1 text-xs" : "px-2.5 py-0.5 text-[11px]";
  const iconSize = size === "md" ? 14 : 12;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ${pad} ${tone.cls} ${className}`}
    >
      <Ico size={iconSize} variant="Bold" />
      {label}
    </span>
  );
}
