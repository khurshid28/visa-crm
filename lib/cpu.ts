import os from "os";

// ===========================================================================
//  CPU monitoring — jonli yuklama (load) foizi + ogohlantirish (watchdog)
//
//  os.cpus() har bir yadro uchun jamlangan (cumulative) vaqtlarni beradi.
//  Ikki nuqtadagi farqdan band foizini hisoblaymiz:
//      band% = 1 - (idleDelta / totalDelta)
//  Shu sabab CPU% har doim ikki o'lchov orasidagi davr uchun chiqadi.
//
//  Banner (sayt) va bot 80% dan oshganda ogohlantiradi (chegara sozlanadi).
// ===========================================================================

// Ogohlantirish chegarasi (foiz). 80% dan oshsa — banner + bot xabar beradi.
export const CPU_THRESHOLD = Math.max(
  1,
  Math.min(100, Number(process.env.WORKER_CPU_THRESHOLD || 80)),
);

// Tebranishni (flapping) kamaytirish uchun "tiklanish" chegarasi (gisterezis):
// 80% da yonadi, lekin 70% dan pastga tushgandagina "normallashdi" deydi.
const RECOVER_BELOW = Math.max(1, CPU_THRESHOLD - 10);

export type CpuSnapshot = { idle: number; total: number };

// Hozirgi jamlangan idle/total vaqtlar (barcha yadrolar bo'yicha).
export function cpuSnapshot(): CpuSnapshot {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

// Ikki snapshot orasidagi band foizi (0..100).
export function cpuUsageBetween(a: CpuSnapshot, b: CpuSnapshot): number {
  const idleDiff = b.idle - a.idle;
  const totalDiff = b.total - a.total;
  if (totalDiff <= 0) return 0;
  const usage = (1 - idleDiff / totalDiff) * 100;
  return Math.max(0, Math.min(100, Math.round(usage)));
}

// Bir martalik o'lchov: `ms` davomida namuna olib, band foizini qaytaradi.
// API so'rovlari shuni ishlatadi (default 200ms — sezilmas kechikish).
export async function sampleCpuPercent(ms = 200): Promise<number> {
  const a = cpuSnapshot();
  await new Promise((r) => setTimeout(r, ms));
  const b = cpuSnapshot();
  return cpuUsageBetween(a, b);
}

export type CpuLevel = "ok" | "warn" | "high";

// Server (mashina) identifikatsiyasi — deyarli o'zgarmaydigan ma'lumotlar:
// nomi, operatsion tizimi, protsessor modeli, umumiy xotira, ishlash vaqti.
export type ServerInfo = {
  hostname: string; // tizim (server) nomi
  osName: string; // qulay nom: Windows | Linux | macOS
  osRelease: string; // OS versiyasi (os.release())
  arch: string; // arxitektura: x64 / arm64 ...
  cpuModel: string; // protsessor modeli (1-yadro nomi)
  cpuSpeed: number; // protsessor tezligi (MHz)
  cores: number; // mantiqiy yadrolar soni
  memTotal: number; // umumiy operativ xotira (bayt)
  memFree: number; // bo'sh operativ xotira (bayt)
  nodeVersion: string; // Node.js versiyasi (process.version)
  uptimeSec: number; // server ishlab turgan vaqt (soniya)
};

// platform kodini qulay nomga aylantiradi.
function friendlyOs(platform: string): string {
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  if (platform === "darwin") return "macOS";
  return platform || "—";
}

// Server identifikatsiyasini qaytaradi (os modulidan, arzon).
export function getServerInfo(): ServerInfo {
  const cpus = os.cpus() || [];
  return {
    hostname: os.hostname() || "—",
    osName: friendlyOs(os.platform()),
    osRelease: os.release() || "",
    arch: os.arch() || "",
    cpuModel: (cpus[0]?.model || "—").trim(),
    cpuSpeed: cpus[0]?.speed || 0,
    cores: cpus.length || 1,
    memTotal: os.totalmem(),
    memFree: os.freemem(),
    nodeVersion: process.version || "—",
    uptimeSec: Math.round(os.uptime()),
  };
}

export type CpuStat = {
  percent: number; // band foizi (0..100)
  cores: number; // mantiqiy yadrolar soni
  loadavg: number[]; // [1m, 5m, 15m] — Windows'da 0 bo'lishi mumkin
  memTotal: number; // bayt
  memUsed: number; // bayt
  memPercent: number; // ishlatilgan xotira foizi
  level: CpuLevel; // yaxshi | o'rtacha | yuqori
  threshold: number; // ogohlantirish chegarasi (80)
  over: boolean; // chegaradan oshganmi
  message: string; // qisqa o'zbekcha izoh
  at: string; // o'lchangan vaqt (ISO)
  server?: ServerInfo; // server identifikatsiyasi (nom, OS, xotira)
};

function levelFor(percent: number): CpuLevel {
  if (percent >= CPU_THRESHOLD) return "high";
  if (percent >= CPU_THRESHOLD - 20) return "warn";
  return "ok";
}

function messageFor(percent: number, level: CpuLevel): string {
  if (level === "high") {
    return (
      `CPU yuklamasi yuqori — ${percent}% (chegara ${CPU_THRESHOLD}%). ` +
      `Workerlar sekinlashishi mumkin. Active workerlarni kamaytiring yoki ` +
      `serverga CPU qo'shing.`
    );
  }
  if (level === "warn") {
    return `CPU o'rtacha yuklangan — ${percent}%. Hozircha normal.`;
  }
  return `CPU yuklamasi yaxshi — ${percent}%.`;
}

// To'liq CPU holati (foiz + yadro + xotira + daraja). Banner va karta shuni oladi.
export async function getCpuStat(sampleMs = 200): Promise<CpuStat> {
  const percent = await sampleCpuPercent(sampleMs);
  const cores = os.cpus()?.length || 1;
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const memUsed = memTotal - memFree;
  const memPercent = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;
  const level = levelFor(percent);
  return {
    percent,
    cores,
    loadavg: os.loadavg(),
    memTotal,
    memUsed,
    memPercent,
    level,
    threshold: CPU_THRESHOLD,
    over: percent >= CPU_THRESHOLD,
    message: messageFor(percent, level),
    at: new Date().toISOString(),
    server: getServerInfo(),
  };
}

// --------------------------- Watchdog (bot ogohlantirish) -------------------

export type CpuWatchdogOptions = {
  intervalMs?: number; // o'lchov oralig'i (default 15s)
  threshold?: number; // chegara (default CPU_THRESHOLD)
  cooldownMs?: number; // qayta ogohlantirish oralig'i (default 10 daqiqa)
  onAlert: (stat: CpuStat) => void | Promise<void>; // chegaradan oshganda
  onRecover?: (stat: CpuStat) => void | Promise<void>; // normallashganda
};

// CPU yuklamasini doimiy kuzatadi va 80% dan oshganda onAlert chaqiradi
// (cooldown bilan — spam bo'lmasin). Pastga tushganda onRecover chaqiriladi.
// To'xtatish funksiyasini qaytaradi.
export function startCpuWatchdog(opts: CpuWatchdogOptions): () => void {
  const intervalMs = Math.max(3000, opts.intervalMs ?? 15_000);
  const threshold = opts.threshold ?? CPU_THRESHOLD;
  const cooldownMs = Math.max(0, opts.cooldownMs ?? 10 * 60 * 1000);

  let prev = cpuSnapshot();
  let wasOver = false;
  let lastAlertAt = 0;

  const timer = setInterval(async () => {
    const now = cpuSnapshot();
    const percent = cpuUsageBetween(prev, now);
    prev = now;

    const cores = os.cpus()?.length || 1;
    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const memUsed = memTotal - memFree;
    const memPercent =
      memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;
    const level = levelFor(percent);
    const stat: CpuStat = {
      percent,
      cores,
      loadavg: os.loadavg(),
      memTotal,
      memUsed,
      memPercent,
      level,
      threshold,
      over: percent >= threshold,
      message: messageFor(percent, level),
      at: new Date().toISOString(),
    };

    if (percent >= threshold) {
      const due = Date.now() - lastAlertAt > cooldownMs;
      if (!wasOver || due) {
        wasOver = true;
        lastAlertAt = Date.now();
        try {
          await opts.onAlert(stat);
        } catch {
          /* ogohlantirish xatosi jarayonni to'xtatmasin */
        }
      }
    } else if (percent < RECOVER_BELOW && wasOver) {
      wasOver = false;
      if (opts.onRecover) {
        try {
          await opts.onRecover(stat);
        } catch {
          /* ignore */
        }
      }
    }
  }, intervalMs);

  // Node jarayonni shu timer ushlab turmasin.
  if (typeof timer.unref === "function") timer.unref();

  return () => clearInterval(timer);
}
