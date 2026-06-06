/**
 * ====================================================================
 *  PRETTY LOG — terminalda chiroyli, rangli booking loglari
 * ====================================================================
 *  Worker oqimini kuzatish uchun. Har bir bosqich (register/login/order/
 *  activation) uchun: vaqtlar (kelgan/ochilgan), status code, exit IP,
 *  proxy, davomiylik va chrome xatolari ko'rsatiladi.
 *
 *  DB log (AutomationLog) bilan ALOHIDA — terminal log faqat kuzatish
 *  uchun, DB log esa tarix uchun. Ikkalasi bir-biriga bog'liq emas.
 * ====================================================================
 */

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

// Ranglar o'chirilganmi? (.env: LOG_COLOR=false yoki NO_COLOR).
function noColor(): boolean {
  if (process.env.NO_COLOR) return true;
  return (process.env.LOG_COLOR || "true").trim().toLowerCase() === "false";
}

function paint(s: string, color: keyof typeof C): string {
  if (noColor()) return s;
  return `${C[color]}${s}${C.reset}`;
}

/** ISO vaqtdan faqat HH:MM:SS.mmm qismini oladi. */
function hhmmss(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(
    d.getMilliseconds(),
    3,
  )}`;
}

function statusColor(code: number | null): keyof typeof C {
  if (code == null) return "gray";
  if (code >= 200 && code < 300) return "green";
  if (code >= 300 && code < 400) return "cyan";
  if (code >= 400 && code < 500) return "yellow";
  return "red";
}

export type BookLogEntry = {
  stage: string; // register | login | order | activation
  user: string | null; // profileKey (gmail)
  ok: boolean;
  attempt?: number;
  maxAttempts?: number;
  statusCode: number | null;
  exitIp: string | null;
  proxyServer: string | null;
  proxyCountry: string | null;
  proxySession: string | null;
  requestedAt: string | null; // "kelgan"
  openedAt: string | null; // "ochilgan"
  navMs: number | null; // ochilish davomiyligi
  durationMs: number; // butun bosqich davomiyligi
  pageError: string | null; // chrome xatolari
  note?: string | null;
};

/**
 * Bitta bosqichni chiroyli ko'p qatorli blok ko'rinishida chop etadi.
 *
 *  ┌─ ORDER ✓  user=ali.v.12  attempt=1/3
 *  │  kelgan  12:30:01.120   ochilgan 12:30:03.450   (nav 2330ms)
 *  │  status  200            ip 185.x.x.x            dur 4200ms
 *  │  proxy   geo.iproyal.com:12321  country=uz  session=aliv12
 *  └─ xato: HTTP 403: ...   (faqat xato bo'lsa)
 */
export function logBookStep(e: BookLogEntry): void {
  const okMark = e.ok ? paint("✓", "green") : paint("✗", "red");
  const stageName = paint(e.stage.toUpperCase().padEnd(10), "bold");
  const attempt =
    e.attempt && e.maxAttempts
      ? paint(`attempt=${e.attempt}/${e.maxAttempts}`, "gray")
      : "";
  const bar = paint("│", "gray");

  const head =
    `${paint("┌─", "gray")} ${stageName}${okMark}  ` +
    `${paint("user=", "gray")}${e.user ?? "-"}  ${attempt}`;

  const times =
    `${bar}  ${paint("kelgan ", "gray")}${paint(hhmmss(e.requestedAt), "blue")}  ` +
    `${paint("ochilgan ", "gray")}${paint(hhmmss(e.openedAt), "magenta")}  ` +
    `${paint(`(nav ${e.navMs ?? "-"}ms)`, "gray")}`;

  const status =
    `${bar}  ${paint("status ", "gray")}${paint(
      String(e.statusCode ?? "-").padEnd(6),
      statusColor(e.statusCode),
    )}  ${paint("ip ", "gray")}${(e.exitIp ?? "-").padEnd(18)}  ` +
    `${paint(`dur ${e.durationMs}ms`, "gray")}`;

  const proxy =
    `${bar}  ${paint("proxy ", "gray")}${e.proxyServer ?? paint("off", "gray")}  ` +
    `${paint("country=", "gray")}${e.proxyCountry ?? "-"}  ` +
    `${paint("session=", "gray")}${e.proxySession ?? "-"}`;

  const lines = [head, times, status, proxy];

  if (e.pageError) {
    lines.push(`${paint("└─ xato:", "red")} ${paint(e.pageError, "red")}`);
  } else {
    lines.push(paint("└────────────────────────────", "gray"));
  }

  // Bitta console.log — qatorlar aralashmasligi uchun (worker parallel).
  console.log(lines.join("\n"));
}
