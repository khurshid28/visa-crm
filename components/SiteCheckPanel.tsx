"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SearchNormal1,
  Refresh,
  Eye,
  EyeSlash,
  TickCircle,
  CloseCircle,
  ProfileAdd,
  Login,
  Sms,
  Calendar,
  Timer1,
  CloseSquare,
  Global,
} from "iconsax-react";
import { useToast } from "@/components/Toast";
import { APPLICANT_STATUS } from "@/lib/status";

type ApplicantHit = {
  id: number;
  surname: string;
  name: string;
  generatedEmail: string | null;
  email: string | null;
  status: string;
  activationStatus: string | null;
  groupId: number;
};

type ApplicantDetail = {
  id: number;
  surname: string;
  name: string;
  generatedEmail: string | null;
  generatedPassword: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  activationStatus: string | null;
  resultNote: string | null;
  groupId: number;
  profileKey: string | null;
  registerFinishedAt: string | null;
  activatedAt: string | null;
};

type LogRow = {
  id: number;
  stage: string;
  ok: boolean;
  note: string | null;
  durationMs: number;
  statusCode: number | null;
  exitIp: string | null;
  finalUrl: string | null;
  createdAt: string;
};

type ActionKey = "register" | "login" | "activation" | "order";

const STAGE_LABELS: Record<string, string> = {
  register: "Register",
  login: "Login",
  order: "Order",
  activation: "Aktivatsiya",
  slot: "Slot",
};

const ACTIONS: {
  key: ActionKey;
  label: string;
  hint: string;
  cls: string;
  Icon: typeof ProfileAdd;
}[] = [
  {
    key: "register",
    label: "Register",
    hint: "Yangi akkaunt + aktivatsiya",
    cls: "bg-indigo-600 hover:bg-indigo-700",
    Icon: ProfileAdd,
  },
  {
    key: "login",
    label: "Login",
    hint: "Gmail/parol bilan kirish",
    cls: "bg-sky-600 hover:bg-sky-700",
    Icon: Login,
  },
  {
    key: "activation",
    label: "Aktivatsiya",
    hint: "Email linkini ochish",
    cls: "bg-violet-600 hover:bg-violet-700",
    Icon: Sms,
  },
  {
    key: "order",
    label: "Order",
    hint: "Buyurtma (slot kerak)",
    cls: "bg-emerald-600 hover:bg-emerald-700",
    Icon: Calendar,
  },
];

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const meta = APPLICANT_STATUS[status] ?? {
    label: status,
    cls: "bg-slate-100 text-slate-700",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}
    >
      {meta.label}
    </span>
  );
}

export default function SiteCheckPanel() {
  const { toast } = useToast();

  // Qidiruv
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ApplicantHit[]>([]);
  const [searching, setSearching] = useState(false);

  // Tanlangan user
  const [selected, setSelected] = useState<ApplicantDetail | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [showPwd, setShowPwd] = useState(false);
  const [actionBusy, setActionBusy] = useState<ActionKey | null>(null);

  // Debounced qidiruv (>=2 belgi)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/site-check?q=${encodeURIComponent(q)}`,
          { cache: "no-store" },
        );
        const data = await res.json().catch(() => null);
        if (res.ok && Array.isArray(data?.applicants)) setHits(data.applicants);
      } catch {
        // jim
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [query]);

  const loadSelected = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/site-check?applicantId=${id}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.applicant) {
        setSelected(data.applicant);
        setLogs(Array.isArray(data.logs) ? data.logs : []);
      }
    } catch {
      // jim
    }
  }, []);

  // Tanlangan userning natijalarini har 4 soniyada yangilab turamiz
  // (worker bajarganda jonli ko'rinadi).
  useEffect(() => {
    if (!selected) return;
    const id = window.setInterval(() => loadSelected(selected.id), 4000);
    return () => window.clearInterval(id);
  }, [selected, loadSelected]);

  function pick(hit: ApplicantHit) {
    setQuery("");
    setHits([]);
    setShowPwd(false);
    loadSelected(hit.id);
  }

  async function runAction(action: ActionKey) {
    if (!selected) return;
    setActionBusy(action);
    try {
      const res = await fetch("/api/site-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, applicantId: selected.id }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        toast(data.note || "Navbatga qo'shildi", "success");
        window.setTimeout(() => loadSelected(selected.id), 1500);
      } else {
        toast(data?.error || "Bajarilmadi", "error");
      }
    } catch {
      toast("Tarmoq xatosi", "error");
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div className="card">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
            <Global size={20} variant="Bold" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Saytni qo'lda tekshirish
            </h2>
            <p className="text-xs text-slate-400">
              VFS sayti diagnostikasi — user bo'yicha register, login,
              aktivatsiya, order
            </p>
          </div>
        </div>
      </div>

      {/* ── User orqali tekshirish ───────────────────────────── */}
      <div>
          <div className="relative">
            <SearchNormal1
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="User qidirish: ism, familiya, gmail yoki passport..."
              className="input pl-9"
            />
            {searching && (
              <Refresh
                size={15}
                className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-300"
              />
            )}
          </div>

          {/* Qidiruv natijalari */}
          {hits.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800">
              {hits.map((h) => (
                <button
                  key={h.id}
                  onClick={() => pick(h)}
                  className="flex w-full items-center gap-3 border-b border-slate-50 px-3 py-2 text-left transition last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                      {h.surname} {h.name}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {h.generatedEmail || h.email || "gmail yo'q"}
                    </p>
                  </div>
                  <StatusPill status={h.status} />
                </button>
              ))}
            </div>
          )}

          {/* Tanlangan user */}
          {!selected ? (
            <div className="mt-3 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-10 text-center dark:border-slate-700">
              <SearchNormal1 size={24} className="mb-2 text-slate-300" />
              <p className="text-sm text-slate-400">
                Tekshirish uchun userni qidiring va tanlang
              </p>
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-slate-100 p-4 dark:border-slate-800">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {selected.surname} {selected.name}
                    </p>
                    <StatusPill status={selected.status} />
                  </div>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">Gmail:</span>
                      <span className="font-medium text-slate-600 dark:text-slate-300">
                        {selected.generatedEmail || selected.email || "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">Parol:</span>
                      <span className="font-mono font-medium text-slate-600 dark:text-slate-300">
                        {selected.generatedPassword
                          ? showPwd
                            ? selected.generatedPassword
                            : "••••••••"
                          : "—"}
                      </span>
                      {selected.generatedPassword && (
                        <button
                          onClick={() => setShowPwd((v) => !v)}
                          className="text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
                          title={showPwd ? "Yashirish" : "Ko'rsatish"}
                        >
                          {showPwd ? (
                            <EyeSlash size={14} />
                          ) : (
                            <Eye size={14} />
                          )}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">Aktivatsiya:</span>
                      <span className="font-medium text-slate-600 dark:text-slate-300">
                        {selected.activationStatus || "none"}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelected(null);
                    setLogs([]);
                  }}
                  className="text-slate-400 transition hover:text-rose-500"
                  title="Yopish"
                >
                  <CloseSquare size={18} />
                </button>
              </div>

              {/* Amallar */}
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {ACTIONS.map((a) => (
                  <button
                    key={a.key}
                    onClick={() => runAction(a.key)}
                    disabled={actionBusy !== null}
                    title={a.hint}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition disabled:opacity-50 ${a.cls}`}
                  >
                    {actionBusy === a.key ? (
                      <Refresh size={14} className="animate-spin" />
                    ) : (
                      <a.Icon size={14} variant="Bold" />
                    )}
                    {a.label}
                  </button>
                ))}
              </div>

              {selected.resultNote && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                  {selected.resultNote}
                </p>
              )}

              {/* Natijalar (AutomationLog) */}
              <div className="mt-4">
                <div className="mb-2 flex items-center gap-2">
                  <Timer1 size={14} className="text-slate-400" />
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Natijalar
                  </p>
                </div>
                {logs.length === 0 ? (
                  <p className="py-3 text-center text-xs text-slate-400">
                    Hali natija yo'q — amal tanlang
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {logs.map((l) => (
                      <div
                        key={l.id}
                        className="flex items-center gap-2 rounded-lg border border-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-800/60"
                      >
                        {l.ok ? (
                          <TickCircle
                            size={14}
                            variant="Bold"
                            className="shrink-0 text-emerald-500"
                          />
                        ) : (
                          <CloseCircle
                            size={14}
                            variant="Bold"
                            className="shrink-0 text-rose-500"
                          />
                        )}
                        <span className="w-20 shrink-0 font-semibold text-slate-600 dark:text-slate-300">
                          {STAGE_LABELS[l.stage] || l.stage}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400">
                          {l.note || "—"}
                        </span>
                        {l.statusCode != null && (
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            {l.statusCode}
                          </span>
                        )}
                        <span className="shrink-0 tabular-nums text-slate-400">
                          {(l.durationMs / 1000).toFixed(1)}s
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-300">
                          {fmtTime(l.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
    </div>
  );
}
