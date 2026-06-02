"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, CloseCircle, Profile2User, Sms } from "iconsax-react";
import { APPLICANT_STATUS } from "@/lib/status";
import { fullName } from "@/lib/name";

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
  subcategory: string | null;
  city: string | null;
  category: string | null;
  source: string | null;
  status: string;
  complete: boolean;
  appointmentRef: string | null;
  resultNote: string | null;
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
  const s = APPLICANT_STATUS[user.status as keyof typeof APPLICANT_STATUS] ?? {
    label: user.status,
    cls: "bg-slate-100 text-slate-700",
  };

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
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal-panel max-w-2xl p-0"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 rounded-t-2xl bg-gradient-to-br from-brand-600 to-brand-700 p-5 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-lg font-bold backdrop-blur">
                  {`${user.surname?.[0] ?? ""}${user.name?.[0] ?? ""}`.toUpperCase()}
                </span>
                <div>
                  <h3 className="text-lg font-semibold leading-tight">
                    {fullName(user.surname, user.name)}
                  </h3>
                  <p className="font-mono text-xs text-white/70">
                    {user.passportNumber}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-white/80 transition hover:bg-white/15 hover:text-white"
              >
                <CloseCircle size={22} />
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[70vh] overflow-y-auto p-5">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className={`badge ${s.cls}`}>{s.label}</span>
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
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-brand-50 hover:text-brand-700"
                  >
                    <Profile2User size={13} variant="Bold" />
                    {user.group.name}
                  </Link>
                )}
              </div>

              <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {/* Standart passport rasmi (bazadan) */}
                <div className="sm:col-span-2 mb-2 flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/applicants/${user.id}/person-photo`}
                    alt="passport"
                    className="h-24 w-24 rounded-lg object-cover ring-1 ring-slate-200"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display =
                        "none";
                    }}
                  />
                  <div className="text-xs text-slate-500">
                    <p className="font-medium text-slate-700">Passport rasmi</p>
                    <p>Standart (600×600) — bazada saqlangan</p>
                  </div>
                </div>

                <Row label="Familiya" value={user.surname} />
                <Row label="Ism" value={user.name} />
                <Row label="Pasport raqami" value={user.passportNumber} />
                <Row label="Amal muddati" value={user.passportValidity} />
                <Row label="Tug'ilgan sana" value={user.birthdate} />
                <Row label="Jins" value={user.gender} />
                <Row label="Millat" value={user.nationality} />
                <Row label="Telefon" value={user.phone} />
                <Row label="Tizim email" value={user.generatedEmail} />
                <Row label="Email (Excel)" value={user.email} />
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
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 border-t border-slate-100 p-4">
              {user.generatedEmail && (
                <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-slate-400">
                  <Sms size={14} className="text-brand-500" />
                  {user.generatedEmail}
                </span>
              )}
              <Link href={`/groups/${user.groupId}`} className="btn-primary">
                Guruhda ochish
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
