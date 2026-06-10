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
  SearchStatus1,
  TaskSquare,
  MessageText1,
  Clock,
  Activity,
  Code,
} from "iconsax-react";
import { useToast } from "@/components/Toast";
import type { FullSettings } from "@/lib/settings";

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

// Maxfiy maydon (parol/token) — super login bilan kirilgani uchun qiymat OCHIQ
// ko'rsatiladi (boshqaruv uchun). Ko'z tugmasi bilan yashirish mumkin.
function RevealField({
  label,
  hint,
  value,
  onChange,
  show,
  onToggle,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="new-password"
          spellCheck={false}
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
  const [form, setForm] = useState<FullSettings | null>(null);
  const [superUsername, setSuperUsername] = useState("");
  const [superPassword, setSuperPassword] = useState("");
  const [saving, setSaving] = useState(false);

  // Maxfiy qiymatlar OCHIQ ko'rsatiladi (super login bilan kirilgan) — ko'z
  // tugmasi bilan istalgancha yashirish mumkin.
  const [showProxyPass, setShowProxyPass] = useState(true);
  const [showBotToken, setShowBotToken] = useState(true);
  const [showImapPass, setShowImapPass] = useState(true);
  const [showSlotPass, setShowSlotPass] = useState(true);

  const set = <K extends keyof FullSettings>(key: K, value: FullSettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

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
      setForm(data.settings as FullSettings);
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
      // Butun forma + super login yuboriladi (maxfiy qiymatlar ham — ular
      // ochiq ko'rsatilgan). Server faqat o'zi tanigan maydonlarni qabul qiladi.
      const payload = { ...form, superUsername, superPassword };

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
        setForm(data.settings as FullSettings);
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
    <div className="pb-24">
      <div className="mb-5 flex items-start justify-between gap-3">
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

      {/* Barcha kartalar — to'liq enli masonry (ustunlarga taqsimlanadi) */}
      <div className="columns-1 gap-5 lg:columns-2 2xl:columns-3 [&>section]:mb-5 [&>section]:break-inside-avoid">
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
            <RevealField
              label="Parol"
              hint="Proksi paroli (ochiq ko'rsatilgan)."
              value={form.proxyPass}
              onChange={(v) => set("proxyPass", v)}
              show={showProxyPass}
              onToggle={() => setShowProxyPass((s) => !s)}
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
        <RevealField
          label="Bot token"
          hint="Telegram bot tokeni (ochiq ko'rsatilgan)."
          value={form.telegramBotToken}
          onChange={(v) => set("telegramBotToken", v)}
          show={showBotToken}
          onToggle={() => setShowBotToken((s) => !s)}
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
          <RevealField
            label="Parol (app password)"
            hint="Gmail App Password (ochiq ko'rsatilgan)."
            value={form.imapPassword}
            onChange={(v) => set("imapPassword", v)}
            show={showImapPass}
            onToggle={() => setShowImapPass((s) => !s)}
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
          <RevealField
            label="Parol"
            hint="VFS akkaunt paroli (ochiq ko'rsatilgan)."
            value={form.slotMonitorPassword}
            onChange={(v) => set("slotMonitorPassword", v)}
            show={showSlotPass}
            onToggle={() => setShowSlotPass((s) => !s)}
            placeholder="VFS akkaunt paroli"
          />
        </div>
      </Card>

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

      {/* --- WEB SLOT-CHECK MATNLARI --- */}
      <Card
        icon={SearchStatus1}
        title="Web slot-check matnlari"
        desc="Oddiy sahifada slot ochiq/yopiqligini aniqlovchi matnlar (| bilan)."
      >
        <Field
          label="Slot sahifa URL"
          hint="Slot holati ko'rsatiladigan sahifa."
        >
          <input
            value={form.bookingSlotUrl}
            onChange={(e) => set("bookingSlotUrl", e.target.value)}
            placeholder="https://example.com/slots"
            className={inputCls}
          />
        </Field>
        <Field
          label="Ochiq slot matnlari"
          hint="Shu matn(lar) bo'lsa = slot OCHIQ. | bilan ajrating."
        >
          <input
            value={form.bookingSlotOpenText}
            onChange={(e) => set("bookingSlotOpenText", e.target.value)}
            placeholder="available|book now|select slot"
            className={inputCls}
          />
        </Field>
        <Field
          label="Yopiq slot matnlari"
          hint="Shu matn(lar) bo'lsa = slot YOPIQ. | bilan ajrating."
        >
          <input
            value={form.bookingSlotClosedText}
            onChange={(e) => set("bookingSlotClosedText", e.target.value)}
            placeholder="no appointment|fully booked|closed"
            className={inputCls}
          />
        </Field>
      </Card>

      {/* --- VFS KALENDAR TANLOVLARI --- */}
      <Card
        icon={TaskSquare}
        title="VFS kalendar tanlovlari"
        desc="Kalendar tekshiruvida tanlanadigan markaz/kategoriya va slot matnlari."
      >
        <Field label="Markaz (centre)" hint="BOOKING_CALENDAR_CENTRE">
          <input
            value={form.calendarCentre}
            onChange={(e) => set("calendarCentre", e.target.value)}
            placeholder="VFS GLOBAL SERVICES ..."
            className={inputCls}
          />
        </Field>
        <Field label="Kategoriya (category)" hint="BOOKING_CALENDAR_CATEGORY">
          <input
            value={form.calendarCategory}
            onChange={(e) => set("calendarCategory", e.target.value)}
            placeholder="Latvia Long Stay/Visa D"
            className={inputCls}
          />
        </Field>
        <Field
          label="Sub-kategoriya (subcategory)"
          hint="BOOKING_CALENDAR_SUBCATEGORY"
        >
          <input
            value={form.calendarSubcategory}
            onChange={(e) => set("calendarSubcategory", e.target.value)}
            placeholder="Cargo drivers (Visa D) ..."
            className={inputCls}
          />
        </Field>
        <Field
          label="Bo'sh slot yo'q matni"
          hint="Sahifada shu matn bo'lsa = YOPIQ. | bilan ajrating."
        >
          <input
            value={form.calendarNoSlotText}
            onChange={(e) => set("calendarNoSlotText", e.target.value)}
            placeholder="no appointment slots are currently available"
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Continue tugma matni" hint="Faol bo'lsa = slot bor.">
            <input
              value={form.continueText}
              onChange={(e) => set("continueText", e.target.value)}
              placeholder="Continue"
              className={inputCls}
            />
          </Field>
          <Field
            label="Sahifa render kutish (soniya)"
            hint="SPA yuklanishini kutish (1-120)."
          >
            <input
              type="number"
              min={1}
              max={120}
              value={Math.round(form.calendarReadyMs / 1000)}
              onChange={(e) =>
                set("calendarReadyMs", num(e.target.value) * 1000)
              }
              className={inputCls}
            />
          </Field>
        </div>
      </Card>

      {/* --- AKTIVATSIYA XATI --- */}
      <Card
        icon={MessageText1}
        title="Aktivatsiya xati (IMAP)"
        desc="Ro'yxatdan o'tgach keladigan tasdiqlash xatini kutish sozlamalari."
      >
        <Field
          label="Jo'natuvchi(lar)"
          hint="Aktivatsiya xati jo'natuvchisi. | bilan ajrating."
        >
          <input
            value={form.activationFrom}
            onChange={(e) => set("activationFrom", e.target.value)}
            placeholder="vfsglobal.com|donotreply"
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Kutish (soniya)" hint="Jami (10-1800)">
            <input
              type="number"
              min={10}
              max={1800}
              value={Math.round(form.activationTimeoutMs / 1000)}
              onChange={(e) =>
                set("activationTimeoutMs", num(e.target.value) * 1000)
              }
              className={inputCls}
            />
          </Field>
          <Field label="Oraliq (soniya)" hint="1-60">
            <input
              type="number"
              min={1}
              max={60}
              value={Math.round(form.activationPollMs / 1000)}
              onChange={(e) =>
                set("activationPollMs", num(e.target.value) * 1000)
              }
              className={inputCls}
            />
          </Field>
          <Field label="Oldingacha (daqiqa)" hint="1-1440">
            <input
              type="number"
              min={1}
              max={1440}
              value={Math.round(form.activationSinceMs / 60000)}
              onChange={(e) =>
                set("activationSinceMs", num(e.target.value) * 60000)
              }
              className={inputCls}
            />
          </Field>
        </div>
      </Card>

      {/* --- SLOT LOGIN / BACKOFF --- */}
      <Card
        icon={Clock}
        title="Slot login va backoff"
        desc="Kalendar akkaunti login urinishlari va bloklanishdan keyingi kutish."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field
            label="Blok backoff (daqiqa)"
            hint="429 blok bo'lsa (1-4320)."
          >
            <input
              type="number"
              min={1}
              max={4320}
              value={form.slotRestrictedBackoffMin}
              onChange={(e) =>
                set("slotRestrictedBackoffMin", num(e.target.value))
              }
              className={inputCls}
            />
          </Field>
          <Field label="Login captcha urinish" hint="1-10">
            <input
              type="number"
              min={1}
              max={10}
              value={form.slotLoginCaptchaRetries}
              onChange={(e) =>
                set("slotLoginCaptchaRetries", num(e.target.value))
              }
              className={inputCls}
            />
          </Field>
          <Field label="Login cooldown (daqiqa)" hint="0-1440">
            <input
              type="number"
              min={0}
              max={1440}
              value={form.slotLoginCooldownMin}
              onChange={(e) =>
                set("slotLoginCooldownMin", num(e.target.value))
              }
              className={inputCls}
            />
          </Field>
        </div>
      </Card>

      {/* --- CAPTCHA VAQTLARI (qo'shimcha) --- */}
      <Card
        icon={Activity}
        title="Captcha vaqtlari (qo'shimcha)"
        desc="Turnstile auto-pass / OS-klik bilan bog'liq nozik vaqtlar (ms)."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Auto-pass (ms)" hint="100-30000">
            <input
              type="number"
              min={100}
              max={30000}
              value={form.captchaAutopassMs}
              onChange={(e) => set("captchaAutopassMs", num(e.target.value))}
              className={inputCls}
            />
          </Field>
          <Field label="Verify paydo (ms)" hint="500-60000">
            <input
              type="number"
              min={500}
              max={60000}
              value={form.verifyCaptchaAppearMs}
              onChange={(e) =>
                set("verifyCaptchaAppearMs", num(e.target.value))
              }
              className={inputCls}
            />
          </Field>
          <Field label="O'lchash (ms)" hint="1000-60000">
            <input
              type="number"
              min={1000}
              max={60000}
              value={form.captchaMeasureMs}
              onChange={(e) => set("captchaMeasureMs", num(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>
      </Card>

      {/* --- BRAUZER (qo'shimcha) --- */}
      <Card
        icon={Code}
        title="Brauzer (qo'shimcha)"
        desc="Fingerprint, Chrome yo'li va cache (tajribali foydalanuvchi uchun)."
      >
        <Field label="User-Agent" hint="Bo'sh = avtomatik (real Chrome).">
          <input
            value={form.userAgent}
            onChange={(e) => set("userAgent", e.target.value)}
            placeholder="Mozilla/5.0 ..."
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Viewport" hint="Masalan: 1366x768">
            <input
              value={form.viewport}
              onChange={(e) => set("viewport", e.target.value)}
              placeholder="1366x768"
              className={inputCls}
            />
          </Field>
          <Field label="CDP port" hint="1-65535">
            <input
              type="number"
              min={1}
              max={65535}
              value={form.cdpPort}
              onChange={(e) => set("cdpPort", num(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>
        <Field label="Chrome yo'li (path)" hint="Bo'sh = ichki Chromium.">
          <input
            value={form.chromePath}
            onChange={(e) => set("chromePath", e.target.value)}
            placeholder="C:/.../chrome.exe"
            className={inputCls}
          />
        </Field>
        <ToggleRow
          title="Toza profil (fresh)"
          desc="Har ishda sessiya/cookie tozalanadi."
          on={form.cdpFreshProfile}
          onChange={(v) => set("cdpFreshProfile", v)}
        />
        <ToggleRow
          title="Cache saqlash"
          desc="HTTP cache (JS bundle) saqlanadi - tezroq."
          on={form.cdpKeepCache}
          onChange={(v) => set("cdpKeepCache", v)}
        />
        <ToggleRow
          title="CMS cache"
          desc="Contentful matn javoblari diskda saqlanadi."
          on={form.cmsCache}
          onChange={(v) => set("cmsCache", v)}
        />
        <ToggleRow
          title="Asset cache"
          desc="Versiyalangan JS/CSS diskda saqlanadi."
          on={form.assetCache}
          onChange={(v) => set("assetCache", v)}
        />
      </Card>
      </div>

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
