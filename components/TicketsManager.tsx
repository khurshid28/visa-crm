"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Add,
  Ticket as TicketIcon,
  SearchNormal1,
  CloseCircle,
  Edit2,
  Archive,
  ArchiveTick,
  Trash,
  Calendar,
  Gallery,
  Tag,
  Link21,
  DocumentText,
  Profile2User,
  People,
  Clock,
  Send2,
  DocumentDownload,
  Paperclip2,
  ArrowLeft2,
} from "iconsax-react";
import { useToast } from "@/components/Toast";
import Select from "@/components/Select";
import DatePicker from "@/components/DatePicker";
import { fmtDateTime } from "@/lib/date";
import {
  TICKET_STATUS,
  TICKET_STATUS_KEYS,
  TICKET_SOURCE,
  TICKET_SOURCE_KEYS,
  TICKET_REF_KIND,
  type TicketView,
  type TicketRefView,
  type TicketRefKind,
  type TicketAttachmentView,
} from "@/lib/tickets";

const STATUS_TONE: Record<string, string> = {
  amber:
    "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300",
  blue: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300",
  violet:
    "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300",
  emerald:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300",
};

const REF_ICON: Record<TicketRefKind, typeof Clock> = {
  slot: Clock,
  group: Profile2User,
  user: People,
  document: DocumentText,
};

const STATUS_OPTIONS = TICKET_STATUS_KEYS.map((k) => ({
  value: k,
  label: TICKET_STATUS[k].label,
}));
const SOURCE_OPTIONS = TICKET_SOURCE_KEYS.map((k) => ({
  value: k,
  label: TICKET_SOURCE[k].label,
}));

function fmtBytes(n: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

function StatusPill({ status }: { status: string }) {
  const meta = TICKET_STATUS[status as keyof typeof TICKET_STATUS];
  const tone = STATUS_TONE[meta?.tone ?? "amber"] ?? STATUS_TONE.amber;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${tone}`}
    >
      {meta?.label ?? status}
    </span>
  );
}

function RefChip({ r }: { r: TicketRefView }) {
  const Icon = REF_ICON[r.kind] ?? Link21;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      <Icon size={13} variant="Bold" className="text-brand-500" />
      <span className="text-[10px] uppercase tracking-wide text-slate-400">
        {TICKET_REF_KIND[r.kind]?.label ?? r.kind}
      </span>
      <span className="max-w-[160px] truncate">{r.label}</span>
    </span>
  );
}

// Bitta biriktirilgan fayl — rasm bo'lsa katak, hujjat bo'lsa yuklab olish chipi.
function Attachment({
  a,
  onRemove,
}: {
  a: TicketAttachmentView;
  onRemove?: () => void;
}) {
  if (a.kind === "image") {
    return (
      <div className="group/att relative h-28 w-28 overflow-hidden rounded-xl ring-1 ring-black/10 dark:ring-white/10">
        <a href={a.url} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={a.url}
            alt={a.name ?? ""}
            className="h-full w-full object-cover transition-transform hover:scale-105"
          />
        </a>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-rose-600/90 text-white opacity-0 transition-opacity group-hover/att:opacity-100"
          >
            <CloseCircle size={14} />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-600 dark:bg-brand-500/20">
        <DocumentText size={18} variant="Bold" />
      </span>
      <div className="min-w-0">
        <a
          href={a.url}
          target="_blank"
          rel="noreferrer"
          className="block max-w-[180px] truncate text-sm font-medium text-slate-700 hover:text-brand-600 dark:text-slate-200"
        >
          {a.name ?? "Hujjat"}
        </a>
        <span className="text-[11px] text-slate-400">{fmtBytes(a.size)}</span>
      </div>
      <a
        href={a.url}
        target="_blank"
        rel="noreferrer"
        className="ml-1 grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-brand-600 dark:hover:bg-slate-700"
        title="Yuklab olish"
      >
        <DocumentDownload size={16} />
      </a>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-500/10"
        >
          <CloseCircle size={16} />
        </button>
      )}
    </div>
  );
}

type RefDraft = { kind: TicketRefKind; refId: number; label: string };

export default function TicketsManager({
  initial,
}: {
  initial: TicketView[];
}) {
  const { toast, confirm } = useToast();
  const [tickets, setTickets] = useState<TicketView[]>(initial);
  const [tab, setTab] = useState<"active" | "archive">("active");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<TicketView | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("archived", tab === "archive" ? "1" : "0");
      if (q.trim()) params.set("q", q.trim());
      if (from) params.set("from", new Date(from).toISOString());
      if (to) {
        const d = new Date(to);
        d.setHours(23, 59, 59, 999);
        params.set("to", d.toISOString());
      }
      const res = await fetch(`/api/tickets?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.tickets) setTickets(data.tickets as TicketView[]);
    } finally {
      setLoading(false);
    }
  }, [tab, q, from, to]);

  // Tab yoki sana o'zgarsa darhol yuklaymiz; qidiruvni debounce qilamiz.
  useEffect(() => {
    const id = window.setTimeout(load, q ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [load, q]);

  async function setStatus(t: TicketView, status: string) {
    const res = await fetch(`/api/tickets/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      toast("Status yangilandi", "success");
      load();
    } else {
      toast("Xatolik", "error");
    }
  }

  async function archive(t: TicketView, archived: boolean) {
    const res = await fetch(`/api/tickets/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    if (res.ok) {
      toast(archived ? "Arxivlandi" : "Arxivdan chiqarildi", "success");
      load();
    } else {
      toast("Xatolik", "error");
    }
  }

  async function remove(t: TicketView) {
    const ok = await confirm({
      title: "Tiketni o'chirish",
      message: `"${t.title}" butunlay o'chiriladi. Bu amalni qaytarib bo'lmaydi.`,
      confirmLabel: "O'chirish",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/tickets/${t.id}`, { method: "DELETE" });
    if (res.ok) {
      toast("O'chirildi", "success");
      load();
    } else {
      toast("Xatolik", "error");
    }
  }

  function clearFilters() {
    setQ("");
    setFrom("");
    setTo("");
  }

  const hasFilters = q || from || to;
  const openTicket = tickets.find((t) => t.id === openId) ?? null;

  return (
    <div className="space-y-5">
      {/* Sarlavha */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10">
            <TicketIcon size={20} variant="Bold" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
              Tiketlar
            </h1>
            <p className="text-xs text-slate-400">
              Ichki so'rovlar, muammolar va vazifalar
            </p>
          </div>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-brand-700"
        >
          <Add size={18} /> Yangi tiket
        </button>
      </div>

      {/* Tablar */}
      <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {(
          [
            { key: "active", label: "Asosiy", icon: TicketIcon },
            { key: "archive", label: "Arxiv", icon: Archive },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-all ${
                isActive
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              }`}
            >
              <Icon size={16} variant={isActive ? "Bold" : "Linear"} />
              {t.label}
              {isActive && tickets.length > 0 && (
                <span className="ml-0.5 rounded-full bg-white/25 px-1.5 text-xs font-bold tabular-nums">
                  {tickets.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Qidiruv va sana filtrlari */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <label className="relative min-w-[200px] flex-1">
          <SearchNormal1
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Sarlavha, matn, xabarlar, hashteg, obyekt..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>
        <div className="flex flex-col gap-1 text-xs text-slate-400">
          Dan
          <div className="w-40">
            <DatePicker value={from} onChange={setFrom} placeholder="Boshlanish" />
          </div>
        </div>
        <div className="flex flex-col gap-1 text-xs text-slate-400">
          Gacha
          <div className="w-40">
            <DatePicker value={to} onChange={setTo} placeholder="Tugash" />
          </div>
        </div>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <CloseCircle size={16} /> Tozalash
          </button>
        )}
      </div>

      {/* Ro'yxat */}
      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">
          Yuklanmoqda...
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 py-16 text-center dark:border-slate-700">
          <TicketIcon
            size={36}
            variant="Bold"
            className="mx-auto mb-2 text-slate-300"
          />
          <p className="text-sm text-slate-400">
            {tab === "archive"
              ? "Arxivda tiket yo'q"
              : hasFilters
                ? "Filtrga mos tiket topilmadi"
                : "Hozircha tiket yo'q. Yangi tiket qo'shing."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <TicketCard
              key={t.id}
              ticket={t}
              archived={tab === "archive"}
              onOpen={() => setOpenId(t.id)}
              onEdit={() => setEditing(t)}
              onStatus={(s) => setStatus(t, s)}
              onArchive={() => archive(t, tab !== "archive")}
              onDelete={() => remove(t)}
            />
          ))}
        </div>
      )}

      {openTicket && (
        <TicketDetail
          ticket={openTicket}
          onClose={() => setOpenId(null)}
          onChanged={load}
          onEdit={() => setEditing(openTicket)}
        />
      )}

      {(creating || editing) && (
        <TicketModal
          ticket={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(id) => {
            setCreating(false);
            setEditing(null);
            load();
            if (id) setOpenId(id);
          }}
        />
      )}
    </div>
  );
}

function TicketCard({
  ticket,
  archived,
  onOpen,
  onEdit,
  onStatus,
  onArchive,
  onDelete,
}: {
  ticket: TicketView;
  archived: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onStatus: (s: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const allShots = [
    ...ticket.attachments,
    ...ticket.entries.flatMap((e) => e.attachments),
  ];
  const images = allShots.filter((a) => a.kind === "image");
  const files = allShots.filter((a) => a.kind !== "image");
  const msgCount = ticket.entries.length + (ticket.body ? 1 : 0);

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-slate-800 hover:text-brand-600 dark:text-slate-100">
              {ticket.title}
            </h3>
            <StatusPill status={ticket.status} />
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {TICKET_SOURCE[ticket.source as keyof typeof TICKET_SOURCE]
                ?.label ?? ticket.source}
            </span>
          </div>
          {ticket.body && (
            <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-sm text-slate-500 dark:text-slate-400">
              {ticket.body}
            </p>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onEdit}
            title="Tahrirlash"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
          >
            <Edit2 size={16} />
          </button>
          <button
            onClick={onArchive}
            title={archived ? "Arxivdan chiqarish" : "Arxivlash"}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-amber-600 dark:hover:bg-slate-800"
          >
            {archived ? <ArchiveTick size={16} /> : <Archive size={16} />}
          </button>
          <button
            onClick={onDelete}
            title="O'chirish"
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
          >
            <Trash size={16} />
          </button>
        </div>
      </div>

      {/* Bog'langan obyektlar */}
      {ticket.refs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ticket.refs.map((r) => (
            <RefChip key={r.id} r={r} />
          ))}
        </div>
      )}

      {/* Hashteglar */}
      {ticket.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ticket.tags.map((tg) => (
            <span
              key={tg}
              className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-600 dark:text-brand-400"
            >
              <Tag size={12} variant="Bold" />#{tg}
            </span>
          ))}
        </div>
      )}

      {/* Rasm preview (kichik) */}
      {images.length > 0 && (
        <button onClick={onOpen} className="mt-3 flex flex-wrap gap-2">
          {images.slice(0, 5).map((s) => (
            <span
              key={s.id}
              className="block h-14 w-14 overflow-hidden rounded-lg ring-1 ring-slate-200 dark:ring-slate-700"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt="" className="h-full w-full object-cover" />
            </span>
          ))}
          {images.length > 5 && (
            <span className="grid h-14 w-14 place-items-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-500 dark:bg-slate-800">
              +{images.length - 5}
            </span>
          )}
        </button>
      )}

      {/* Pastki qator: muallif, sanalar, hisoblagichlar */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-2.5 text-xs text-slate-400 dark:border-slate-800">
        <span className="inline-flex items-center gap-1">
          <Calendar size={13} /> {fmtDateTime(ticket.createdAt)}
        </span>
        {ticket.author && <span>· {ticket.author}</span>}
        {msgCount > 1 && (
          <span className="inline-flex items-center gap-1">
            <Send2 size={13} /> {msgCount} xabar
          </span>
        )}
        {images.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <Gallery size={13} /> {images.length}
          </span>
        )}
        {files.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <DocumentText size={13} /> {files.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {TICKET_STATUS_KEYS.filter((k) => k !== ticket.status).map((k) => (
            <button
              key={k}
              onClick={() => onStatus(k)}
              className="rounded-md px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-700 dark:ring-slate-700 dark:hover:bg-slate-800"
            >
              → {TICKET_STATUS[k].label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Telegram uslubidagi tiket ichi: xabarlar zanjiri + pastda yozish qatori.
function TicketDetail({
  ticket,
  onClose,
  onChanged,
  onEdit,
}: {
  ticket: TicketView;
  onClose: () => void;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const { toast, confirm } = useToast();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  // Yangi xabar qo'shilganda pastga aylantiramiz.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ticket.entries.length]);

  // Escape — yopish.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const room = 10 - files.length;
    setFiles((p) => [...p, ...Array.from(list).slice(0, Math.max(0, room))]);
  }

  async function send() {
    if (!text.trim() && files.length === 0) return;
    setSending(true);
    try {
      // 1) Matnli xabar yaratamiz (matn bo'sh bo'lsa "·" — faqat fayl uchun).
      const res = await fetch(`/api/tickets/${ticket.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text.trim() || "·" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.entry) throw new Error();
      const entryId = data.entry.id as number;

      // 2) Fayllarni shu xabarga biriktiramiz.
      if (files.length > 0) {
        const fd = new FormData();
        fd.append("entryId", String(entryId));
        files.forEach((f) => fd.append("files", f));
        await fetch(`/api/tickets/${ticket.id}/attachments`, {
          method: "POST",
          body: fd,
        });
      }

      setText("");
      setFiles([]);
      onChanged();
    } catch {
      toast("Xabar yuborilmadi", "error");
    } finally {
      setSending(false);
    }
  }

  async function deleteEntry(eid: number) {
    const ok = await confirm({
      title: "Xabarni o'chirish",
      message: "Bu xabar va undagi fayllar o'chiriladi.",
      confirmLabel: "O'chirish",
      danger: true,
    });
    if (!ok) return;
    const res = await fetch(`/api/tickets/${ticket.id}/entries/${eid}`, {
      method: "DELETE",
    });
    if (res.ok) onChanged();
    else toast("Xatolik", "error");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => {
        // Chetga (fon) bosilsa — yopiladi.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden bg-slate-50 shadow-2xl dark:bg-slate-950 sm:h-[88vh] sm:rounded-2xl">
        {/* Sarlavha */}
        <div className="flex items-start gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <button
            onClick={onClose}
            title="Orqaga"
            className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <ArrowLeft2 size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-bold text-slate-800 dark:text-slate-100">
                {ticket.title}
              </h2>
              <StatusPill status={ticket.status} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
              <span>
                {TICKET_SOURCE[ticket.source as keyof typeof TICKET_SOURCE]
                  ?.label ?? ticket.source}
              </span>
              <span className="inline-flex items-center gap-1">
                <Calendar size={12} /> {fmtDateTime(ticket.createdAt)}
              </span>
              {ticket.author && <span>· {ticket.author}</span>}
            </div>
          </div>
          <button
            onClick={onEdit}
            title="Tahrirlash"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
          >
            <Edit2 size={16} />
          </button>
          <button
            onClick={onClose}
            title="Yopish"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-slate-800"
          >
            <CloseCircle size={18} />
          </button>
        </div>

        {/* Refs + teglar */}
        {(ticket.refs.length > 0 || ticket.tags.length > 0) && (
          <div className="flex flex-wrap gap-1.5 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
            {ticket.refs.map((r) => (
              <RefChip key={r.id} r={r} />
            ))}
            {ticket.tags.map((tg) => (
              <span
                key={tg}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-600 dark:text-brand-400"
              >
                <Tag size={12} variant="Bold" />#{tg}
              </span>
            ))}
          </div>
        )}

        {/* Xabarlar zanjiri (Telegram uslubi) */}
        <div
          ref={threadRef}
          className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
        >
          {ticket.body && (
            <Bubble
              body={ticket.body}
              author={ticket.author}
              createdAt={ticket.createdAt}
              attachments={ticket.attachments}
              first
            />
          )}
          {ticket.entries.map((e) => (
            <Bubble
              key={e.id}
              body={e.body}
              author={e.author}
              createdAt={e.createdAt}
              attachments={e.attachments}
              onDelete={() => deleteEntry(e.id)}
            />
          ))}
          {!ticket.body && ticket.entries.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-400">
              Hali xabar yo'q. Pastdan yozing.
            </p>
          )}
        </div>

        {/* Yozish qatori */}
        <div className="border-t border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg bg-slate-100 py-1 pl-1 pr-2 dark:bg-slate-800"
                >
                  {isImage(f) ? (
                    <span className="h-10 w-10 overflow-hidden rounded-md">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={URL.createObjectURL(f)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </span>
                  ) : (
                    <span className="grid h-10 w-10 place-items-center rounded-md bg-brand-100 text-brand-600 dark:bg-brand-500/20">
                      <DocumentText size={18} variant="Bold" />
                    </span>
                  )}
                  <span className="max-w-[120px] truncate text-xs text-slate-600 dark:text-slate-300">
                    {f.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                    className="text-slate-400 hover:text-rose-500"
                  >
                    <CloseCircle size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              title="Rasm"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
            >
              <Gallery size={20} />
            </button>
            <button
              type="button"
              onClick={() => docInput.current?.click()}
              title="Hujjat"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
            >
              <Paperclip2 size={20} />
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                pickFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={docInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                pickFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Xabar yozing... (Ctrl+Enter — yuborish)"
              className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              onClick={send}
              disabled={sending || (!text.trim() && files.length === 0)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-40"
            >
              <Send2 size={18} variant="Bold" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  body,
  author,
  createdAt,
  attachments,
  first = false,
  onDelete,
}: {
  body: string | null;
  author: string | null;
  createdAt: string;
  attachments: TicketAttachmentView[];
  first?: boolean;
  onDelete?: () => void;
}) {
  const images = attachments.filter((a) => a.kind === "image");
  const docs = attachments.filter((a) => a.kind !== "image");
  const showBody = body && body !== "·";

  return (
    <div className="group flex flex-col">
      <div
        className={`relative max-w-[85%] self-start rounded-2xl px-3.5 py-2.5 shadow-sm ${
          first
            ? "bg-brand-50 ring-1 ring-brand-100 dark:bg-brand-500/10 dark:ring-brand-500/20"
            : "bg-white ring-1 ring-slate-100 dark:bg-slate-900 dark:ring-slate-800"
        }`}
      >
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((a) => (
              <Attachment key={a.id} a={a} />
            ))}
          </div>
        )}
        {docs.length > 0 && (
          <div className="mb-2 flex flex-col gap-1.5">
            {docs.map((a) => (
              <Attachment key={a.id} a={a} />
            ))}
          </div>
        )}
        {showBody && (
          <p className="whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-200">
            {body}
          </p>
        )}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
          {author && <span className="font-medium">{author}</span>}
          <span>{fmtDateTime(createdAt)}</span>
          {first && (
            <span className="rounded bg-brand-100 px-1.5 py-0.5 font-semibold text-brand-600 dark:bg-brand-500/20 dark:text-brand-300">
              boshlanish
            </span>
          )}
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            title="O'chirish"
            className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-white text-slate-400 opacity-0 shadow ring-1 ring-slate-200 transition-opacity hover:text-rose-600 group-hover:opacity-100 dark:bg-slate-800 dark:ring-slate-700"
          >
            <CloseCircle size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function TicketModal({
  ticket,
  onClose,
  onSaved,
}: {
  ticket: TicketView | null;
  onClose: () => void;
  onSaved: (id?: number) => void;
}) {
  const { toast } = useToast();
  const isEdit = !!ticket;
  const [title, setTitle] = useState(ticket?.title ?? "");
  const [body, setBody] = useState(ticket?.body ?? "");
  const [source, setSource] = useState(ticket?.source ?? "system");
  const [status, setStatus] = useState(ticket?.status ?? "OPEN");
  const [tags, setTags] = useState(
    ticket?.tags.map((t) => `#${t}`).join(" ") ?? "",
  );
  const [refs, setRefs] = useState<RefDraft[]>(
    ticket?.refs.map((r) => ({
      kind: r.kind,
      refId: r.refId,
      label: r.label,
    })) ?? [],
  );
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const room = 10 - files.length;
    setFiles((p) => [...p, ...Array.from(list).slice(0, Math.max(0, room))]);
  }

  async function save() {
    if (!title.trim()) {
      toast("Sarlavha kiriting", "error");
      return;
    }
    setBusy(true);
    try {
      const payload = { title, body, source, status, tags, refs };
      let ticketId = ticket?.id ?? 0;
      if (isEdit) {
        const res = await fetch(`/api/tickets/${ticket!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch(`/api/tickets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ticket) throw new Error();
        ticketId = data.ticket.id;
      }
      // Yangi tiketda boshlang'ich fayllar — tiket darajasiga biriktiramiz.
      if (!isEdit && files.length > 0) {
        const fd = new FormData();
        files.forEach((f) => fd.append("files", f));
        await fetch(`/api/tickets/${ticketId}/attachments`, {
          method: "POST",
          body: fd,
        }).catch(() => {});
      }
      toast(isEdit ? "Saqlandi" : "Tiket yaratildi", "success");
      onSaved(isEdit ? undefined : ticketId);
    } catch {
      toast("Xatolik yuz berdi", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="my-6 w-full max-w-2xl rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">
            {isEdit ? "Tiketni tahrirlash" : "Yangi tiket"}
          </h2>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <CloseCircle size={20} />
          </button>
        </div>

        <div className="max-h-[72vh] space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">
              Sarlavha
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Qisqa sarlavha"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">
              {isEdit ? "Matn" : "Birinchi xabar"}
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="Tiket tafsiloti..."
              className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">
                Manba
              </label>
              <Select
                value={source}
                onChange={setSource}
                options={SOURCE_OPTIONS}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">
                Status
              </label>
              <Select
                value={status}
                onChange={setStatus}
                options={STATUS_OPTIONS}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">
              Hashteglar
            </label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="#slot #shoshilinch #latviya"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          {/* Bog'lanishlar */}
          <RefPicker refs={refs} onChange={setRefs} />

          {/* Boshlang'ich fayllar — faqat yangi tiketda (tahrirda ichida yoziladi) */}
          {!isEdit && (
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-500">
                  Fayllar ({files.length}/10)
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={files.length >= 10}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <Gallery size={14} /> Rasm
                  </button>
                  <button
                    type="button"
                    onClick={() => docInput.current?.click()}
                    disabled={files.length >= 10}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <Paperclip2 size={14} /> Hujjat
                  </button>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    pickFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={docInput}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    pickFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
              {files.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400 dark:border-slate-700">
                  Rasm yoki hujjat qo'shish ixtiyoriy
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-lg bg-slate-100 py-1 pl-1 pr-2 dark:bg-slate-800"
                    >
                      {isImage(f) ? (
                        <span className="h-12 w-12 overflow-hidden rounded-md">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={URL.createObjectURL(f)}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </span>
                      ) : (
                        <span className="grid h-12 w-12 place-items-center rounded-md bg-brand-100 text-brand-600 dark:bg-brand-500/20">
                          <DocumentText size={20} variant="Bold" />
                        </span>
                      )}
                      <span className="max-w-[120px] truncate text-xs text-slate-600 dark:text-slate-300">
                        {f.name}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setFiles((p) => p.filter((_, j) => j !== i))
                        }
                        className="text-slate-400 hover:text-rose-500"
                      >
                        <CloseCircle size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Bekor qilish
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="rounded-xl bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Saqlanmoqda..." : isEdit ? "Saqlash" : "Yaratish"}
          </button>
        </div>
      </div>
    </div>
  );
}

const REF_KIND_OPTIONS = (Object.keys(TICKET_REF_KIND) as TicketRefKind[]).map(
  (k) => ({ value: k, label: TICKET_REF_KIND[k].label }),
);

function RefPicker({
  refs,
  onChange,
}: {
  refs: RefDraft[];
  onChange: (r: RefDraft[]) => void;
}) {
  const [kind, setKind] = useState<TicketRefKind>("slot");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TicketRefView[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(async () => {
      const params = new URLSearchParams({ kind, q: query.trim() });
      const res = await fetch(`/api/tickets/refs?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.results) setResults(data.results as TicketRefView[]);
    }, 250);
    return () => window.clearTimeout(id);
  }, [kind, query, open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function add(r: TicketRefView) {
    if (refs.some((x) => x.kind === r.kind && x.refId === r.refId)) return;
    onChange([...refs, { kind: r.kind, refId: r.refId, label: r.label }]);
    setQuery("");
    setOpen(false);
  }

  function removeRef(i: number) {
    onChange(refs.filter((_, j) => j !== i));
  }

  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-slate-500">
        <Link21 size={14} /> Bog'lanishlar (slot / guruh / user / hujjat)
      </label>
      <div className="flex gap-2">
        <div className="w-32 shrink-0">
          <Select
            value={kind}
            onChange={(v) => {
              setKind(v as TicketRefKind);
              setOpen(true);
            }}
            options={REF_KIND_OPTIONS}
          />
        </div>
        <div ref={boxRef} className="relative flex-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={`${TICKET_REF_KIND[kind].label} qidirish...`}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          {open && results.length > 0 && (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
              {results.map((r) => (
                <button
                  key={`${r.kind}-${r.refId}`}
                  type="button"
                  onClick={() => add(r)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-brand-50 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">
                    {TICKET_REF_KIND[r.kind].label}
                  </span>
                  <span className="truncate">{r.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {refs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {refs.map((r, i) => (
            <span
              key={`${r.kind}-${r.refId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
            >
              <span className="text-[10px] uppercase tracking-wide opacity-60">
                {TICKET_REF_KIND[r.kind].label}
              </span>
              <span className="max-w-[160px] truncate">{r.label}</span>
              <button
                type="button"
                onClick={() => removeRef(i)}
                className="text-brand-400 hover:text-rose-500"
              >
                <CloseCircle size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
