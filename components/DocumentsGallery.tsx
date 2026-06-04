"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Gallery,
  DocumentText,
  Image as ImageIcon,
  Eye,
  DocumentDownload,
  CloseCircle,
  ArrowLeft2,
  ArrowRight2,
  Profile2User,
  TickCircle,
  Calendar,
  Clock,
} from "iconsax-react";
import StatusBadge from "@/components/StatusBadge";
import { APPLICANT_STATUS } from "@/lib/status";

export type DocItem = {
  id: number;
  surname: string;
  name: string;
  passportNumber: string;
  groupId: number;
  groupName: string | null;
  status: string;
  hasPhoto: boolean;
  hasPersonPhoto: boolean;
  canPdf: boolean;
  createdAt: string;
  updatedAt: string;
  pdfAt: string | null;
};

// Sanani chiroyli formatda ko'rsatish.
const UZ_MONTHS = [
  "yan",
  "fev",
  "mar",
  "apr",
  "may",
  "iyn",
  "iyl",
  "avg",
  "sen",
  "okt",
  "noy",
  "dek",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${pad2(d.getDate())} ${UZ_MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fmtDateShort(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${pad2(d.getDate())} ${UZ_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function statusMeta(key: string) {
  return (
    APPLICANT_STATUS[key] ?? { label: key, cls: "bg-slate-100 text-slate-700" }
  );
}

// Faylni brauzerda yuklab olish (blob orqali, to'g'ri nom bilan).
async function downloadFile(url: string, filename: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("yuklab bo'lmadi");
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  } catch {
    // Fallback: yangi tabda ochish.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

// Arizachi uchun fayl nomi negizi: "ISM_FAMILIYA_PASSPORT".
function fileBase(item: DocItem): string {
  return `${item.name}_${item.surname}_${item.passportNumber}`
    .replace(/[^a-z0-9_]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase();
}

// Status bo'yicha aksent ranglari (yuqori chiziq, halqa, soya).
const STATUS_ACCENT: Record<
  string,
  { bar: string; ring: string; dot: string }
> = {
  NEW: { bar: "bg-slate-400", ring: "hover:ring-slate-300", dot: "bg-slate-400" },
  EDITED: { bar: "bg-sky-500", ring: "hover:ring-sky-300", dot: "bg-sky-500" },
  BOOKING: { bar: "bg-brand-500", ring: "hover:ring-brand-300", dot: "bg-brand-500" },
  REGISTERED: { bar: "bg-indigo-500", ring: "hover:ring-indigo-300", dot: "bg-indigo-500" },
  ORDERED: { bar: "bg-violet-500", ring: "hover:ring-violet-300", dot: "bg-violet-500" },
  BOOKED: { bar: "bg-emerald-500", ring: "hover:ring-emerald-300", dot: "bg-emerald-500" },
  FAILED: { bar: "bg-rose-500", ring: "hover:ring-rose-300", dot: "bg-rose-500" },
  ARCHIVED: { bar: "bg-slate-300", ring: "hover:ring-slate-200", dot: "bg-slate-300" },
};

function accent(key: string) {
  return STATUS_ACCENT[key] ?? STATUS_ACCENT.NEW;
}

function thumbSrc(item: DocItem): string | null {
  if (item.hasPhoto) return `/api/applicants/${item.id}/photo`;
  if (item.hasPersonPhoto) return `/api/applicants/${item.id}/person-photo`;
  return null;
}

export default function DocumentsGallery({ items }: { items: DocItem[] }) {
  const [active, setActive] = useState<number | null>(null);

  if (items.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center py-16 text-center">
        <Gallery size={36} variant="Bold" className="mb-3 text-slate-300" />
        <p className="text-sm text-slate-400">
          Filtrga mos hujjat topilmadi
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((item, i) => (
          <DocCard
            key={item.id}
            item={item}
            onView={() => setActive(i)}
          />
        ))}
      </div>

      {active !== null && (
        <Lightbox
          items={items}
          index={active}
          onIndex={setActive}
          onClose={() => setActive(null)}
        />
      )}
    </>
  );
}

function DocCard({ item, onView }: { item: DocItem; onView: () => void }) {
  const src = thumbSrc(item);
  const s = statusMeta(item.status);
  const ac = accent(item.status);
  const initials = `${item.surname?.[0] ?? ""}${item.name?.[0] ?? ""}`
    .toUpperCase()
    .trim();

  return (
    <div
      className={`group overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-slate-100 transition-all hover:-translate-y-1 hover:shadow-lg dark:bg-slate-900/60 dark:ring-slate-800 ${ac.ring}`}
    >
      {/* Status aksent chizig'i */}
      <div className={`h-1 w-full ${ac.bar}`} />

      {/* Thumbnail */}
      <button
        type="button"
        onClick={onView}
        className="relative block aspect-[3/4] w-full overflow-hidden bg-slate-100 dark:bg-slate-800"
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={`${item.surname} ${item.name}`}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-300">
            <DocumentText size={34} variant="Bold" />
            <span className="text-xs">Rasm yo'q</span>
          </span>
        )}

        {/* Hover overlay */}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-900/0 opacity-0 transition-all group-hover:bg-slate-900/30 group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow">
            <Eye size={15} variant="Bold" /> Ko'rish
          </span>
        </span>

        {/* Doc-type chips */}
        <span className="absolute left-2 top-2 flex flex-wrap gap-1">
          {item.hasPhoto && <Chip tone="indigo" icon={<ImageIcon size={11} variant="Bold" />} text="Passport" />}
          {item.hasPersonPhoto && <Chip tone="emerald" icon={<TickCircle size={11} variant="Bold" />} text="Standart" />}
          {item.canPdf && <Chip tone="violet" icon={<DocumentText size={11} variant="Bold" />} text="PDF" />}
        </span>

        {/* Status pill (o'ng yuqori) */}
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm backdrop-blur dark:bg-slate-900/80 dark:text-slate-200">
          <span className={`h-1.5 w-1.5 rounded-full ${ac.dot}`} />
          {s.label}
        </span>
      </button>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-100 to-brand-50 text-[10px] font-bold text-brand-700 ring-1 ring-brand-100 dark:from-brand-500/15 dark:to-brand-500/5 dark:text-brand-300 dark:ring-brand-500/20">
            {initials || "?"}
          </span>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            {item.surname} {item.name}
          </p>
        </div>
        <p className="mt-1.5 truncate font-mono text-[11px] text-slate-400">
          {item.passportNumber}
        </p>
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-400">
          <Calendar size={12} variant="Bold" className="shrink-0 text-slate-300" />
          <span className="truncate">{fmtDateShort(item.updatedAt)}</span>
        </p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <StatusBadge status={item.status} />
          <div className="flex items-center gap-1">
            {src && (
              <button
                type="button"
                onClick={() =>
                  downloadFile(
                    src,
                    `${fileBase(item)}_${item.hasPhoto ? "passport" : "rasm"}.jpg`,
                  )
                }
                className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
                title="Rasmni yuklab olish"
              >
                <ImageIcon size={13} variant="Bold" /> Rasm
              </button>
            )}
            {item.canPdf && (
              <button
                type="button"
                onClick={() =>
                  downloadFile(
                    `/api/applicants/${item.id}/pdf`,
                    `${fileBase(item)}.pdf`,
                  )
                }
                className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-700 ring-1 ring-violet-100 transition hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/20"
                title="PDF yuklab olish"
              >
                <DocumentDownload size={13} variant="Bold" /> PDF
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({
  tone,
  icon,
  text,
}: {
  tone: "indigo" | "emerald" | "violet";
  icon: React.ReactNode;
  text: string;
}) {
  const tones: Record<string, string> = {
    indigo: "bg-indigo-600/90 text-white",
    emerald: "bg-emerald-600/90 text-white",
    violet: "bg-violet-600/90 text-white",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur ${tones[tone]}`}
    >
      {icon}
      {text}
    </span>
  );
}

// --------------------------- Lightbox modal ---------------------------------

function Lightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: DocItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  // Tanlangan rasm manbai: passport yoki standart.
  const sources: { key: "photo" | "person"; label: string; url: string }[] = [];
  if (item.hasPhoto)
    sources.push({ key: "photo", label: "Passport rasm", url: `/api/applicants/${item.id}/photo` });
  if (item.hasPersonPhoto)
    sources.push({ key: "person", label: "Standart rasm", url: `/api/applicants/${item.id}/person-photo` });

  const [srcKey, setSrcKey] = useState<"photo" | "person">(
    item.hasPhoto ? "photo" : "person",
  );
  const current = sources.find((s) => s.key === srcKey) ?? sources[0] ?? null;

  const go = useCallback(
    (dir: number) => {
      const next = (index + dir + items.length) % items.length;
      onIndex(next);
    },
    [index, items.length, onIndex],
  );

  // Item o'zgarganda rasm manbasini reset qilamiz.
  useEffect(() => {
    setSrcKey(item.hasPhoto ? "photo" : "person");
  }, [item.id, item.hasPhoto]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-4xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
              {item.surname} {item.name}
            </p>
            <p className="truncate font-mono text-xs text-slate-400">
              #{item.id} · {item.passportNumber}
            </p>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Yopish">
            <CloseCircle size={20} variant="Bold" />
          </button>
        </div>

        <div className="grid gap-0 sm:grid-cols-[1fr_240px]">
          {/* Rasm */}
          <div className="relative flex min-h-[320px] items-center justify-center bg-slate-900 p-4">
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.url}
                alt={current.label}
                className="max-h-[70vh] w-auto rounded-lg object-contain"
              />
            ) : (
              <span className="flex flex-col items-center gap-2 text-slate-500">
                <DocumentText size={40} variant="Bold" />
                <span className="text-sm">Rasm yo'q</span>
              </span>
            )}

            {items.length > 1 && (
              <>
                <button
                  onClick={() => go(-1)}
                  className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow transition hover:bg-white"
                  aria-label="Oldingi"
                >
                  <ArrowLeft2 size={18} variant="Bold" />
                </button>
                <button
                  onClick={() => go(1)}
                  className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow transition hover:bg-white"
                  aria-label="Keyingi"
                >
                  <ArrowRight2 size={18} variant="Bold" />
                </button>
              </>
            )}
          </div>

          {/* Yon panel */}
          <div className="space-y-4 p-5">
            <div>
              <p className="label">Status</p>
              <StatusBadge status={item.status} size="md" />
            </div>

            {item.groupName && (
              <div>
                <p className="label">Guruh</p>
                <a
                  href={`/groups/${item.groupId}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
                >
                  <Profile2User size={13} variant="Bold" />
                  {item.groupName}
                </a>
              </div>
            )}

            <div>
              <p className="label">Sanalar</p>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <Calendar size={14} variant="Bold" className="shrink-0 text-slate-400" />
                  <span className="text-slate-400">Qo'shilgan:</span>
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    {fmtDate(item.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <Clock size={14} variant="Bold" className="shrink-0 text-slate-400" />
                  <span className="text-slate-400">Yangilangan:</span>
                  <span className="font-medium text-slate-600 dark:text-slate-300">
                    {fmtDate(item.updatedAt)}
                  </span>
                </div>
                {item.canPdf && item.pdfAt && (
                  <div className="flex items-center gap-2 text-xs text-violet-500 dark:text-violet-300">
                    <DocumentDownload size={14} variant="Bold" className="shrink-0" />
                    <span className="text-violet-400">PDF tayyor:</span>
                    <span className="font-medium text-violet-600 dark:text-violet-300">
                      {fmtDate(item.pdfAt)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {sources.length > 1 && (
              <div>
                <p className="label">Rasm turi</p>
                <div className="flex gap-1.5">
                  {sources.map((src) => (
                    <button
                      key={src.key}
                      onClick={() => setSrcKey(src.key)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition ${
                        srcKey === src.key
                          ? "bg-brand-600 text-white ring-brand-600"
                          : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
                      }`}
                    >
                      {src.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2 pt-1">
              {current && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      downloadFile(
                        current.url,
                        `${fileBase(item)}_${current.key === "photo" ? "passport" : "rasm"}.jpg`,
                      )
                    }
                    className="btn-primary w-full"
                  >
                    <DocumentDownload size={16} variant="Bold" /> Rasmni yuklab
                    olish
                  </button>
                  <a
                    href={current.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost w-full"
                  >
                    <ImageIcon size={16} variant="Bold" /> Yangi tabda ochish
                  </a>
                </>
              )}
              {item.canPdf && (
                <button
                  type="button"
                  onClick={() =>
                    downloadFile(
                      `/api/applicants/${item.id}/pdf`,
                      `${fileBase(item)}.pdf`,
                    )
                  }
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-violet-700"
                >
                  <DocumentDownload size={16} variant="Bold" /> PDF yuklab olish
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
