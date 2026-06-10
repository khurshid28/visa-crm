"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Refresh,
  Cpu,
  Add,
  AddCircle,
  Flash,
  Warning2,
  Box,
  Trash,
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

type Snapshot = {
  workers: WorkerRow[];
  cpu: Cpu;
  queueDepth: number;
};

// Worker holatiga qarab rang (nuqta).
function dotClass(w: WorkerRow): string {
  if (!w.active) return "bg-slate-300 dark:bg-slate-600";
  if (w.status === "offline") return "bg-slate-400";
  if (!w.live) return "bg-rose-500"; // stale (heartbeat eskirgan)
  if (w.status === "busy") return "bg-amber-500";
  return "bg-emerald-500"; // idle, tirik
}

function statusLabel(w: WorkerRow): string {
  if (!w.active) return "o'chiq";
  if (w.status === "offline") return "ishlamayapti";
  if (!w.live) return "stale";
  return w.status === "busy" ? "band" : "tayyor";
}

export default function WorkersPanel() {
  const { toast } = useToast();
  const [data, setData] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeInput, setActiveInput] = useState("");
  const [addInput, setAddInput] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/workers", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as Snapshot | null;
      if (res.ok && json) {
        setData(json);
        if (!activeInput) setActiveInput(String(json.cpu.activeNow));
      }
    } catch {
      // jim
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          setActiveInput(String(json.cpu.activeNow));
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

  // Bitta workerni o'chirish (tasdiq bilan).
  const delWorker = useCallback(
    (w: WorkerRow) => {
      if (
        window.confirm(
          `${w.name} o'chirilsinmi? Bu workerni ro'yxatdan butunlay olib tashlaydi.`,
        )
      ) {
        act("delete", w.id);
      }
    },
    [act],
  );

  const cpu = data?.cpu;
  const workers = data?.workers ?? [];
  const liveCount = workers.filter((w) => w.live).length;

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
            <Box size={20} variant="Bold" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Workerlar (pool)
            </h2>
            <p className="text-xs text-slate-400">
              {workers.length} ta · {cpu?.activeNow ?? 0} active · {liveCount}{" "}
              jonli · navbatda {data?.queueDepth ?? 0}
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Refresh size={14} /> Yangilash
        </button>
      </div>

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
              {cpu.recommendedMax} ta active
            </div>
            <p className="mt-0.5 leading-relaxed">{cpu.message}</p>
          </div>
        </div>
      )}

      {/* Boshqaruv */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Active workerlar soni (tartib bo'yicha)
            </span>
            <input
              type="number"
              min={0}
              value={activeInput}
              onChange={(e) => setActiveInput(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <button
            onClick={() => act("on", Number(activeInput))}
            disabled={busy || activeInput === ""}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            <Flash size={15} variant="Bold" /> Qo'llash
          </button>
        </div>

        <div className="flex items-end gap-2">
          <label className="flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
              Yana worker qo'shish
            </span>
            <input
              type="number"
              min={1}
              placeholder="masalan 10"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          <button
            onClick={() => {
              act("add", Number(addInput));
              setAddInput("");
            }}
            disabled={busy || addInput === ""}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Add size={16} /> Qo'shish
          </button>
          <button
            onClick={() => act("add", 1)}
            disabled={busy}
            title="Bittadan qo'shish"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:border-slate-700 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
          >
            <AddCircle size={16} variant="Bold" /> +1
          </button>
        </div>
      </div>

      {/* Worker ro'yxati */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {workers.map((w) => (
          <div
            key={w.id}
            className={`flex flex-col gap-1 rounded-xl border p-2.5 text-left transition ${
              w.active
                ? "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                : "border-dashed border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40"
            }`}
          >
            <div className="flex items-center justify-between gap-1">
              <button
                onClick={() => act(w.active ? "disable" : "enable", w.id)}
                disabled={busy}
                title={w.active ? "O'chirish (disable)" : "Yoqish (enable)"}
                className="flex min-w-0 items-center gap-1.5 disabled:opacity-60"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass(w)}`} />
                <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {w.name}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <span className="text-[10px] text-slate-400">#{w.id}</span>
                <button
                  onClick={() => delWorker(w)}
                  disabled={busy}
                  title="Workerni o'chirish (delete)"
                  className="rounded p-0.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50 dark:hover:bg-rose-500/10"
                >
                  <Trash size={13} />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>{statusLabel(w)}</span>
              <span>{w.jobsDone} ish</span>
            </div>
            {w.currentJob ? (
              <div
                className="truncate text-[10px] text-amber-600 dark:text-amber-400"
                title={w.currentJob}
              >
                {w.currentJob}
              </div>
            ) : (
              <div className="text-[10px] text-slate-400">
                {w.pid ? `PID: ${w.pid}` : "ish yo'q"}
              </div>
            )}
            {w.lastError && (
              <div
                className="truncate text-[10px] text-rose-500"
                title={w.lastError}
              >
                xato: {w.lastError}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        Nom ustiga bosib yoqish/o'chirish, savatchada o'chirish (delete) mumkin.
        Ish yo'q bo'lsa PID ko'rinadi. Ishga tushirish:{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">
          npm run workers:run
        </code>
      </p>
    </div>
  );
}
