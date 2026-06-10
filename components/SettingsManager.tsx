"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Global,
  Monitor,
  Timer1,
  Cpu,
  Lock1,
  ShieldTick,
  TickCircle,
  Eye,
  EyeSlash,
  InfoCircle,
} from "iconsax-react";
import { useToast } from "@/components/Toast";
import type { MaskedSettings } from "@/lib/settings";

// Kichik toggle (yoqilgan/o'chirilgan) tugmasi.
function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function Card({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: typeof Global;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
          <Icon size={18} variant="Bold" />
        </span>
        <div>
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">
            {title}
          </h2>
          {desc && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {desc}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>
      )}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-500/20";

export default function SettingsManager({
  initial,
}: {
  initial: MaskedSettings;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [form, setForm] = useState<MaskedSettings>(initial);
  const [proxyPass, setProxyPass] = useState(""); // yangi parol (bo'sh = tegmaymiz)
  const [showPass, setShowPass] = useState(false);
  const [superUsername, setSuperUsername] = useState("");
  const [superPassword, setSuperPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof MaskedSettings>(
    key: K,
    value: MaskedSettings[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const num = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  async function save() {
    if (!superUsername.trim() || !superPassword.trim()) {
      toast("Super login va parolni kiriting", "error");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        superUsername,
        superPassword,
        proxyEnabled: form.proxyEnabled,
        proxyHost: form.proxyHost,
        proxyPort: form.proxyPort,
        proxyUser: form.proxyUser,
        proxyCountries: form.proxyCountries,
        chromeHeadless: form.chromeHeadless,
        captchaTimeoutMs: form.captchaTimeoutMs,
        cfChallengeTimeoutMs: form.cfChallengeTimeoutMs,
        maxAttempts: form.maxAttempts,
        ipRetries: form.ipRetries,
        workerPerCpu: form.workerPerCpu,
      };
      // Parol faqat yangi qiymat kiritilganda yuboriladi.
      if (proxyPass.length > 0) payload.proxyPass = proxyPass;

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast(data?.error || "Saqlashda xatolik", "error");
        return;
      }
      if (data?.settings) {
        setForm(data.settings as MaskedSettings);
        setProxyPass("");
      }
      toast("Sozlamalar saqlandi");
      router.refresh();
    } catch {
      toast("Saqlashda xatolik", "error");
    } finally {
      setSaving(false);
    }
  }

  const lastInfo = form.updatedBy
    ? `Oxirgi o'zgarish: ${form.updatedBy} · ${new Date(
        form.updatedAt,
      ).toLocaleString("uz-UZ")}`
    : null;

  return (
    <div className="space-y-5 pb-24">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
          Sozlamalar
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Tizim sozlamalari bazada saqlanadi. O'zgartirish uchun super-admin
          login/parol talab qilinadi.
        </p>
        {lastInfo && (
          <p className="mt-1 text-[11px] text-slate-400">{lastInfo}</p>
        )}
      </div>

      {/* --- PROKSI --- */}
      <Card
        icon={Global}
        title="Proksi"
        desc="Avtomatlashtirishda ishlatiladigan rezident proksi. O'chirilsa, proksisiz to'g'ridan-to'g'ri ulanadi."
      >
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
          <div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Proksi yoqilgan
            </p>
            <p className="text-[11px] text-slate-400">
              {form.proxyEnabled
                ? "Proksi orqali ulanadi"
                : "Proksi kerak emas — to'g'ridan-to'g'ri ulanadi"}
            </p>
          </div>
          <Toggle
            on={form.proxyEnabled}
            onChange={(v) => set("proxyEnabled", v)}
          />
        </div>

        <div
          className={`space-y-3 transition ${
            form.proxyEnabled ? "" : "pointer-events-none opacity-40"
          }`}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label="Host">
                <input
                  value={form.proxyHost}
                  onChange={(e) => set("proxyHost", e.target.value)}
                  placeholder="geo.iproyal.com"
                  className={inputCls}
                />
              </Field>
            </div>
            <Field label="Port">
              <input
                value={form.proxyPort}
                onChange={(e) => set("proxyPort", e.target.value)}
                placeholder="12321"
                className={inputCls}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Foydalanuvchi (user)">
              <input
                value={form.proxyUser}
                onChange={(e) => set("proxyUser", e.target.value)}
                placeholder="proxy user"
                autoComplete="off"
                className={inputCls}
              />
            </Field>
            <Field
              label="Parol"
              hint={
                form.hasProxyPass
                  ? "Saqlangan. O'zgartirish uchun yangi parol kiriting."
                  : "Hali kiritilmagan."
              }
            >
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={proxyPass}
                  onChange={(e) => setProxyPass(e.target.value)}
                  placeholder={
                    form.hasProxyPass ? "•••••••• (saqlangan)" : "proksi parol"
                  }
                  autoComplete="new-password"
                  className={inputCls + " pr-10"}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showPass ? <EyeSlash size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
          </div>
          <Field
            label="Davlatlar (vergul bilan)"
            hint="Masalan: uz,kz — proksi chiqish IP davlatlari."
          >
            <input
              value={form.proxyCountries}
              onChange={(e) => set("proxyCountries", e.target.value)}
              placeholder="uz,kz"
              className={inputCls}
            />
          </Field>
        </div>
      </Card>

      {/* --- CHROME + WORKER (yonma-yon) --- */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* --- CHROME KO'RINISHI --- */}
        <Card
          icon={Monitor}
          title="Chrome ko'rinishi"
          desc="Worker brauzeri ekranda ko'rinsinmi yoki yashirin (headless) ishlasinmi."
        >
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Brauzer ko'rinsin
              </p>
              <p className="text-[11px] text-slate-400">
                {form.chromeHeadless
                  ? "Hozir: yashirin (headless) — tezroq, ekranda ko'rinmaydi"
                  : "Hozir: ko'rinadigan — kuzatish/debugging uchun"}
              </p>
            </div>
            <Toggle
              on={!form.chromeHeadless}
              onChange={(v) => set("chromeHeadless", !v)}
            />
          </div>
        </Card>

        {/* --- WORKER'LAR --- */}
        <Card
          icon={Cpu}
          title="Worker sig'imi"
          desc="Bitta CPU yadrosiga to'g'ri keladigan parallel worker soni."
        >
          <Field
            label="Worker / CPU yadro"
            hint="Ko'paytirsangiz parallel ishlar ortadi, lekin CPU/RAM yuki oshadi (1–8)."
          >
            <input
              type="number"
              min={1}
              max={8}
              value={form.workerPerCpu}
              onChange={(e) => set("workerPerCpu", num(e.target.value))}
              className={inputCls}
            />
          </Field>
          <div className="flex items-start gap-2 rounded-xl bg-amber-50/60 px-3 py-2.5 text-[11px] text-amber-700 dark:bg-amber-500/5 dark:text-amber-300">
            <InfoCircle size={14} variant="Bold" className="mt-0.5 shrink-0" />
            O'zgartirish ishlab turgan worker-pool'ga ~10 soniyada yetib boradi.
            Worker sonini sezilarli o'zgartirsangiz, poolni qayta ishga tushiring.
          </div>
        </Card>
      </div>

      {/* --- TIMEOUT'LAR --- */}
      <Card
        icon={Timer1}
        title="Vaqt chegaralari va urinishlar"
        desc="Captcha/challenge kutish vaqtlari va qayta urinishlar soni."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Captcha timeout (soniya)"
            hint="Turnstile token kutish (5–180 soniya)."
          >
            <input
              type="number"
              min={5}
              max={180}
              value={Math.round(form.captchaTimeoutMs / 1000)}
              onChange={(e) =>
                set("captchaTimeoutMs", num(e.target.value) * 1000)
              }
              className={inputCls}
            />
          </Field>
          <Field
            label="Cloudflare challenge timeout (soniya)"
            hint="CF challenge kutish (5–180 soniya)."
          >
            <input
              type="number"
              min={5}
              max={180}
              value={Math.round(form.cfChallengeTimeoutMs / 1000)}
              onChange={(e) =>
                set("cfChallengeTimeoutMs", num(e.target.value) * 1000)
              }
              className={inputCls}
            />
          </Field>
          <Field
            label="Maksimal urinishlar"
            hint="Bir bosqich uchun (1–10)."
          >
            <input
              type="number"
              min={1}
              max={10}
              value={form.maxAttempts}
              onChange={(e) => set("maxAttempts", num(e.target.value))}
              className={inputCls}
            />
          </Field>
          <Field
            label="IP qayta urinishlar"
            hint="IP bloklansa yangi IP urinishlari (1–20)."
          >
            <input
              type="number"
              min={1}
              max={20}
              value={form.ipRetries}
              onChange={(e) => set("ipRetries", num(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>
      </Card>

      {/* --- SUPER-ADMIN UNLOCK --- */}
      <Card
        icon={ShieldTick}
        title="Super-admin tasdiqlash"
        desc="Sozlamalarni saqlash uchun super login/parol kiriting (oddiy admin emas)."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Super login">
            <input
              value={superUsername}
              onChange={(e) => setSuperUsername(e.target.value)}
              placeholder="super login"
              autoComplete="off"
              className={inputCls}
            />
          </Field>
          <Field label="Super parol">
            <input
              type="password"
              value={superPassword}
              onChange={(e) => setSuperPassword(e.target.value)}
              placeholder="super parol"
              autoComplete="new-password"
              className={inputCls}
            />
          </Field>
        </div>
      </Card>

      {/* --- SAQLASH --- */}
      <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
        <span className="mr-auto flex items-center gap-1.5 text-xs text-slate-400">
          <Lock1 size={13} variant="Bold" />
          Faqat super-admin saqlay oladi
        </span>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
        >
          <TickCircle size={18} variant="Bold" />
          {saving ? "Saqlanmoqda..." : "Saqlash"}
        </button>
      </div>
    </div>
  );
}
