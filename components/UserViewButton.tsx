"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Eye,
  CloseCircle,
  Profile2User,
  Sms,
  DocumentDownload,
  Image as ImageIcon,
  Gallery,
  Edit2,
  ArrowLeft2,
  Key,
} from "iconsax-react";
import { fullName } from "@/lib/name";
import { buildEmail, buildPassword } from "@/lib/email";
import { COUNTRIES, GENDERS, normalizeNationality, countryLabel } from "@/lib/options";
import Select from "@/components/Select";
import StatusBadge from "@/components/StatusBadge";
import PassportReader, {
  type PassportFields,
} from "@/components/PassportReader";
import { useToast } from "@/components/Toast";

export type UserData = {
  id: number;
  groupId: number;
  surname: string;
  name: string;
  passportNumber: string;
  nationality: string | null;
  gender: string | null;
  birthdate: string | null;
  passportValidity: string | null;
  phone: string | null;
  email: string | null;
  generatedEmail: string | null;
  generatedPassword: string | null;
  subcategory: string | null;
  city: string | null;
  category: string | null;
  source: string | null;
  status: string;
  complete: boolean;
  appointmentRef: string | null;
  resultNote: string | null;
  hasPhoto?: boolean;
  hasPersonPhoto?: boolean;
  canPdf?: boolean;
  group: { id: number; name: string } | null;
};

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-0">
      <span className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="text-sm font-medium text-slate-700">
        {value || <span className="text-slate-300">—</span>}
      </span>
    </div>
  );
}

export default function UserViewButton({ user }: { user: UserData }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<UserData>(user);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [personPhoto, setPersonPhoto] = useState<File | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  function setField<K extends keyof UserData>(key: K, value: UserData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function closeAll() {
    setOpen(false);
    setEditing(false);
    setForm(user);
    setPhotoFile(null);
    setPersonPhoto(null);
  }

  function fillFromPassport(p: PassportFields) {
    const norm = (x: string) =>
      (x || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
    const scanned = norm(p.passportNumber);
    const existing = norm(form.passportNumber);
    if (existing && scanned && scanned !== existing) {
      toast(
        `Pasport mos kelmadi: ${form.passportNumber} ≠ skan ${p.passportNumber}`,
        "error",
      );
      return false;
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
    toast("Pasport o'qildi — forma to'ldirildi");
    return true;
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/applicants/${user.id}`, {
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
          generatedPassword: form.generatedPassword,
          subcategory: form.subcategory,
          appointmentRef: form.appointmentRef,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast(
          err?.message || err?.error || "Saqlashda xatolik",
          "error",
        );
        return;
      }
      if (photoFile) {
        const fd = new FormData();
        fd.append("file", photoFile);
        await fetch(`/api/applicants/${user.id}/photo`, {
          method: "POST",
          body: fd,
        });
      }
      if (personPhoto) {
        const fd = new FormData();
        fd.append("file", personPhoto);
        await fetch(`/api/applicants/${user.id}/person-photo`, {
          method: "POST",
          body: fd,
        });
      }
      toast("Ma'lumotlar saqlandi");
      setEditing(false);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Mavjud rasm manbalari (passport / standart).
  const sources: { key: "photo" | "person"; label: string; url: string }[] = [];
  if (user.hasPhoto)
    sources.push({
      key: "photo",
      label: "Passport rasm",
      url: `/api/applicants/${user.id}/photo`,
    });
  if (user.hasPersonPhoto)
    sources.push({
      key: "person",
      label: "Standart rasm",
      url: `/api/applicants/${user.id}/person-photo`,
    });
  const [srcKey, setSrcKey] = useState<"photo" | "person">(
    user.hasPhoto ? "photo" : "person",
  );
  const current = sources.find((x) => x.key === srcKey) ?? sources[0] ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-100 transition-all hover:-translate-y-0.5 hover:bg-brand-100 hover:shadow"
        title="To'liq ko'rish"
      >
        <Eye size={14} variant="Bold" />
        View
      </button>

      {open && (
        <div className="modal-backdrop" onClick={closeAll}>
          <div
            className="modal-panel max-w-2xl p-0"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 rounded-t-2xl bg-gradient-to-br from-brand-600 to-brand-700 p-5 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-lg font-bold backdrop-blur">
                  {`${form.surname?.[0] ?? ""}${form.name?.[0] ?? ""}`.toUpperCase()}
                </span>
                <div>
                  <h3 className="text-lg font-semibold leading-tight">
                    {editing
                      ? "Arizachini tahrirlash"
                      : fullName(form.surname, form.name)}
                  </h3>
                  <p className="font-mono text-xs text-white/70">
                    {form.passportNumber}
                  </p>
                </div>
              </div>
              <button
                onClick={closeAll}
                className="rounded-lg p-1 text-white/80 transition hover:bg-white/15 hover:text-white"
              >
                <CloseCircle size={22} />
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[70vh] overflow-y-auto p-5">
              {editing ? (
                <EditBody
                  form={form}
                  setField={setField}
                  fillFromPassport={fillFromPassport}
                  setPhotoFile={setPhotoFile}
                  setPersonPhoto={setPersonPhoto}
                  userId={user.id}
                />
              ) : (
                <ViewBody
                  user={user}
                  sources={sources}
                  srcKey={srcKey}
                  setSrcKey={setSrcKey}
                  current={current}
                />
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-100 p-4 dark:border-slate-800">
              {editing ? (
                <>
                  <button
                    className="btn-ghost mr-auto"
                    onClick={() => {
                      setEditing(false);
                      setForm(user);
                      setPhotoFile(null);
                      setPersonPhoto(null);
                    }}
                    disabled={busy}
                  >
                    <ArrowLeft2 size={16} variant="Bold" /> Orqaga
                  </button>
                  <button
                    className="btn-primary"
                    onClick={save}
                    disabled={busy}
                  >
                    {busy ? "Saqlanyapti..." : "Saqlash"}
                  </button>
                </>
              ) : (
                <>
                  {user.generatedEmail && (
                    <span className="mr-auto inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1.5">
                        <Sms size={14} className="text-brand-500" />
                        {user.generatedEmail}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Key size={14} className="text-amber-500" />
                        {user.generatedPassword ||
                          buildPassword(
                            user.name,
                            user.surname,
                            user.passportNumber,
                          )}
                      </span>
                    </span>
                  )}
                  <button
                    className="btn-ghost"
                    onClick={() => setEditing(true)}
                  >
                    <Edit2 size={16} variant="Bold" /> Tahrirlash
                  </button>
                  <Link
                    href={`/groups/${user.groupId}`}
                    className="btn-primary"
                  >
                    Guruhda ochish
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ----------------------------- ViewBody (read-only) -------------------------

type SourceItem = { key: "photo" | "person"; label: string; url: string };

function ViewBody({
  user,
  sources,
  srcKey,
  setSrcKey,
  current,
}: {
  user: UserData;
  sources: SourceItem[];
  srcKey: "photo" | "person";
  setSrcKey: (k: "photo" | "person") => void;
  current: SourceItem | null;
}) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge status={user.status} size="md" />
        <span
          className={`badge ${
            user.complete
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          {user.complete ? "To'liq" : "To'liqsiz"}
        </span>
        {user.group && (
          <Link
            href={`/groups/${user.group.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-brand-50 hover:text-brand-700 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
          >
            <Profile2User size={13} variant="Bold" />
            {user.group.name}
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {/* Rasm + PDF bloki */}
        <div className="sm:col-span-2 mb-3 flex flex-col gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50 sm:flex-row sm:items-center">
          <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.url}
                alt={current.label}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex flex-col items-center gap-1 text-slate-300">
                <Gallery size={26} variant="Bold" />
                <span className="text-[10px]">Rasm yo'q</span>
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Hujjatlar
            </p>

            {sources.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {sources.map((src) => (
                  <button
                    key={src.key}
                    type="button"
                    onClick={() => setSrcKey(src.key)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 transition ${
                      srcKey === src.key
                        ? "bg-brand-600 text-white ring-brand-600"
                        : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
                    }`}
                  >
                    {src.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Rasm yuklanmagan</p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {current && (
                <a
                  href={current.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
                >
                  <ImageIcon size={14} variant="Bold" /> Rasmni ochish
                </a>
              )}
              {user.canPdf && (
                <a
                  href={`/api/applicants/${user.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
                >
                  <DocumentDownload size={14} variant="Bold" /> PDF yuklab olish
                </a>
              )}
            </div>
          </div>
        </div>

        <Row label="Familiya" value={user.surname} />
        <Row label="Ism" value={user.name} />
        <Row label="Pasport raqami" value={user.passportNumber} />
        <Row label="Amal muddati" value={user.passportValidity} />
        <Row label="Tug'ilgan sana" value={user.birthdate} />
        <Row label="Jins" value={user.gender} />
        <Row
          label="Millat"
          value={
            user.nationality
              ? countryLabel(normalizeNationality(user.nationality))
              : null
          }
        />
        <Row label="Telefon" value={user.phone} />
        <Row label="Tizim email" value={user.generatedEmail} />
        <Row
          label="Tizim parol"
          value={
            user.generatedPassword ||
            buildPassword(user.name, user.surname, user.passportNumber)
          }
        />
        <Row label="Toifa" value={user.category} />
        <Row label="Subkategoriya" value={user.subcategory} />
        <Row label="Shahar" value={user.city} />
        <Row label="Manba" value={user.source} />
        <Row label="Appointment raqami" value={user.appointmentRef} />
        {user.resultNote && (
          <div className="sm:col-span-2">
            <Row label="Natija izohi" value={user.resultNote} />
          </div>
        )}
      </div>
    </>
  );
}

// ----------------------------- EditBody (form) ------------------------------

function EditBody({
  form,
  setField,
  fillFromPassport,
  setPhotoFile,
  setPersonPhoto,
  userId,
}: {
  form: UserData;
  setField: <K extends keyof UserData>(key: K, value: UserData[K]) => void;
  fillFromPassport: (p: PassportFields) => boolean | void;
  setPhotoFile: (f: File | null) => void;
  setPersonPhoto: (f: File | null) => void;
  userId: number;
}) {
  return (
    <>
      <div className="mb-5">
        <PassportReader
          onFill={fillFromPassport}
          onImage={setPhotoFile}
          onPhoto={setPersonPhoto}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <EditField
          label="Familiya"
          value={form.surname}
          onChange={(v) => setField("surname", v)}
        />
        <EditField
          label="Ism"
          value={form.name}
          onChange={(v) => setField("name", v)}
        />
        <EditField
          label="Pasport"
          value={form.passportNumber}
          onChange={(v) => setField("passportNumber", v)}
        />
        <EditSelect
          label="Davlat (millat)"
          value={normalizeNationality(form.nationality ?? "")}
          onChange={(v) => setField("nationality", v)}
          options={COUNTRIES}
          placeholder="Davlatni tanlang"
        />
        <EditSelect
          label="Jins"
          value={form.gender ?? ""}
          onChange={(v) => setField("gender", v)}
          options={GENDERS}
          placeholder="Jinsni tanlang"
        />
        <EditField
          label="Tug'ilgan sana"
          value={form.birthdate ?? ""}
          onChange={(v) => setField("birthdate", v)}
        />
        <EditField
          label="Pasport amal muddati"
          value={form.passportValidity ?? ""}
          onChange={(v) => setField("passportValidity", v)}
        />
        <EditField
          label="Telefon"
          value={form.phone ?? ""}
          onChange={(v) => setField("phone", v)}
        />
        <div>
          <div className="flex items-center justify-between">
            <label className="label">Tizim email</label>
            <button
              type="button"
              className="text-xs font-medium text-brand-600 hover:underline"
              onClick={() => {
                setField(
                  "generatedEmail",
                  buildEmail(form.name, form.surname, userId),
                );
                setField(
                  "generatedPassword",
                  buildPassword(form.name, form.surname, form.passportNumber),
                );
              }}
            >
              Generatsiya
            </button>
          </div>
          <input
            className="input"
            value={form.generatedEmail ?? ""}
            onChange={(e) => setField("generatedEmail", e.target.value)}
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label">Tizim parol</label>
            <button
              type="button"
              className="text-xs font-medium text-brand-600 hover:underline"
              onClick={() =>
                setField(
                  "generatedPassword",
                  buildPassword(form.name, form.surname, form.passportNumber),
                )
              }
            >
              Generatsiya
            </button>
          </div>
          <input
            className="input"
            value={form.generatedPassword ?? ""}
            onChange={(e) => setField("generatedPassword", e.target.value)}
          />
        </div>
        <EditField
          label="Subkategoriya"
          value={form.subcategory ?? ""}
          onChange={(v) => setField("subcategory", v)}
        />
        <EditField
          label="Appointment raqami"
          value={form.appointmentRef ?? ""}
          onChange={(v) => setField("appointmentRef", v)}
        />
      </div>
    </>
  );
}

function EditField({
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

function EditSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; iso2?: string }[];
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
