"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Global,
  Monitor,
  Timer1,
  Cpu,
  Lock1,
  TickCircle,
  Eye,
  EyeSlash,
  InfoCircle,
  Routing,
  Sms,
  Send2,
  DirectInbox,
  Personalcard,
  Calendar,
  Key,
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

// Sarlavha + tavsif bilan toggle qatori (takrorlanishni kamaytirish uchun).
function ToggleRow({
  title,
  desc,
  on,
  onChange,
}: {
  title: string;
  desc: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
      <div className="pr-3">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {title}
        </p>
        <p className="text-[11px] text-slate-400">{desc}</p>
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
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

// Maxfiy maydon (parol/token) — ko'rsatish tugmasi va "saqlangan" ko'rsatkichi bilan.
function SecretField({
  label,
  value,
  onChange,
  show,
  onToggle,
  saved,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  saved: boolean;
  placeholder: string;
}) {
  return (
    <Field
      label={label}
      hint={
        saved
          ? "Saqlangan. O'zgartirish uchun yangi qiymat kiriting."
          : "Hali kiritilmagan."
      }
    >
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={saved ? "•••••••• (saqlangan)" : placeholder}
          autoComplete="new-password"
          className={inputCls + " pr-10"}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          {show ? <EyeSlash size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </Field>
  );
}

export default function SettingsManager() {
  const router = useRouter();
  const { toast } = useToast();

  const [unlocked, setUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [form, setForm] = useState<MaskedSettings | null>(null);
  const [superUsername, setSuperUsername] = useState("");
  const [superPassword, setSuperPassword] = useState("");
  const [saving, setSaving] = useState(false);

  // Yangi maxfiy qiymatlar (bo'sh = tegmaymiz, eski saqlanadi).
  const [proxyPass, setProxyPass] = useState("");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [slotMonitorPassword, setSlotMonitorPassword] = useState("");
  const [showProxyPass, setShowProxyPass] = useState(false);
  const [showBotToken, setShowBotToken] = useState(false);
  const [showImapPass, setShowImapPass] = useState(false);
  const [showSlotPass, setShowSlotPass] = useState(false);

  const set = <K extends keyof MaskedSettings>(
    key: K,
    value: MaskedSettings[K],
  ) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const num = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Qulfni ochish — super login/parolni server'da tekshiradi, sozlamalarni oladi.
  async function unlock() {
    if (!superUsername.trim() || !superPassword.trim()) {
      toast("Super login va parolni kiriting", "error");
      return;
    }
    setUnlocking(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify",
          superUsername,
          superPassword,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast(data?.error || "Login yoki parol noto'g'ri", "error");
        return;
      }
      setForm(data.settings as MaskedSettings);
      setUnlocked(true);
    } catch {
      toast("Ulanishda xatolik", "error");
    } finally {
      setUnlocking(false);
    }
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        superUsername,
        superPassword,
        // Proksi
        proxyEnabled: form.proxyEnabled,
        proxyHost: form.proxyHost,
        proxyPort: form.proxyPort,
        proxyUser: form.proxyUser,
        proxyCountries: form.proxyCountries,
        proxyLogIp: form.proxyLogIp,
        proxySessionTtlMin: form.proxySessionTtlMin,
        // Chrome / brauzer
        chromeHeadless: form.chromeHeadless,
        chromeCdp: form.chromeCdp,
        osClick: form.osClick,
        blockResources: form.blockResources,
        typeDelayMs: form.typeDelayMs,
        // Vaqt chegaralari / urinishlar
        captchaTimeoutMs: form.captchaTimeoutMs,
        cfChallengeTimeoutMs: form.cfChallengeTimeoutMs,
        maxAttempts: form.maxAttempts,
        ipRetries: form.ipRetries,
        workerPerCpu: form.workerPerCpu,
        registerTtlHours: form.registerTtlHours,
        // VFS URL'lari
        registerUrl: form.registerUrl,
        loginUrl: form.loginUrl,
        orderUrl: form.orderUrl,
        calendarUrl: form.calendarUrl,
        warmupUrl: form.warmupUrl,
        // Email / domen
        emailDomain: form.emailDomain,
        // Telegram
        telegramAdminChatIds: form.telegramAdminChatIds,
        // Gmail / IMAP
        imapHost: form.imapHost,
        imapPort: form.imapPort,
        imapUser: form.imapUser,
        imapMailbox: form.imapMailbox,
        imapSecure: form.imapSecure,
        // VFS slot-monitor akkaunti
        slotMonitorEmail: form.slotMonitorEmail,
        // Slot-worker
        slotWorkerIntervalMs: form.slotWorkerIntervalMs,
        slotWorkerConcurrency: form.slotWorkerConcurrency,
        slotNotifyTelegram: form.slotNotifyTelegram,
        slotCheckProxy: form.slotCheckProxy,
      };
      // Maxfiy maydonlar — faqat yangi qiymat kiritilganda yuboriladi.
      if (proxyPass.length > 0) payload.proxyPass = proxyPass;
      if (telegramBotToken.length > 0)
        payload.telegramBotToken = telegramBotToken;
      if (imapPassword.length > 0) payload.imapPassword = imapPassword;
      if (slotMonitorPassword.length > 0)
        payload.slotMonitorPassword = slotMonitorPassword;

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
        setTelegramBotToken("");
        setImapPassword("");
        setSlotMonitorPassword("");
      }
      toast("Sozlamalar saqlandi");
      router.refresh();
    } catch {
      toast("Saqlashda xatolik", "error");
    } finally {
      setSaving(false);
    }
  }

  // --- QULF EKRANI: super login/parolsiz ichkari ochilmaydi ---
  if (!unlocked || !form) {
    return (
      <div className="mx-auto max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-5 flex flex-col items-center text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
              <Lock1 size={28} variant="Bold" />
            </span>
            <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">
              Sozlamalar yopiq
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Ichkariga kirish uchun super login va parolni kiriting.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              unlock();
            }}
            className="space-y-3"
          >
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
            <button
              type="submit"
              disabled={unlocking}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
            >
              <Key size={18} variant="Bold" />
              {unlocking ? "Tekshirilmoqda..." : "Ochish"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const lastInfo = form.updatedBy
    ? `Oxirgi o'zgarish: ${form.updatedBy} · ${new Date(
        form.updatedAt,
      ).toLocaleString("uz-UZ")}`
    : null;

  return (
    <div className="space-y-5 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            Sozlamalar
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Barcha tizim sozlamalari shu yerda. O'zgartirib "Saqlash"ni bosing.
          </p>
          {lastInfo && (
            <p className="mt-1 text-[11px] text-slate-400">{lastInfo}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setUnlocked(false);
            setForm(null);
            setSuperPassword("");
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Lock1 size={14} variant="Bold" />
          Qulflash
        </button>
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
            <SecretField
              label="Parol"
              value={proxyPass}
              onChange={setProxyPass}
              show={showProxyPass}
              onToggle={() => setShowProxyPass((s) => !s)}
              saved={form.hasProxyPass}
              placeholder="proksi parol"
            />
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Sessiya muddati (daqiqa)"
              hint="Bitta proksi sessiyasi necha daqiqa saqlanadi (1–1440)."
            >
              <input
                type="number"
                min={1}
                max={1440}
                value={form.proxySessionTtlMin}
                onChange={(e) => set("proxySessionTtlMin", num(e.target.value))}
                className={inputCls}
              />
            </Field>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
              <div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  IP loglansin
                </p>
                <p className="text-[11px] text-slate-400">
                  Har sessiyada chiqish IP manzilini logga yozish (debug).
                </p>
              </div>
              <Toggle
                on={form.proxyLogIp}
                onChange={(v) => set("proxyLogIp", v)}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* --- VFS URL'LARI --- */}
      <Card
        icon={Routing}
        title="VFS havolalari (URL)"
        desc="Avtomatlashtirish ishlatadigan VFS sahifa manzillari. Sayt o'zgarsa shu yerdan yangilanadi."
      >
        <Field
          label="Ro'yxatdan o'tish (register) URL"
          hint="VFS register sahifasi."
        >
          <input
            value={form.registerUrl}
            onChange={(e) => set("registerUrl", e.target.value)}
            placeholder="https://visa.vfsglobal.com/.../register"
            className={inputCls}
          />
        </Field>
        <Field label="Kirish (login) URL" hint="VFS login sahifasi.">
          <input
            value={form.loginUrl}
            onChange={(e) => set("loginUrl", e.target.value)}
            placeholder="https://visa.vfsglobal.com/.../login"
            className={inputCls}
          />
        </Field>
        <Field label="Buyurtma (order/booking) URL" hint="Ariza/booking sahifasi.">
          <input
            value={form.orderUrl}
            onChange={(e) => set("orderUrl", e.target.value)}
            placeholder="https://visa.vfsglobal.com/.../application-detail"
            className={inputCls}
          />
        </Field>
        <Field
          label="Kalendar (slot) URL"
          hint="Bo'sh slotlar tekshiriladigan sahifa."
        >
          <input
            value={form.calendarUrl}
            onChange={(e) => set("calendarUrl", e.target.value)}
            placeholder="https://visa.vfsglobal.com/.../slot"
            className={inputCls}
          />
        </Field>
        <Field
          label="Warm-up URL"
          hint="Sessiyani qizdirish uchun ochiladigan sahifa (ixtiyoriy)."
        >
          <input
            value={form.warmupUrl}
            onChange={(e) => set("warmupUrl", e.target.value)}
            placeholder="https://visa.vfsglobal.com/"
            className={inputCls}
          />
        </Field>
      </Card>

      {/* --- EMAIL / DOMEN --- */}
      <Card
        icon={Sms}
        title="Email domeni"
        desc="Ariza uchun avtomatik yaratiladigan pochta manzillari domeni."
      >
        <Field
          label="Email domeni"
          hint="Masalan: example.com — yaratilgan pochtalar user@example.com ko'rinishida bo'ladi."
        >
          <input
            value={form.emailDomain}
            onChange={(e) => set("emailDomain", e.target.value)}
            placeholder="example.com"
            className={inputCls}
          />
        </Field>
      </Card>

      {/* --- TELEGRAM BOT --- */}
      <Card
        icon={Send2}
        title="Telegram bot"
        desc="Bildirishnomalar yuboriladigan bot va admin chat ID'lari."
      >
        <SecretField
          label="Bot token"
          value={telegramBotToken}
          onChange={setTelegramBotToken}
          show={showBotToken}
          onToggle={() => setShowBotToken((s) => !s)}
          saved={form.hasTelegramBotToken}
          placeholder="123456:ABC-DEF..."
        />
        <Field
          label="Admin chat ID'lari (vergul bilan)"
          hint="Bildirishnoma keladigan Telegram chat ID'lari. Masalan: 123456789,987654321"
        >
          <input
            value={form.telegramAdminChatIds}
            onChange={(e) => set("telegramAdminChatIds", e.target.value)}
            placeholder="123456789,987654321"
            className={inputCls}
          />
        </Field>
      </Card>

      {/* --- GMAIL / IMAP --- */}
      <Card
        icon={DirectInbox}
        title="Gmail / IMAP qutisi"
        desc="Tasdiqlash kodlari (OTP) o'qiladigan pochta qutisi sozlamalari."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label="IMAP host" hint="Masalan: imap.gmail.com">
              <input
                value={form.imapHost}
                onChange={(e) => set("imapHost", e.target.value)}
                placeholder="imap.gmail.com"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Port" hint="Odatda 993">
            <input
              type="number"
              min={1}
              max={65535}
              value={form.imapPort}
              onChange={(e) => set("imapPort", num(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Foydalanuvchi (email)">
            <input
              value={form.imapUser}
              onChange={(e) => set("imapUser", e.target.value)}
              placeholder="inbox@gmail.com"
              autoComplete="off"
              className={inputCls}
            />
          </Field>
          <SecretField
            label="Parol (app password)"
            value={imapPassword}
            onChange={setImapPassword}
            show={showImapPass}
            onToggle={() => setShowImapPass((s) => !s)}
            saved={form.hasImapPassword}
            placeholder="Gmail app password"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Papka (mailbox)" hint="Odatda INBOX">
            <input
              value={form.imapMailbox}
              onChange={(e) => set("imapMailbox", e.target.value)}
              placeholder="INBOX"
              className={inputCls}
            />
          </Field>
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/50">
            <div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Xavfsiz (TLS/SSL)
              </p>
              <p className="text-[11px] text-slate-400">
                993-port uchun yoqilgan bo'lsin.
              </p>
            </div>
            <Toggle
              on={form.imapSecure}
              onChange={(v) => set("imapSecure", v)}
            />
          </div>
        </div>
      </Card>

      {/* --- VFS SLOT-MONITOR AKKAUNTI --- */}
      <Card
        icon={Personalcard}
        title="VFS slot-monitor akkaunti"
        desc="Bo'sh slotlarni kuzatish uchun ishlatiladigan VFS hisob ma'lumotlari."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email">
            <input
              value={form.slotMonitorEmail}
              onChange={(e) => set("slotMonitorEmail", e.target.value)}
              placeholder="monitor@example.com"
              autoComplete="off"
              className={inputCls}
            />
          </Field>
          <SecretField
            label="Parol"
            value={slotMonitorPassword}
            onChange={setSlotMonitorPassword}
            show={showSlotPass}
            onToggle={() => setShowSlotPass((s) => !s)}
            saved={form.hasSlotMonitorPassword}
            placeholder="VFS akkaunt paroli"
          />
        </div>
      </Card>

      {/* --- CHROME + WORKER (yonma-yon) --- */}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {/* --- CHROME / BRAUZER --- */}
        <Card
          icon={Monitor}
          title="Chrome / brauzer"
          desc="Worker brauzeri qanday ishlashini sozlash."
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
          <ToggleRow
            title="CDP (DevTools Protocol)"
            desc="Tezroq va barqaror boshqaruv uchun CDP ulanishi."
            on={form.chromeCdp}
            onChange={(v) => set("chromeCdp", v)}
          />
          <ToggleRow
            title="OS-bosish (haqiqiy klik)"
            desc="Tizim darajasida sichqoncha bosishi (bot aniqlashga qarshi)."
            on={form.osClick}
            onChange={(v) => set("osClick", v)}
          />
          <ToggleRow
            title="Resurslarni bloklash"
            desc="Rasm/shrift/CSS yuklamaslik — tezlik uchun."
            on={form.blockResources}
            onChange={(v) => set("blockResources", v)}
          />
          <Field
            label="Yozish tezligi (ms / belgi)"
            hint="Maydonlarga yozishda belgilararo kechikish (0–500 ms)."
          >
            <input
              type="number"
              min={0}
              max={500}
              value={form.typeDelayMs}
              onChange={(e) => set("typeDelayMs", num(e.target.value))}
              className={inputCls}
            />
          </Field>
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
          <Field
            label="Register amal qilish muddati (soat)"
            hint="Ro'yxatdan o'tgan akkaunt necha soat yaroqli (1–168)."
          >
            <input
              type="number"
              min={1}
              max={168}
              value={form.registerTtlHours}
              onChange={(e) => set("registerTtlHours", num(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>
      </Card>

      {/* --- SLOT-WORKER --- */}
      <Card
        icon={Calendar}
        title="Slot kuzatuvchi (worker)"
        desc="Bo'sh slotlarni avtomatik tekshirish davriyligi va sozlamalari."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Tekshirish oralig'i (daqiqa)"
            hint="Har necha daqiqada slot tekshiriladi (1–60)."
          >
            <input
              type="number"
              min={1}
              max={60}
              value={Math.round(form.slotWorkerIntervalMs / 60000)}
              onChange={(e) =>
                set("slotWorkerIntervalMs", num(e.target.value) * 60000)
              }
              className={inputCls}
            />
          </Field>
          <Field
            label="Parallel tekshiruv (concurrency)"
            hint="Bir vaqtda nechta tekshiruv (1–10)."
          >
            <input
              type="number"
              min={1}
              max={10}
              value={form.slotWorkerConcurrency}
              onChange={(e) =>
                set("slotWorkerConcurrency", num(e.target.value))
              }
              className={inputCls}
            />
          </Field>
        </div>
        <ToggleRow
          title="Telegram'ga xabar"
          desc="Bo'sh slot topilsa Telegram'ga bildirishnoma yuborilsin."
          on={form.slotNotifyTelegram}
          onChange={(v) => set("slotNotifyTelegram", v)}
        />
        <ToggleRow
          title="Proksi orqali tekshirish"
          desc="Slot tekshiruvi ham proksi orqali amalga oshirilsin."
          on={form.slotCheckProxy}
          onChange={(v) => set("slotCheckProxy", v)}
        />
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
