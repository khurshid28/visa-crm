export const GROUP_STATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Kutilyapti", cls: "bg-slate-100 text-slate-700" },
  READY: { label: "Tayyor", cls: "bg-blue-100 text-blue-700" },
  SLOT_OPEN: { label: "Slot ochiq", cls: "bg-green-100 text-green-700" },
  SLOT_CLOSED: { label: "Slot yopiq", cls: "bg-amber-100 text-amber-700" },
  BOOKING: { label: "Zakas qilinyapti", cls: "bg-brand-100 text-brand-700" },
  DONE: { label: "Tugadi", cls: "bg-emerald-100 text-emerald-700" },
  ARCHIVED: { label: "Arxivlangan", cls: "bg-slate-200 text-slate-500" },
};

export const APPLICANT_STATUS: Record<string, { label: string; cls: string }> =
  {
    NEW: { label: "Yangi", cls: "bg-slate-100 text-slate-700" },
    EDITED: { label: "Tahrirlangan", cls: "bg-blue-100 text-blue-700" },
    BOOKING: { label: "Zakasda", cls: "bg-brand-100 text-brand-700" },
    REGISTERED: {
      label: "Ro'yxatdan o'tgan",
      cls: "bg-indigo-100 text-indigo-700",
    },
    ORDERED: {
      label: "Buyurtma berilgan",
      cls: "bg-violet-100 text-violet-700",
    },
    BOOKED: { label: "Band qilindi", cls: "bg-emerald-100 text-emerald-700" },
    FAILED: { label: "Xatolik", cls: "bg-red-100 text-red-700" },
    ARCHIVED: { label: "Arxivlangan", cls: "bg-slate-200 text-slate-500" },
  };

export const GROUP_STATUS_KEYS = Object.keys(GROUP_STATUS);
export const APPLICANT_STATUS_KEYS = Object.keys(APPLICANT_STATUS);
