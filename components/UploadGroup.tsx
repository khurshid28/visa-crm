"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DocumentUpload, TickCircle, Warning2, CloseCircle } from "iconsax-react";
import { useToast } from "@/components/Toast";
import Select from "@/components/Select";

export type SlotOption = {
  id: number;
  name: string;
  fromCountry: string;
  toCountry: string;
  fromName: string;
  toName: string;
  fromIso2: string;
  toIso2: string;
};

const FIELD_LABEL: Record<string, string> = {
  surname: "Familiya",
  name: "Ism",
  passportNumber: "Pasport",
  nationality: "Millat",
  gender: "Jins",
  birthdate: "Tug'ilgan sana",
  passportValidity: "Amal muddati",
};

type Incomplete = { row: number; name: string; missing: string[] };
type Result = {
  imported: number;
  complete: number;
  incompleteCount: number;
  incomplete: Incomplete[];
};
type ExistingPerson = {
  passportNumber: string;
  name: string;
  groups: string[];
};

export default function UploadGroup({ slots = [] }: { slots?: SlotOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [slotId, setSlotId] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  // Takror (mavjud) shaxslar bo'lsa — tasdiqlash bosqichi.
  const [existing, setExisting] = useState<ExistingPerson[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  async function submit(confirm: boolean, exclude: string[] = []) {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Avval fayl tanlang");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name);
      if (slotId) fd.append("slotId", slotId);
      if (confirm) {
        fd.append("confirm", "1");
        fd.append("exclude", exclude.join(","));
      }
      const res = await fetch("/api/groups", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Xatolik");
        toast(data.error || "Yuklashda xatolik", "error");
        return;
      }

      // Takrorlar topildi — tasdiqlash bosqichini ko'rsatamiz.
      if (data.needsConfirm) {
        const items: ExistingPerson[] = data.existing ?? [];
        setExisting(items);
        // Barchasi belgilangan holatda (galochka) keladi.
        setChecked(new Set(items.map((x) => x.passportNumber)));
        return;
      }

      // Muvaffaqiyat.
      setExisting(null);
      setResult(null);
      setName("");
      setSlotId("");
      if (fileRef.current) fileRef.current.value = "";
      setOpen(false);
      const reusedPart =
        data.reused > 0 ? ` · ${data.reused} mavjud shaxs` : "";
      const incompletePart =
        data.incompleteCount > 0 ? ` · ${data.incompleteCount} to'liqsiz` : "";
      toast(
        `Guruh yaratildi — ${data.imported} arizachi (${data.complete} to'liq${reusedPart}${incompletePart})`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function upload() {
    submit(false);
  }

  function confirmCreate() {
    if (!existing) return;
    // Belgilanmaganlar = guruhga qo'shilmaydi (exclude).
    const exclude = existing
      .map((x) => x.passportNumber)
      .filter((p) => !checked.has(p));
    submit(true, exclude);
  }

  function toggle(passport: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(passport)) next.delete(passport);
      else next.add(passport);
      return next;
    });
  }

  if (!open) {
    return (
      <button
        className="btn-primary"
        onClick={() => {
          setOpen(true);
          setResult(null);
          setError("");
        }}
      >
        <DocumentUpload size={18} /> Excel yuklash
      </button>
    );
  }

  return (
    <div className="card w-full max-w-lg space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          Yangi guruh (Excel)
        </h3>
        <button
          onClick={() => {
            setOpen(false);
            setExisting(null);
            setResult(null);
            setError("");
          }}
          className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <CloseCircle size={18} />
        </button>
      </div>

      <div>
        <label className="label">Guruh nomi (ixtiyoriy)</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Masalan: Guruh 1"
          disabled={!!existing}
        />
      </div>
      <div>
        <label className="label">Fayl (.xlsx / .csv)</label>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          disabled={!!existing}
          className="input file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1 file:text-brand-700 disabled:opacity-60"
        />
      </div>

      {/* Slot (yo'nalish) tanlash — guruh shu slotga bog'lanadi */}
      <div>
        <label className="label">Slot (yo'nalish)</label>
        {slots.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400 dark:bg-slate-800/50">
            Hali slot yo'q — "Slotlar" bo'limidan qo'shing.
          </p>
        ) : (
          <Select
            value={slotId}
            onChange={setSlotId}
            disabled={!!existing}
            placeholder="Slot tanlang (ixtiyoriy)"
            options={slots.map((s) => ({
              value: String(s.id),
              label: s.name,
              fromIso2: s.fromIso2,
              toIso2: s.toIso2,
            }))}
          />
        )}
        {slotId &&
          (() => {
            const s = slots.find((x) => String(x.id) === slotId);
            if (!s) return null;
            return (
              <div className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-slate-50 py-2 text-sm font-medium text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
                {s.fromIso2 && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://flagcdn.com/${s.fromIso2}.svg`}
                    alt=""
                    className="h-[14px] w-[19px] rounded-sm object-cover ring-1 ring-black/5"
                  />
                )}
                {s.fromName}
                <span className="text-brand-500">→</span>
                {s.toIso2 && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://flagcdn.com/${s.toIso2}.svg`}
                    alt=""
                    className="h-[14px] w-[19px] rounded-sm object-cover ring-1 ring-black/5"
                  />
                )}
                {s.toName}
              </div>
            );
          })()}
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-sm text-red-600">
          <Warning2 size={16} /> {error}
        </p>
      )}

      {existing && (
        <div className="space-y-3 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <div className="flex items-start gap-2">
            <Warning2
              size={18}
              variant="Bold"
              className="mt-0.5 shrink-0 text-amber-500"
            />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                {existing.length} ta shaxs avval ro'yxatga olingan
              </p>
              <p className="text-xs text-amber-700">
                Yangi user yaratilmaydi — belgilanganlar shu guruhga ham
                qo'shiladi (bir odam ko'p guruhda bo'lishi mumkin).
                Belgini olib tashlasangiz, bu guruhga qo'shilmaydi.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-amber-700">
            <span>{checked.size} ta tanlandi</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="font-medium hover:underline"
                onClick={() =>
                  setChecked(new Set(existing.map((x) => x.passportNumber)))
                }
              >
                Hammasi
              </button>
              <button
                type="button"
                className="font-medium hover:underline"
                onClick={() => setChecked(new Set())}
              >
                Hech biri
              </button>
            </div>
          </div>

          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-white p-1 ring-1 ring-amber-100">
            {existing.map((x) => (
              <label
                key={x.passportNumber}
                className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-amber-50"
              >
                <input
                  type="checkbox"
                  checked={checked.has(x.passportNumber)}
                  onChange={() => toggle(x.passportNumber)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-slate-700">
                    {x.name}
                  </span>
                  <span className="block font-mono text-[11px] text-slate-400">
                    {x.passportNumber}
                    {x.groups.length > 0 && ` · ${x.groups.join(", ")}`}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              className="btn-ghost flex-1"
              onClick={() => {
                setExisting(null);
                setError("");
              }}
              disabled={busy}
            >
              Bekor qilish
            </button>
            <button
              className="btn-primary flex-1"
              onClick={confirmCreate}
              disabled={busy}
            >
              {busy ? "Yaratilyapti..." : "Tasdiqlash va guruh tashkil qilish"}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-3 rounded-xl bg-slate-50 p-4">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 font-medium text-slate-700 ring-1 ring-slate-200">
              Jami: {result.imported}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
              <TickCircle size={15} variant="Bold" /> To'liq: {result.complete}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-700">
              <Warning2 size={15} variant="Bold" /> To'liqsiz:{" "}
              {result.incompleteCount}
            </span>
          </div>

          <p className="text-xs text-slate-500">
            Masalan: {result.imported} yuklandi, {result.complete} tasi to'liq —
            shularni yuborish mumkin. Qolganlariga passportdan to'ldiring.
          </p>

          {result.incomplete.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-lg bg-white ring-1 ring-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Ism</th>
                    <th className="px-3 py-2">Yetishmaydi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.incomplete.map((x) => (
                    <tr key={x.row}>
                      <td className="px-3 py-2 text-slate-400">{x.row}</td>
                      <td className="px-3 py-2 text-slate-700">{x.name}</td>
                      <td className="px-3 py-2 text-amber-700">
                        {x.missing.map((m) => FIELD_LABEL[m] ?? m).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <button
        className="btn-primary w-full"
        onClick={upload}
        disabled={busy || !!existing}
        hidden={!!existing}
      >
        {busy ? "Yuklanyapti..." : "Yuklash va saqlash"}
      </button>
    </div>
  );
}
