"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Flash,
  Edit2,
  Archive,
  DocumentDownload,
  TickCircle,
  Warning2,
  UserAdd,
  Refresh,
  SearchNormal1,
  Filter,
  ArrowLeft2,
  ArrowRight2,
  Profile2User,
  Send2,
  Pause,
  Play,
  CloseCircle,
  Calendar,
} from "iconsax-react";
import {
  GROUP_STATUS,
  APPLICANT_STATUS,
  APPLICANT_STATUS_KEYS,
} from "@/lib/status";
import { buildEmail, buildPassword } from "@/lib/email";
import { GENDERS, COUNTRIES, DEFAULT_COUNTRY, CATEGORIES, SUBCATEGORIES } from "@/lib/options";
import PassportReader, { type PassportFields } from "@/components/PassportReader";
import NameCell from "@/components/NameCell";
import CredentialCell from "@/components/CredentialCell";
import Select from "@/components/Select";
import StatusBadge from "@/components/StatusBadge";
import DateTimePicker from "@/components/DateTimePicker";
import { useToast } from "@/components/Toast";

type Applicant = {
  id: number;
  surname: string;
  name: string;
  passportNumber: string;
  nationality: string | null;
  gender: string | null;
  birthdate: string | null;
  passportValidity: string | null;
  phone: string | null;
  email: string | null;
  category: string | null;
  subcategory: string | null;
  generatedEmail: string | null;
  generatedPassword: string | null;
  complete: boolean;
  status: string;
  appointmentRef: string | null;
  passportPhoto: string | null;
  errorStage: string | null;
  errorNote: string | null;
};

// Arxivlash faqat dastlabki bosqichda (status zakasga o'tmaganda) mumkin.
const ARCHIVABLE = ["NEW", "EDITED"];

type Group = {
  id: number;
  name: string;
  note: string | null;
  status: string;
  fileName: string | null;
  paused: boolean;
  slotOpenAt: string | null;
  slotCloseAt: string | null;
  slot?: {
    name: string;
    fromCountry: string;
    toCountry: string;
    fromName: string;
    toName: string;
    fromIso2: string;
    toIso2: string;
  } | null;
  applicants: Applicant[];
};

// ISO yoki Date stringni datetime-local ("YYYY-MM-DDTHH:mm") formatga keltiradi.
function toLocalInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default function GroupDetail({ group }: { group: Group }) {
  const router = useRouter();
  const { toast, confirm } = useToast();
  const [editing, setEditing] = useState<Applicant | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | "group" | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [savingDate, setSavingDate] = useState(false);
  const [slotOpenAt, setSlotOpenAt] = useState(toLocalInput(group.slotOpenAt));
  const PER_PAGE = 10;

  async function saveSlotDate(value: string) {
    setSlotOpenAt(value);
    setSavingDate(true);
    try {
      const res = await fetch(`/api/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotOpenAt: value || null }),
      });
      if (!res.ok) throw new Error();
      toast(value ? "Guruh sanasi saqlandi" : "Guruh sanasi tozalandi");
      router.refresh();
    } catch {
      toast("Sanani saqlab bo'lmadi", "error");
    } finally {
      setSavingDate(false);
    }
  }

  async function bookGroup(stage: "register" | "order") {
    setBusyId("group");
    try {
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group.id, stage }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error();

      if (stage === "order") {
        if (data.slotBlocked) {
          toast(`Slot yopiq: ${data.slotBlocked}`, "error");
          return;
        }
        if (data.queued) {
          toast(
            `Buyurtma navbatga qo'shildi: ${data.queuedJobs ?? 0} ta (worker bajaradi)`,
          );
        } else {
          toast(data.note || "Buyurtma navbatga qo'shilmadi", "error");
        }
        router.refresh();
        return;
      }

      // register — endi navbatga tushadi (worker'lar parallel bajaradi).
      if (data.queued) {
        toast(
          `Ro'yxatdan o'tkazish navbatga qo'shildi: ${data.queuedJobs ?? 0} ta` +
            (data.skippedJobs ? ` (skip: ${data.skippedJobs})` : ""),
        );
      } else {
        toast(
          data.note || "Ro'yxatdan o'tkazishga user qo'shilmadi",
          "error",
        );
      }
      router.refresh();
    } catch {
      toast("Amal bajarilmadi", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function bookApplicant(id: number, stage: "register" | "order") {
    setBusyId(id);
    try {
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicantId: id, stage }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error();

      if (stage === "order") {
        if (data.slotBlocked) {
          toast(`Slot yopiq: ${data.slotBlocked}`, "error");
        } else if (data.queued) {
          toast("Buyurtma navbatga qo'shildi (worker bajaradi)");
        } else {
          toast(data.note || "Buyurtma navbatga qo'shilmadi", "error");
        }
        router.refresh();
        return;
      }

      if (data.ok) {
        toast("Arizachi ro'yxatdan o'tkazildi");
      } else {
        const note = data.automation?.note || "Avtomatlashtirish xatosi";
        toast(`Xato: ${note}`, "error");
      }
      router.refresh();
    } catch {
      toast("Amal bajarilmadi", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function archiveGroup() {
    const ok = await confirm({
      title: "Guruhni arxivlash",
      message: "Bu guruh arxivga o'tkaziladi. Davom etamizmi?",
      confirmLabel: "Arxivlash",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/groups/${group.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ARCHIVED" }),
    });
    if (res.ok) {
      toast("Guruh arxivlandi");
      router.refresh();
    } else {
      toast("Arxivlashda xatolik", "error");
    }
  }

  async function togglePause() {
    const next = !group.paused;
    setBusyId("group");
    try {
      const res = await fetch(`/api/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next }),
      });
      if (!res.ok) throw new Error();
      toast(
        next
          ? "Guruh pauzaga qo'yildi — slot ochilsa ham bu guruh chetda qoladi"
          : "Guruh pauzadan chiqarildi",
      );
      router.refresh();
    } catch {
      toast("Amal bajarilmadi", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function archiveApplicant(id: number) {
    const ok = await confirm({
      title: "Arizachini arxivlash",
      message: "Bu arizachi arxivga o'tkaziladi. Davom etamizmi?",
      confirmLabel: "Arxivlash",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/applicants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ARCHIVED" }),
    });
    if (res.ok) {
      toast("Arizachi arxivlandi");
      router.refresh();
    } else {
      toast("Arxivlashda xatolik", "error");
    }
  }

  const meta = GROUP_STATUS[group.status] ?? {
    label: group.status,
    cls: "bg-slate-100 text-slate-700",
  };
  const total = group.applicants.length;
  const registered = group.applicants.filter(
    (a) => a.status === "REGISTERED",
  ).length;
  const ordered = group.applicants.filter(
    (a) => a.status === "ORDERED" || a.status === "BOOKED",
  ).length;
  const completeCount = group.applicants.filter((a) => a.complete).length;
  const waitingSlot = registered > 0 && ordered === 0;

  const q = search.trim().toLowerCase();
  const filtered = group.applicants.filter((a) => {
    if (statusFilter && a.status !== statusFilter) return false;
    if (!q) return true;
    return [
      a.surname,
      a.name,
      a.passportNumber,
      a.generatedEmail,
      a.phone,
    ]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice(
    (safePage - 1) * PER_PAGE,
    safePage * PER_PAGE,
  );

  // Filtr o'zgarsa, birinchi sahifaga qaytamiz.
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  return (
    <div className="space-y-6">
      {busyId === "group" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-2xl bg-white px-10 py-8 shadow-2xl dark:bg-slate-900">
            <span className="relative flex h-14 w-14">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-40" />
              <span className="relative inline-flex h-14 w-14 animate-spin items-center justify-center rounded-full border-4 border-brand-100 border-t-brand-600" />
            </span>
            <div className="text-center">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Buyurtma yuborilmoqda...
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Worker'lar navbatni bajaryapti, kuting
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-6 p-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold">{group.name}</h1>
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium backdrop-blur">
                {meta.label}
              </span>
              {group.paused && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-semibold text-amber-950">
                  <Pause size={12} variant="Bold" /> Pauzada
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-white/70">
              {total} arizachi
              {group.fileName ? ` - ${group.fileName}` : ""}
            </p>
            {group.slot && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium backdrop-blur">
                {group.slot.fromIso2 && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://flagcdn.com/${group.slot.fromIso2}.svg`}
                    alt=""
                    className="h-[13px] w-[18px] rounded-sm object-cover ring-1 ring-white/20"
                  />
                )}
                {group.slot.fromName}
                <span>→</span>
                {group.slot.toIso2 && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://flagcdn.com/${group.slot.toIso2}.svg`}
                    alt=""
                    className="h-[13px] w-[18px] rounded-sm object-cover ring-1 ring-white/20"
                  />
                )}
                {group.slot.toName}
                <span className="text-white/50">· {group.slot.name}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur transition-all hover:bg-white/25 active:scale-95"
              onClick={() => setAdding(true)}
            >
              <UserAdd size={18} variant="Bold" />
              Arizachi
            </button>

            <div className="mx-1 h-7 w-px bg-white/20" />

            <button
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/25 backdrop-blur transition-all hover:bg-white/25 active:scale-95 disabled:opacity-60"
              onClick={() => bookGroup("register")}
              disabled={busyId === "group"}
              title="Barchasini ro'yxatdan o'tkazish"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/25 text-[11px] font-bold">
                1
              </span>
              <Profile2User size={17} variant="Bold" />
              Ro'yxatdan o'tkazish
            </button>

            <button
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-brand-700 shadow-sm transition-all hover:bg-brand-50 active:scale-95 disabled:opacity-60"
              onClick={() => bookGroup("order")}
              disabled={busyId === "group"}
              title="Barchasiga buyurtma berish (slot ochiq bo'lsa)"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700">
                2
              </span>
              <Send2 size={17} variant="Bold" />
              {busyId === "group" ? "Yuborilyapti..." : "Buyurtma (GO)"}
            </button>

            <div className="mx-1 h-7 w-px bg-white/20" />

            <a
              href={`/api/groups/${group.id}/report`}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/25 transition-all hover:bg-white/20 active:scale-95"
              title="Excel hisobotni yuklab olish"
            >
              <DocumentDownload size={18} />
            </a>
            <button
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold ring-1 backdrop-blur transition-all active:scale-95 disabled:opacity-60 ${
                group.paused
                  ? "bg-amber-400 text-amber-950 ring-amber-300 hover:bg-amber-300"
                  : "bg-white/15 text-white ring-white/25 hover:bg-white/25"
              }`}
              onClick={togglePause}
              disabled={busyId === "group"}
              title={
                group.paused
                  ? "Pauzadan chiqarish — slot ochilsa GO ga qo'shiladi"
                  : "Pauzaga qo'yish — slot ochilsa ham GO ga qo'shilmaydi"
              }
            >
              {group.paused ? (
                <>
                  <Play size={17} variant="Bold" />
                  Pauzadan chiqarish
                </>
              ) : (
                <>
                  <Pause size={17} variant="Bold" />
                  Pauza
                </>
              )}
            </button>
            <button
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/25 transition-all hover:bg-white/20 active:scale-95"
              onClick={archiveGroup}
              title="Guruhni arxivlash"
            >
              <Archive size={18} />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 divide-x divide-white/15 border-t border-white/15 text-center">
          <HeaderStat label="Jami" value={total} />
          <HeaderStat label="To'liq" value={completeCount} />
          <HeaderStat label="Ro'yxatdan o'tgan" value={registered} />
          <HeaderStat label="Buyurtma berilgan" value={ordered} />
        </div>
        <div className="border-t border-white/15 px-6 py-3 text-xs text-white/80">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-white/90">
              {waitingSlot ? "Slot ochilishini kutilmoqda" : "Jarayon holati"}
            </span>
            {group.slot ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2 py-1">
                <Calendar size={13} variant="Bold" className="text-white/70" />
                Slot: <span className="font-semibold">{group.slot.name}</span>
                <span className="text-white/50">— monitoring slot darajasida</span>
              </span>
            ) : (
              <span className="text-white/60">Slotga bog'lanmagan</span>
            )}
          </div>
        </div>
      </div>

      {/* Guruh sanasi — header tashqarisida (popover kesilmasligi uchun) */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-soft dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
          <Calendar size={16} variant="Bold" className="text-brand-500" />
          Guruh sanasi
        </div>
        <div className="w-[230px]">
          <DateTimePicker value={slotOpenAt} onChange={saveSlotDate} />
        </div>
        {savingDate && (
          <span className="text-xs text-slate-400">saqlanmoqda…</span>
        )}
        {slotOpenAt && (
          <button
            type="button"
            onClick={() => saveSlotDate("")}
            className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
          >
            Tozalash
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400">
          Bu guruhning mo'ljal sanasi — monitoring slot darajasida ketadi
        </span>
      </div>

      <p className="text-xs text-slate-400">
        Status faqat tizim tomonidan o'zgaradi (zakas / skript natijasi). Qo'lda
        faqat <span className="font-medium text-slate-500">Arxivlash</span>
        &nbsp;mumkin.
      </p>

      {/* Qidiruv + filtr */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:min-w-[260px]">
          <SearchNormal1
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ism, familiya, pasport, email yoki telefon..."
          />
        </div>
        <Select
          className="min-w-[200px]"
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder="Barcha statuslar"
          leftIcon={
            <Filter
              size={16}
              variant="Bold"
              className={statusFilter ? "text-brand-600" : "text-slate-400"}
            />
          }
          options={[
            { value: "", label: "Barcha statuslar" },
            ...APPLICANT_STATUS_KEYS.map((k) => ({
              value: k,
              label: APPLICANT_STATUS[k].label,
            })),
          ]}
        />
      </div>

      {/* Jadval */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[1040px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Familiya / Ism</th>
              <th className="px-4 py-3 font-medium">Pasport</th>
              <th className="px-4 py-3 font-medium">Tug'ilgan</th>
              <th className="px-4 py-3 font-medium">Email / Parol</th>
              <th className="px-4 py-3 font-medium">To'liq</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Amallar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paged.map((a, i) => {
              const archived = a.status === "ARCHIVED";
              return (
                <tr
                  key={a.id}
                  className={`transition hover:bg-slate-50/70 ${
                    archived ? "opacity-50" : ""
                  }`}
                >
                  <td className="px-4 py-3 text-slate-400">
                    {(safePage - 1) * PER_PAGE + i + 1}
                  </td>
                  <td className="px-4 py-3">
                    <NameCell surname={a.surname} name={a.name} phone={a.phone} />
                    {a.subcategory && (
                      <p className="text-xs text-slate-400">{a.subcategory}</p>
                    )}
                  </td>                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {a.passportNumber}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {a.birthdate || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <CredentialCell
                      email={a.generatedEmail}
                      password={
                        a.generatedPassword ||
                        buildPassword(a.name, a.surname, a.passportNumber)
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    {a.complete ? (
                      <TickCircle
                        size={18}
                        variant="Bold"
                        className="text-emerald-500"
                      />
                    ) : (
                      <Warning2
                        size={18}
                        variant="Bold"
                        className="text-amber-500"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {a.status === "FAILED" && (a.errorStage || a.errorNote) ? (
                      <div className="max-w-[240px] rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 py-1.5 dark:border-rose-500/30 dark:bg-rose-500/10">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                          <CloseCircle size={13} variant="Bold" />
                          {a.errorStage === "order"
                            ? "Buyurtmada xato"
                            : a.errorStage === "register"
                            ? "Ro'yxatda xato"
                            : "Xatolik"}
                        </div>
                        {a.errorNote && (
                          <p
                            className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400"
                            title={a.errorNote}
                          >
                            {a.errorNote}
                          </p>
                        )}
                      </div>
                    ) : (
                      <StatusBadge status={a.status} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <RowBtn onClick={() => setEditing(a)} title="Tahrirlash">
                        <Edit2 size={16} />
                      </RowBtn>
                      {/* 1-bosqich: ro'yxatdan o'tkazish (yangi/tahrirlangan) */}
                      {(a.status === "NEW" ||
                        a.status === "EDITED" ||
                        a.status === "BOOKING") && (
                        <button
                          className="pill-indigo"
                          onClick={() => bookApplicant(a.id, "register")}
                          disabled={busyId === a.id}
                          title="Ro'yxatdan o'tkazish"
                        >
                          {busyId === a.id ? (
                            <Refresh size={14} className="animate-spin" />
                          ) : (
                            <Flash size={14} variant="Bold" />
                          )}
                          Ro'yxat
                        </button>
                      )}
                      {/* 2-bosqich: buyurtma berish (ro'yxatdan o'tgandan keyin) */}
                      {a.status === "REGISTERED" && (
                        <button
                          className="pill-violet"
                          onClick={() => bookApplicant(a.id, "order")}
                          disabled={busyId === a.id}
                          title="Buyurtma berish"
                        >
                          {busyId === a.id ? (
                            <Refresh size={14} className="animate-spin" />
                          ) : (
                            <TickCircle size={14} variant="Bold" />
                          )}
                          Buyurtma
                        </button>
                      )}
                      {ARCHIVABLE.includes(a.status) && (
                        <RowBtn
                          onClick={() => archiveApplicant(a.id)}
                          title="Arxivlash (o'chirish)"
                        >
                          <Archive size={16} />
                        </RowBtn>
                      )}
                      {/* PDF faqat buyurtma berilgandan keyin ko'rinadi */}
                      {(a.status === "ORDERED" || a.status === "BOOKED") && (
                        <a
                          className="pill-emerald"
                          href={`/api/applicants/${a.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <DocumentDownload size={14} variant="Bold" /> PDF
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {paged.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-slate-400"
                >
                  {search || statusFilter
                    ? "Filtrga mos arizachi topilmadi"
                    : "Bu guruhda arizachi yo'q"}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3.5">
            <p className="text-xs text-slate-400">
              Jami{" "}
              <span className="font-medium text-slate-600">
                {filtered.length}
              </span>{" "}
              ta ┬╖ {safePage}/{totalPages}-sahifa
            </p>
            <div className="flex items-center gap-1">
              <button
                className="icon-btn disabled:opacity-40"
                onClick={() => setPage(safePage - 1)}
                disabled={safePage <= 1}
                aria-label="Oldingi"
              >
                <ArrowLeft2 size={16} />
              </button>
              {Array.from({ length: totalPages }, (_, idx) => idx + 1)
                .filter(
                  (p) =>
                    p === 1 ||
                    p === totalPages ||
                    Math.abs(p - safePage) <= 1,
                )
                .map((p, idx, arr) => {
                  const prev = arr[idx - 1];
                  const gap = prev && p - prev > 1;
                  return (
                    <span key={p} className="flex items-center">
                      {gap && (
                        <span className="px-1.5 text-sm text-slate-400">
                          …
                        </span>
                      )}
                      <button
                        onClick={() => setPage(p)}
                        className={`min-w-8 rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
                          p === safePage
                            ? "bg-brand-600 text-white shadow-sm"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {p}
                      </button>
                    </span>
                  );
                })}
              <button
                className="icon-btn disabled:opacity-40"
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= totalPages}
                aria-label="Keyingi"
              >
                <ArrowRight2 size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {editing && (
        <EditModal
          applicant={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}

      {adding && (
        <AddModal
          groupId={group.id}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-4 py-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-white/60">{label}</p>
    </div>
  );
}

function RowBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="icon-btn"
    >
      {children}
    </button>
  );
}

function EditModal({
  applicant,
  onClose,
  onSaved,
}: {
  applicant: Applicant;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(applicant);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [personPhoto, setPersonPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  function set<K extends keyof Applicant>(key: K, value: Applicant[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function fillFromPassport(p: PassportFields) {
    // Excel'dagi pasport bilan solishtiramiz. Mos kelmasa — formani
    // o'zgartirmaymiz va ogohlantiramiz (boshqa odamning passporti bo'lishi mumkin).
    const norm = (s: string) => (s || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
    const scanned = norm(p.passportNumber);
    const existing = norm(applicant.passportNumber);
    if (existing && scanned && scanned !== existing) {
      toast(
        `Pasport mos kelmadi: Excel ${applicant.passportNumber} ≠ skan ${p.passportNumber}`,
        "error",
      );
      return;
    }
    setForm((f) => ({
      ...f,
      surname: p.surname || f.surname,
      name: p.name || f.name,
      passportNumber: p.passportNumber || f.passportNumber,
      nationality: p.nationality || f.nationality,
      birthdate: p.birthdate || f.birthdate,
      gender: p.gender || f.gender,
      passportValidity: p.passportValidity || f.passportValidity,
    }));
    toast("Pasport mos keldi — forma to'ldirildi");
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/applicants/${applicant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surname: form.surname,
          name: form.name,
          passportNumber: form.passportNumber,
          nationality: form.nationality,
          gender: form.gender,
          birthdate: form.birthdate,
          passportValidity: form.passportValidity,
          phone: form.phone,
          email: form.email,
          generatedEmail: form.generatedEmail,
          category: form.category,
          subcategory: form.subcategory,
          appointmentRef: form.appointmentRef,
        }),
      });
      if (!res.ok) {
        toast("Saqlashda xatolik", "error");
        return;
      }
      // Yangi passport rasmi tanlangan bo'lsa, asl formatida saqlaymiz.
      if (photoFile) {
        const fd = new FormData();
        fd.append("file", photoFile);
        await fetch(`/api/applicants/${applicant.id}/photo`, {
          method: "POST",
          body: fd,
        });
      }
      // Standartlashtirilgan portret (600x600 JPEG) — shaxs bazasiga.
      if (personPhoto) {
        const fd = new FormData();
        fd.append("file", personPhoto);
        await fetch(`/api/applicants/${applicant.id}/person-photo`, {
          method: "POST",
          body: fd,
        });
      }
      toast("Ma'lumotlar saqlandi");
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Arizachini tahrirlash
            </h3>
            <p className="text-xs text-slate-400">
              Status tizim tomonidan boshqariladi — bu yerda faqat ma'lumotlar.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <CloseCircle size={22} />
          </button>
        </div>

        <div className="mb-5">
          <PassportReader
            onFill={fillFromPassport}
            onImage={setPhotoFile}
            onPhoto={setPersonPhoto}
          />
        </div>

        {applicant.passportPhoto && (
          <div className="mb-5 flex items-center gap-3 rounded-lg bg-slate-50 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={applicant.passportPhoto}
              alt="passport"
              className="h-16 w-24 rounded object-cover ring-1 ring-slate-200"
            />
            <div className="text-sm">
              <p className="font-medium text-slate-700">Saqlangan passport rasmi</p>
              <a
                href={applicant.passportPhoto}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand-600 hover:underline"
              >
                To'liq ko'rish
              </a>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Familiya" value={form.surname} onChange={(v) => set("surname", v)} />
          <Field label="Ism" value={form.name} onChange={(v) => set("name", v)} />
          <Field label="Pasport" value={form.passportNumber} onChange={(v) => set("passportNumber", v)} />
          <SelectField label="Davlat (millat)" value={form.nationality ?? ""} onChange={(v) => set("nationality", v)} options={COUNTRIES} placeholder="Davlatni tanlang" />
          <SelectField label="Jins" value={form.gender ?? ""} onChange={(v) => set("gender", v)} options={GENDERS} placeholder="Jinsni tanlang" />
          <Field label="Tug'ilgan sana" value={form.birthdate ?? ""} onChange={(v) => set("birthdate", v)} />
          <Field label="Pasport amal muddati" value={form.passportValidity ?? ""} onChange={(v) => set("passportValidity", v)} />
          <Field label="Telefon" value={form.phone ?? ""} onChange={(v) => set("phone", v)} />
          <Field label="Email (Excel)" value={form.email ?? ""} onChange={(v) => set("email", v)} />
          <div>
            <div className="flex items-center justify-between">
              <label className="label">Tizim email</label>
              <button
                type="button"
                className="text-xs font-medium text-brand-600 hover:underline"
                onClick={() =>
                  set(
                    "generatedEmail",
                    buildEmail(form.name, form.surname, applicant.id),
                  )
                }
              >
                Generatsiya
              </button>
            </div>
            <input
              className="input"
              value={form.generatedEmail ?? ""}
              onChange={(e) => set("generatedEmail", e.target.value)}
            />
          </div>
          <SelectField label="Kategoriya" value={form.category ?? ""} onChange={(v) => set("category", v)} options={CATEGORIES} placeholder="Kategoriyani tanlang" />
          <SelectField label="Subkategoriya" value={form.subcategory ?? ""} onChange={(v) => set("subcategory", v)} options={SUBCATEGORIES} placeholder="Subkategoriyani tanlang" />
          <Field label="Appointment raqami" value={form.appointmentRef ?? ""} onChange={(v) => set("appointmentRef", v)} />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? "Saqlanyapti..." : "Saqlash"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <Select
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder ?? "Tanlang"}
      />
    </div>
  );
}

type NewApplicant = {
  surname: string;
  name: string;
  passportNumber: string;
  nationality: string;
  gender: string;
  birthdate: string;
  passportValidity: string;
  phone: string;
  email: string;
  category: string;
  subcategory: string;
  generatedEmail: string;
};

const EMPTY_APPLICANT: NewApplicant = {
  surname: "",
  name: "",
  passportNumber: "",
  nationality: DEFAULT_COUNTRY, // rasm bo'lmasa default UZB
  gender: "",
  birthdate: "",
  passportValidity: "",
  phone: "",
  email: "",
  category: "",
  subcategory: "",
  generatedEmail: "",
};

function AddModal({
  groupId,
  onClose,
  onSaved,
}: {
  groupId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<NewApplicant>(EMPTY_APPLICANT);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [emailTouched, setEmailTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();

  function set<K extends keyof NewApplicant>(key: K, value: NewApplicant[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Email avtomatik generatsiya: ism/familiya o'zgarsa, qo'lda tegmagan bo'lsa.
  useEffect(() => {
    if (emailTouched) return;
    if (!form.name.trim() || !form.surname.trim()) return;
    const auto = buildEmail(form.name, form.surname);
    setForm((f) => (f.generatedEmail === auto ? f : { ...f, generatedEmail: auto }));
  }, [form.name, form.surname, emailTouched]);

  function fillFromPassport(p: PassportFields) {
    setForm((f) => ({
      ...f,
      surname: p.surname || f.surname,
      name: p.name || f.name,
      passportNumber: p.passportNumber || f.passportNumber,
      nationality: p.nationality || f.nationality,
      birthdate: p.birthdate || f.birthdate,
      gender: p.gender || f.gender,
      passportValidity: p.passportValidity || f.passportValidity,
    }));
  }

  async function save() {
    if (
      !form.surname.trim() ||
      !form.name.trim() ||
      !form.passportNumber.trim()
    ) {
      setError("Familiya, Ism va Pasport raqami majburiy");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/groups/${groupId}/applicants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Xatolik");
        return;
      }
      // Passport rasmini asl formatida saqlaymiz.
      if (photoFile && data.applicant?.id) {
        const fd = new FormData();
        fd.append("file", photoFile);
        await fetch(`/api/applicants/${data.applicant.id}/photo`, {
          method: "POST",
          body: fd,
        });
      }
      toast("Yangi arizachi qo'shildi");
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Yangi arizachi qo'shish
            </h3>
            <p className="text-xs text-slate-400">
              Passport rasmidan o'qing yoki formani qo'lda to'ldiring.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <CloseCircle size={22} />
          </button>
        </div>

        <div className="mb-5">
          <PassportReader onFill={fillFromPassport} onImage={setPhotoFile} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Familiya *" value={form.surname} onChange={(v) => set("surname", v)} />
          <Field label="Ism *" value={form.name} onChange={(v) => set("name", v)} />
          <Field label="Pasport *" value={form.passportNumber} onChange={(v) => set("passportNumber", v)} />
          <SelectField label="Davlat (millat)" value={form.nationality} onChange={(v) => set("nationality", v)} options={COUNTRIES} placeholder="Davlatni tanlang" />
          <SelectField label="Jins" value={form.gender} onChange={(v) => set("gender", v)} options={GENDERS} placeholder="Jinsni tanlang" />
          <Field label="Tug'ilgan sana" value={form.birthdate} onChange={(v) => set("birthdate", v)} />
          <Field label="Pasport amal muddati" value={form.passportValidity} onChange={(v) => set("passportValidity", v)} />
          <Field label="Telefon" value={form.phone} onChange={(v) => set("phone", v)} />
          <Field label="Email (shaxsiy)" value={form.email} onChange={(v) => set("email", v)} />
          <Field
            label="Tizim email (avtomatik)"
            value={form.generatedEmail}
            onChange={(v) => {
              setEmailTouched(true);
              set("generatedEmail", v);
            }}
          />
          <SelectField label="Kategoriya" value={form.category} onChange={(v) => set("category", v)} options={CATEGORIES} placeholder="Kategoriyani tanlang" />
          <SelectField label="Subkategoriya" value={form.subcategory} onChange={(v) => set("subcategory", v)} options={SUBCATEGORIES} placeholder="Subkategoriyani tanlang" />
        </div>

        {error && (
          <p className="mt-4 flex items-center gap-1.5 text-sm text-red-600">
            <Warning2 size={16} /> {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Bekor qilish
          </button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? "Qo'shilyapti..." : "Qo'shish"}
          </button>
        </div>
      </div>
    </div>
  );
}
