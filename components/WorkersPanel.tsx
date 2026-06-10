"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Refresh,
  Cpu,
  AddCircle,
  Flash,
  Warning2,
  Box,
  Trash,
  Danger,
  CloseCircle,
  DocumentText,
  TickCircle,
  Clock,
  SearchNormal1,
} from "iconsax-react";
import { useToast } from "@/components/Toast";

type WorkerRow = {
  id: number;
  name: string;
  active: boolean;
  status: string;
  live: boolean;
  jobsDone: number;
  currentJob: string | null;
  host: string | null;
  pid: number | null;
  lastError: string | null;
  lastSeenAt: string | null;
};

type Cpu = {
  cores: number;
  perCpu: number;
  recommendedMax: number;
  activeNow: number;
  overLimit: boolean;
  message: string;
};

type ProxyHealth = {
  ok: boolean;
  enabled: boolean;
  status?: number;
  exitIp?: string;
  outOfBalance: boolean;
  reason: string;
  checkedAt: number;
};

type Snapshot = {
  workers: WorkerRow[];
  cpu: Cpu;
  queueDepth: number;
  proxy: ProxyHealth | null;
};

// ----------------------------- Holat (status) -----------------------------
// Worker holatlari (aniq va tushunarli):
//  off     — admin o'chirib qo'ygan (active=false)
//  waiting — yoniq, lekin pool hali ushlamagan (status=offline)
//  ready   — yoniq, tirik, ish kutyapti (idle)
//  busy    — hozir ish bajaryapti (currentJob bor)
//  stale   — yoniq, lekin aloqa yo'q (heartbeat eskirgan)
type WStatus = "off" | "waiting" | "ready" | "busy" | "stale";

function workerStatus(w: WorkerRow): WStatus {
  if (!w.active) return "off";
  if (w.status === "offline") return "waiting";
  if (!w.live) return "stale";
  if (w.status === "busy") return "busy";
  return "ready";
}

type StatusUi = {
  label: string;
  dot: string;
  chip: string;
  card: string;
};

const STATUS_UI: Record<WStatus, StatusUi> = {
  off: {
    label: "O'chirilgan",
    dot: "bg-slate-300 dark:bg-slate-600",
    chip: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
    card: "border-dashed border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/30",
  },
  waiting: {
    label: "Kutilmoqda",
    dot: "bg-sky-400",
    chip: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-300",
    card: "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
  },
  ready: {
    label: "Tayyor",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
    card: "border-emerald-200/70 bg-emerald-50/30 dark:border-emerald-500/20 dark:bg-emerald-500/5",
  },
  busy: {
    label: "Band",
    dot: "bg-amber-500 animate-pulse",
    chip: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
    card: "border-amber-300/70 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-500/5",
  },
  stale: {
    label: "Aloqa yo'q",
    dot: "bg-rose-500",
    chip: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300",
    card: "border-rose-200 bg-rose-50/30 dark:border-rose-500/20 dark:bg-rose-500/5",
  },
};

// currentJob = "register #42" — bosqichga qarab rang beradi.
function jobTone(job: string): string {
  const s = job.toLowerCase();
  if (s.startsWith("register"))
    return "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300";
  if (s.startsWith("login"))
    return "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300";
  if (s.startsWith("order"))
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
  if (s.startsWith("activation"))
    return "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300";
  if (s.startsWith("slot"))
    return "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";
  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

// ----------------------------- Loglar (step'lar) -----------------------------
// Bitta worker bajargan ishlar tarixi (AutomationLog) — modalda ko'rsatiladi.
type WorkerLog = {
  id: number;
  stage: string;
  attempt: number;
  ok: boolean;
  note: string | null;
  pageError?: string | null;
  durationMs: number;
  statusCode: number | null;
  exitIp: string | null;
  finalUrl: string | null;
  workerProfile?: string | null;
  applicantId: number | null;
  groupId?: number | null;
  createdAt: string;
  applicant: {
    surname: string | null;
    name: string | null;
    generatedEmail: string | null;
  } | null;
};

// Bosqich (stage) nomlari — log modalida o'qiladigan ko'rinishda.
const STAGE_LABELS: Record<string, string> = {
  register: "Ro'yxatdan o'tish",
  login: "Kirish",
  order: "Buyurtma",
  activation: "Faollashtirish",
  slot: "Slot tekshiruvi",
};

function applicantName(a: WorkerLog["applicant"]): string {
  if (!a) return "";
  const full = [a.surname, a.name].filter(Boolean).join(" ").trim();
  return full || a.generatedEmail || "";
}

// Log vaqti: bugun bo'lsa HH:MM:SS, aks holda DD/MM HH:MM.
function fmtTime(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const t = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  if (d.toDateString() === new Date().toDateString()) return t;
  const dm = d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
  });
  return `${dm} ${t.slice(0, 5)}`;
}

export default function WorkersPanel() {
  const { toast } = useToast();
  const [data, setData] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [confirmDel, setConfirmDel] = useState<WorkerRow | null>(null);
  const [logsFor, setLogsFor] = useState<WorkerRow | null>(null);
  const [logs, setLogs] = useState<WorkerLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // --- Loglarni qidirish (xato / arizachi / worker bo'yicha) ---
  const [searchQ, setSearchQ] = useState("");
  const [searchStatus, setSearchStatus] = useState<"all" | "ok" | "fail">(
    "all",
  );
  const [searchResults, setSearchResults] = useState<WorkerLog[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/workers", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as Snapshot | null;
      if (res.ok && json) setData(json);
    } catch {
      // jim
    }
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  const act = useCallback(
    async (action: string, value: number) => {
      setBusy(true);
      try {
        const res = await fetch("/api/workers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, value }),
        });
        const json = (await res.json().catch(() => null)) as
          | (Snapshot & { error?: string })
          | null;
        if (res.ok && json) {
          setData(json);
          if (json.cpu.overLimit) {
            toast(json.cpu.message, "error");
          } else {
            toast("Bajarildi", "success");
          }
        } else {
          toast(json?.error || "Bajarilmadi", "error");
        }
      } catch {
        toast("Tarmoq xatosi", "error");
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  // Modaldagi "O'chirish" tugmasi bosilganda.
  const doDelete = useCallback(async () => {
    if (!confirmDel) return;
    const id = confirmDel.id;
    setConfirmDel(null);
    await act("delete", id);
  }, [confirmDel, act]);

  // Worker loglarini (step'larini) yuklaydi.
  const loadLogs = useCallback(async (name: string) => {
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/workers?logs=${encodeURIComponent(name)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as {
        logs?: WorkerLog[];
      } | null;
      if (res.ok && json?.logs) setLogs(json.logs);
    } catch {
      // jim
    } finally {
      setLogsLoading(false);
    }
  }, []);

  // Worker kartochkasidagi "Loglar" bosilganda modalni ochadi.
  const openLogs = useCallback(
    (w: WorkerRow) => {
      setLogsFor(w);
      setLogs([]);
      loadLogs(w.name);
    },
    [loadLogs],
  );

  // Modal ochiq turganda har 4 soniyada loglarni jonli yangilaydi.
  useEffect(() => {
    if (!logsFor) return;
    const id = window.setInterval(() => loadLogs(logsFor.name), 4000);
    return () => window.clearInterval(id);
  }, [logsFor, loadLogs]);

  // Loglarni qidiradi (xato matni / arizachi / worker), natijani modalda ochadi.
  const runSearch = useCallback(async () => {
    const q = searchQ.trim();
    if (!q && searchStatus === "all") {
      toast("Qidiruv so'zini kiriting yoki holatni tanlang", "error");
      return;
    }
    setSearchLoading(true);
    setSearchOpen(true);
    try {
      const params = new URLSearchParams();
      params.set("search", q);
      if (searchStatus !== "all") params.set("status", searchStatus);
      const res = await fetch(`/api/workers?${params.toString()}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as {
        results?: WorkerLog[];
      } | null;
      setSearchResults(res.ok && json?.results ? json.results : []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [searchQ, searchStatus, toast]);

  const cpu = data?.cpu;
  const workers = data?.workers ?? [];
  const total = workers.length;
  const activeCount = workers.filter((w) => w.active).length;
  const busyCount = workers.filter((w) => workerStatus(w) === "busy").length;
  const queueDepth = data?.queueDepth ?? 0;
  const proxy = data?.proxy ?? null;
  // Modal ochiq bo'lsa, worker holatini jonli (asosiy poll'dan) oladi.
  const liveLogWorker = logsFor
    ? workers.find((w) => w.id === logsFor.id) ?? logsFor
    : null;

  return (
    <div className="card">
      {/* Sarlavha + statistika */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
            <Box size={22} variant="Bold" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Workerlar
            </h2>
            <p className="text-xs text-slate-400">
              Har bir worker = 1 ta Chrome. Ish navbatdan tartib bilan olinadi.
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Refresh size={14} /> Yangilash
        </button>
      </div>

      {/* Statistika kartochkalari — holatlar aniq tepada */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard label="Jami" value={total} tone="slate" />
        <StatCard label="Yoniq" value={activeCount} tone="emerald" />
        <StatCard label="Band (ishda)" value={busyCount} tone="amber" />
        <StatCard label="Navbatda" value={queueDepth} tone="indigo" />
      </div>

      {/* Loglarni qidirish — xato matni, arizachi (ism/familiya/email) yoki
          worker nomi bo'yicha. Qaysi worker, qachon, qanday holat ko'rsatadi. */}
      <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <SearchNormal1
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runSearch();
              }}
              placeholder="Xato matni, arizachi ismi/familiyasi, email yoki worker nomi…"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-brand-500/20"
            />
          </div>
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            {(
              [
                ["all", "Hammasi"],
                ["fail", "Xato"],
                ["ok", "OK"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setSearchStatus(val)}
                className={`px-3 py-2 text-xs font-semibold transition ${
                  searchStatus === val
                    ? val === "fail"
                      ? "bg-rose-600 text-white"
                      : val === "ok"
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-700 text-white dark:bg-slate-600"
                    : "bg-white text-slate-500 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={runSearch}
            disabled={searchLoading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            <SearchNormal1 size={14} variant="Bold" />
            {searchLoading ? "Qidirilmoqda…" : "Qidirish"}
          </button>
        </div>
      </div>

      {/* PROKSI holati — o'lik bo'lsa worker'lar behuda Chrome ochmaydi */}
      {proxy && proxy.enabled && !proxy.ok && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <Danger size={16} variant="Bold" className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">
              {proxy.outOfBalance
                ? "Proksi balansi tugagan — ish bajarilmaydi"
                : "Proksi ishlamayapti — ish bajarilmaydi"}
            </div>
            <p className="mt-0.5 leading-relaxed">
              {proxy.reason}. Worker'lar bu holatda behuda Chrome ochmaydi —
              proksi tiklangach ishlar avtomatik davom etadi.
            </p>
          </div>
        </div>
      )}
      {proxy && proxy.enabled && proxy.ok && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          <TickCircle size={15} variant="Bold" className="shrink-0" />
          <span className="font-medium">
            Proksi tirik{proxy.exitIp ? ` · chiqish IP ${proxy.exitIp}` : ""}
          </span>
        </div>
      )}

      {/* CPU sig'imi banneri */}
      {cpu && (
        <div
          className={`mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-xs ${
            cpu.overLimit
              ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
              : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
          }`}
        >
          {cpu.overLimit ? (
            <Warning2 size={16} variant="Bold" className="mt-0.5 shrink-0" />
          ) : (
            <Cpu size={16} variant="Bold" className="mt-0.5 shrink-0" />
          )}
          <div>
            <div className="font-semibold">
              {cpu.cores} CPU yadro × {cpu.perCpu} = tavsiya max{" "}
              {cpu.recommendedMax} ta yoniq
            </div>
            <p className="mt-0.5 leading-relaxed">{cpu.message}</p>
          </div>
        </div>
      )}

      {/* Boshqaruv — bittalab yoki ko'pdan qo'shish, hammasini boshqarish */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => act("on", total)}
          disabled={busy || !total || activeCount === total}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-40"
        >
          <Flash size={15} variant="Bold" /> Hammasini yoqish
        </button>
        <button
          onClick={() => act("on", 0)}
          disabled={busy || activeCount === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Hammasini o'chirish
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => act("add", 1)}
            disabled={busy}
            title="Bitta worker qo'shish"
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-500/30 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
          >
            <AddCircle size={16} variant="Bold" /> +1
          </button>
          <input
            type="number"
            min={1}
            placeholder="10"
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            className="w-16 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
          <button
            onClick={() => {
              act("add", Number(addInput));
              setAddInput("");
            }}
            disabled={busy || addInput === ""}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            Qo'shish
          </button>
        </div>
      </div>

      {/* Worker ro'yxati */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {workers.map((w) => {
          const st = workerStatus(w);
          const ui = STATUS_UI[st];
          return (
            <div
              key={w.id}
              className={`flex flex-col rounded-xl border p-3 transition ${ui.card}`}
            >
              {/* Yuqori qator: nuqta + nom + #id + o'chirish */}
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${ui.dot}`}
                  />
                  <span className="truncate text-sm font-bold text-slate-700 dark:text-slate-100">
                    {w.name}
                  </span>
                  <span className="shrink-0 text-[10px] font-medium text-slate-400">
                    #{w.id}
                  </span>
                </div>
                <button
                  onClick={() => setConfirmDel(w)}
                  disabled={busy}
                  title="Workerni o'chirish"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50 dark:text-slate-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                >
                  <Trash size={15} />
                </button>
              </div>

              {/* Holat + bajargan ishlar */}
              <div className="mt-2 flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${ui.chip}`}
                >
                  {ui.label}
                </span>
                <span className="text-[11px] text-slate-400">
                  {w.jobsDone} ish bajargan
                </span>
              </div>

              {/* Hozir qaysi taskni bajaryapti */}
              {w.currentJob ? (
                <div
                  className={`mt-2 truncate rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${jobTone(
                    w.currentJob,
                  )}`}
                  title={w.currentJob}
                >
                  ▶ {w.currentJob}
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-slate-400">
                  {w.pid ? `PID ${w.pid} · ish yo'q` : "ish yo'q"}
                </div>
              )}

              {w.lastError && (
                <div
                  className="mt-1.5 truncate text-[10px] text-rose-500"
                  title={w.lastError}
                >
                  xato: {w.lastError}
                </div>
              )}

              {/* Loglarni ko'rish (step'lar) */}
              <button
                onClick={() => openLogs(w)}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-[11px] font-semibold text-slate-500 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400 dark:hover:border-indigo-500/30 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-300"
              >
                <DocumentText size={13} variant="Bold" /> Loglar (step'lar)
              </button>

              {/* Yoqish/o'chirish — chiroyli toggle */}
              <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2.5 dark:border-slate-800">
                <span
                  className={`text-[11px] font-medium ${
                    w.active
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-slate-400"
                  }`}
                >
                  {w.active ? "Yoniq" : "O'chiq"}
                </span>
                <button
                  role="switch"
                  aria-checked={w.active}
                  onClick={() => act(w.active ? "disable" : "enable", w.id)}
                  disabled={busy}
                  title={w.active ? "O'chirish" : "Yoqish"}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                    w.active
                      ? "bg-emerald-500"
                      : "bg-slate-300 dark:bg-slate-600"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                      w.active ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {workers.length === 0 && (
        <p className="py-6 text-center text-sm text-slate-400">
          Worker topilmadi. Sahifani yangilang.
        </p>
      )}

      <p className="mt-3 text-[11px] text-slate-400">
        Toggle bilan yoqing/o'chiring, savatcha bilan o'chiring. Band worker
        hozir bajarayotgan taskni ko'rsatadi. &quot;Loglar&quot; bilan har bir
        worker bajargan step'larni ko'ring. Pool:{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">
          npm run workers:run
        </code>
      </p>

      {/* Worker loglari (step'lar) modali */}
      {logsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setLogsFor(null)}
          />
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
            {/* Sarlavha */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                  <DocumentText size={18} variant="Bold" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                    {logsFor.name} — loglar
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Bajarilgan step'lar tarixi (eng yangisi yuqorida)
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => loadLogs(logsFor.name)}
                  disabled={logsLoading}
                  title="Yangilash"
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <Refresh size={16} />
                </button>
                <button
                  onClick={() => setLogsFor(null)}
                  title="Yopish"
                  className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <CloseCircle size={20} />
                </button>
              </div>
            </div>

            {/* Hozir bajarayotgan ish (jonli) */}
            {liveLogWorker?.currentJob && (
              <div
                className={`mx-5 mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${jobTone(
                  liveLogWorker.currentJob,
                )}`}
              >
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-current" />
                Hozir bajaryapti: ▶ {liveLogWorker.currentJob}
              </div>
            )}

            {/* Step'lar ro'yxati */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {logsLoading && logs.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">
                  Yuklanmoqda…
                </p>
              ) : logs.length === 0 ? (
                <div className="py-10 text-center">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-300 dark:bg-slate-800 dark:text-slate-600">
                    <DocumentText size={24} variant="Bold" />
                  </span>
                  <p className="mt-3 text-sm text-slate-400">
                    Bu worker hali ish bajarmagan — log yo'q.
                  </p>
                </div>
              ) : (
                <ol className="space-y-2">
                  {logs.map((l) => (
                    <li
                      key={l.id}
                      className="rounded-xl border border-slate-100 p-3 dark:border-slate-800"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {l.ok ? (
                          <TickCircle
                            size={15}
                            variant="Bold"
                            className="shrink-0 text-emerald-500"
                          />
                        ) : (
                          <CloseCircle
                            size={15}
                            variant="Bold"
                            className="shrink-0 text-rose-500"
                          />
                        )}
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${jobTone(
                            l.stage,
                          )}`}
                        >
                          {STAGE_LABELS[l.stage] || l.stage}
                        </span>
                        {l.attempt > 1 && (
                          <span className="text-[10px] text-slate-400">
                            urinish #{l.attempt}
                          </span>
                        )}
                        {l.applicantId != null && (
                          <span className="min-w-0 truncate text-[11px] text-slate-500 dark:text-slate-400">
                            #{l.applicantId}
                            {applicantName(l.applicant)
                              ? ` · ${applicantName(l.applicant)}`
                              : ""}
                          </span>
                        )}
                        <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
                          <Clock size={11} /> {fmtTime(l.createdAt)}
                        </span>
                      </div>
                      {l.note && (
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                          {l.note}
                        </p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {l.statusCode != null && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            HTTP {l.statusCode}
                          </span>
                        )}
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {(l.durationMs / 1000).toFixed(1)}s
                        </span>
                        {l.exitIp && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            IP {l.exitIp}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* Pastki izoh */}
            <div className="border-t border-slate-100 px-5 py-2.5 text-center text-[11px] text-slate-400 dark:border-slate-800">
              Har 4 soniyada jonli yangilanadi · {logs.length} ta step
            </div>
          </div>
        </div>
      )}

      {/* Loglarni qidirish natijalari modali */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setSearchOpen(false)}
          />
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
            {/* Sarlavha */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                  <SearchNormal1 size={18} variant="Bold" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    Qidiruv natijalari
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {searchQ.trim() ? `"${searchQ.trim()}" · ` : ""}
                    {searchStatus === "fail"
                      ? "faqat xatolar"
                      : searchStatus === "ok"
                        ? "faqat muvaffaqiyatli"
                        : "barcha holatlar"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSearchOpen(false)}
                className="text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
              >
                <CloseCircle size={22} />
              </button>
            </div>

            {/* Natijalar ro'yxati */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {searchLoading && !searchResults ? (
                <p className="py-10 text-center text-sm text-slate-400">
                  Qidirilmoqda…
                </p>
              ) : !searchResults || searchResults.length === 0 ? (
                <div className="py-10 text-center">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-300 dark:bg-slate-800 dark:text-slate-600">
                    <SearchNormal1 size={24} variant="Bold" />
                  </span>
                  <p className="mt-3 text-sm text-slate-400">
                    Hech narsa topilmadi.
                  </p>
                </div>
              ) : (
                <ol className="space-y-2">
                  {searchResults.map((l) => (
                    <li
                      key={l.id}
                      className="rounded-xl border border-slate-100 p-3 dark:border-slate-800"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {l.ok ? (
                          <TickCircle
                            size={15}
                            variant="Bold"
                            className="shrink-0 text-emerald-500"
                          />
                        ) : (
                          <CloseCircle
                            size={15}
                            variant="Bold"
                            className="shrink-0 text-rose-500"
                          />
                        )}
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${jobTone(
                            l.stage,
                          )}`}
                        >
                          {STAGE_LABELS[l.stage] || l.stage}
                        </span>
                        {l.workerProfile && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                            <Box size={11} variant="Bold" />
                            {l.workerProfile}
                          </span>
                        )}
                        {l.applicantId != null && (
                          <span className="min-w-0 truncate text-[11px] text-slate-500 dark:text-slate-400">
                            #{l.applicantId}
                            {applicantName(l.applicant)
                              ? ` · ${applicantName(l.applicant)}`
                              : ""}
                          </span>
                        )}
                        <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
                          <Clock size={11} /> {fmtTime(l.createdAt)}
                        </span>
                      </div>
                      {(l.note || l.pageError) && (
                        <p
                          className={`mt-1.5 text-xs leading-relaxed ${
                            l.ok
                              ? "text-slate-600 dark:text-slate-300"
                              : "text-rose-600 dark:text-rose-300"
                          }`}
                        >
                          {l.note || l.pageError}
                        </p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {l.statusCode != null && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            HTTP {l.statusCode}
                          </span>
                        )}
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {(l.durationMs / 1000).toFixed(1)}s
                        </span>
                        {l.exitIp && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            IP {l.exitIp}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* Pastki izoh */}
            <div className="border-t border-slate-100 px-5 py-2.5 text-center text-[11px] text-slate-400 dark:border-slate-800">
              {searchResults ? `${searchResults.length} ta natija` : ""} · eng
              yangi 200 tagacha
            </div>
          </div>
        </div>
      )}

      {/* O'chirishni tasdiqlash modali */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setConfirmDel(null)}
          />
          <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
            <button
              onClick={() => setConfirmDel(null)}
              className="absolute right-3 top-3 text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
            >
              <CloseCircle size={22} />
            </button>
            <div className="px-6 pb-6 pt-7 text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose-50 text-rose-500 dark:bg-rose-500/10">
                <Danger size={28} variant="Bold" />
              </span>
              <h3 className="mt-4 text-base font-bold text-slate-800 dark:text-slate-100">
                Workerni o'chirish
              </h3>
              <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {confirmDel.name}
                </span>{" "}
                ro'yxatdan butunlay olib tashlanadi. Bu amalni qaytarib
                bo'lmaydi.
              </p>
              <div className="mt-6 flex gap-2.5">
                <button
                  onClick={() => setConfirmDel(null)}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Bekor qilish
                </button>
                <button
                  onClick={doDelete}
                  className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700"
                >
                  O'chirish
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Tepadagi statistika kartochkasi.
function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "emerald" | "amber" | "indigo";
}) {
  const tones: Record<string, string> = {
    slate:
      "bg-slate-50 text-slate-700 dark:bg-slate-800/50 dark:text-slate-200",
    emerald:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    amber:
      "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    indigo:
      "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  };
  return (
    <div className={`rounded-xl px-3 py-2.5 ${tones[tone]}`}>
      <div className="text-2xl font-bold leading-none">{value}</div>
      <div className="mt-1 text-[11px] font-medium opacity-80">{label}</div>
    </div>
  );
}
