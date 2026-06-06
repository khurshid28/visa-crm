/**
 * ====================================================================
 *  PROXY — har bir user uchun sticky residential IP (IPRoyal va h.k.)
 * ====================================================================
 *  Maqsad:
 *   - register + login + order: BIR XIL user => BIR XIL IP (sticky session).
 *     profileKey (gmail) session id sifatida ishlatiladi.
 *   - checkSlot (har 5 soniyada): IP HAR SAFAR ALMASHADI (rotating) — bitta
 *     IP'ni monitoring bilan charchatib bloklatmaslik uchun.
 *
 *  .env sozlamalari:
 *   PROXY_ENABLED=true|false        — proxy yoqilganmi
 *   PROXY_HOST, PROXY_PORT          — gateway (IPRoyal: geo.iproyal.com:12321)
 *   PROXY_USER, PROXY_PASS          — proxy login/parol (akkaunt paroli emas)
 *   PROXY_COUNTRIES=uz,kz           — userlar shu davlatlarga taqsimlanadi
 *   PROXY_SESSION_TTL_MIN=60        — bitta IP necha minut ushlansin (sticky)
 *   PROXY_USERNAME_TEMPLATE         — username shabloni
 *   PROXY_PASSWORD_TEMPLATE         — parol shabloni
 *      Shablon o'zgaruvchilari: {user}{pass}{country}{session}{ttl}
 *      IPRoyal default:
 *        USERNAME_TEMPLATE={user}
 *        PASSWORD_TEMPLATE={pass}_country-{country}_session-{session}_lifetime-{ttl}m
 *      Smartproxy/Decodo:
 *        USERNAME_TEMPLATE=user-{user}-country-{country}-session-{session}-sessionduration-{ttl}
 *        PASSWORD_TEMPLATE={pass}
 * ====================================================================
 */

export type ProxyConfig = {
  server: string;
  username: string;
  password: string;
};

export type ProxyTarget = {
  /** Sticky IP kaliti (gmail). Berilsa — shu user har doim bir xil IP oladi. */
  profileKey?: string | null;
  /** true bo'lsa — har chaqiruvda yangi (tasodifiy) IP (checkSlot uchun). */
  rotating?: boolean;
};

/** profileKey'ni proxy session id uchun xavfsiz holatga keltiradi. */
function sanitizeSession(key: string): string {
  return (key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

/** profileKey'dan barqaror son (hash) — davlat tanlash uchun. */
function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Shablon ichidagi {kalit} larni almashtiradi. */
function applyTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

/** Proxy .env'da yoqilgan va to'liq sozlanganmi? */
export function isProxyEnabled(): boolean {
  const enabled = (process.env.PROXY_ENABLED || "").trim().toLowerCase();
  if (enabled !== "true" && enabled !== "1") return false;
  return Boolean(
    (process.env.PROXY_HOST || "").trim() &&
    (process.env.PROXY_PORT || "").trim() &&
    (process.env.PROXY_USER || "").trim() &&
    (process.env.PROXY_PASS || "").trim(),
  );
}

function countries(): string[] {
  return (process.env.PROXY_COUNTRIES || "uz,kz")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Berilgan target uchun Playwright proxy konfiguratsiyasi.
 *  - rotating=true  => session har safar tasodifiy (yangi IP).
 *  - profileKey bor => session=profileKey (sticky, bir xil IP).
 *  - aks holda      => undefined (proxy ishlatilmaydi).
 */
export function proxyFor(target: ProxyTarget): ProxyConfig | undefined {
  if (!isProxyEnabled()) return undefined;

  const host = (process.env.PROXY_HOST || "").trim();
  const port = (process.env.PROXY_PORT || "").trim();
  const user = (process.env.PROXY_USER || "").trim();
  const pass = (process.env.PROXY_PASS || "").trim();

  const list = countries();

  // Session id: rotating bo'lsa tasodifiy, aks holda profileKey (sticky).
  let session: string;
  let pickKey: string;
  if (target.rotating || !target.profileKey) {
    session = `r${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    pickKey = session;
  } else {
    session = sanitizeSession(target.profileKey) || "shared";
    pickKey = session;
  }

  const country = list.length ? list[stableHash(pickKey) % list.length] : "";
  const ttl = (process.env.PROXY_SESSION_TTL_MIN || "60").trim();

  const userTpl = (process.env.PROXY_USERNAME_TEMPLATE || "{user}").trim();
  const passTpl = (
    process.env.PROXY_PASSWORD_TEMPLATE ||
    "{pass}_country-{country}_session-{session}_lifetime-{ttl}m"
  ).trim();

  const vars = { user, pass, country, session, ttl };
  return {
    server: `http://${host}:${port}`,
    username: applyTemplate(userTpl, vars),
    password: applyTemplate(passTpl, vars),
  };
}

/** Log uchun proxy meta (PAROLSIZ): server, country, session. */
export type ProxyMeta = {
  server: string;
  country: string;
  session: string;
};

export function proxyMetaFor(target: ProxyTarget): ProxyMeta | null {
  if (!isProxyEnabled()) return null;
  const host = (process.env.PROXY_HOST || "").trim();
  const port = (process.env.PROXY_PORT || "").trim();
  const list = countries();

  let session: string;
  let pickKey: string;
  if (target.rotating || !target.profileKey) {
    // rotating uchun aniq session log vaqtida noma'lum (har goto'da yangi),
    // shuning uchun "rotating" deb belgilaymiz.
    session = "rotating";
    pickKey = sanitizeSession(target.profileKey || "") || "rotating";
  } else {
    session = sanitizeSession(target.profileKey) || "shared";
    pickKey = session;
  }
  const country = list.length ? list[stableHash(pickKey) % list.length] : "";
  return { server: `${host}:${port}`, country, session };
}

/** Tashqi (exit) IP'ni aniqlash uchun echo URL (.env: PROXY_IP_ECHO_URL). */
export function proxyIpEchoUrl(): string {
  return (
    (process.env.PROXY_IP_ECHO_URL || "").trim() ||
    "https://api.ipify.org?format=json"
  );
}

/** Exit IP log qilinsinmi? (.env: PROXY_LOG_IP, default true proxy yoqilganda). */
export function shouldLogExitIp(): boolean {
  if (!isProxyEnabled()) return false;
  const v = (process.env.PROXY_LOG_IP || "true").trim().toLowerCase();
  return v !== "false" && v !== "0";
}
