// PROXY exit IP + reputatsiya tekshiruvi (VFS'ga TEGMAYDI — xavfsiz).
// Faqat ipify (exit IP) + ip-api (geo/ISP/proxy-hosting bayrog'i) so'raydi.
// Maqsad: IPRoyal bizga qaysi IP'ni berayotganini va u "proxy/datacenter" deb
// belgilanganmi yoki yo'qligini ko'rish — VFS 429 (IP reputatsiya) sababini aniqlash.
//
// Ishga tushirish:
//   npm run proxy:check
//   npm run proxy:check -- boshqa@email.com   (sticky kalit = shu email)
//   npm run proxy:check -- --rotating         (har safar yangi IP)
//
// "kop test qilma" — bu VFS test EMAS, faqat proxy IP echo (akkauntni bloklamaydi).

import "dotenv/config";
import { request } from "playwright";
import { proxyFor, proxyMetaFor, isProxyEnabled } from "../lib/proxy";

const COLOR = (process.env.LOG_COLOR || "true").toLowerCase() !== "false";
const c = (code: string, s: string) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c("1", s);
const dim = (s: string) => c("2", s);
const green = (s: string) => c("32", s);
const red = (s: string) => c("31", s);
const yellow = (s: string) => c("33", s);
const cyan = (s: string) => c("36", s);
const gray = (s: string) => c("90", s);
const hr = () => console.log(gray("=".repeat(54)));

function row(label: string, value: string, good?: boolean) {
  const v = good === true ? green(value) : good === false ? red(value) : value;
  console.log(`  ${gray(label.padEnd(16))} ${v}`);
}

async function main() {
  const args = process.argv.slice(2);
  const rotating = args.includes("--rotating") || args.includes("-r");
  const key = args.find((a) => !a.startsWith("-")) || "khurshidi2827@gmail.com";
  // --attempt=N yoki --ip=N : sticky session'ga salt (o'sha akkaunt, YANGI IP).
  // Asosiy IP rate-limit (429) bo'lsa, 1,2,3... bilan yangi IP topiladi.
  const attemptArg = args.find((a) => /^--(attempt|ip)=/.test(a));
  const ipAttempt = attemptArg ? Number(attemptArg.split("=")[1]) || 0 : 0;

  console.log("");
  hr();
  console.log("  " + bold("PROXY EXIT IP + REPUTATSIYA TEKSHIRUVI"));
  hr();
  row("Proxy yoqilgan", isProxyEnabled() ? green("ha") : red("yo'q"));
  row(
    "Rejim",
    rotating
      ? "rotating (yangi IP)"
      : `sticky (${key})` + (ipAttempt > 0 ? `  +salt a${ipAttempt}` : ""),
  );

  if (!isProxyEnabled()) {
    console.log("");
    console.log(red("  Proxy .env'da yoqilmagan (PROXY_ENABLED!=true)."));
    hr();
    return;
  }

  const target = rotating
    ? { rotating: true }
    : { profileKey: key, ipAttempt };
  const cfg = proxyFor(target);
  const meta = proxyMetaFor(target);
  if (!cfg) {
    console.log(red("  proxyFor() undefined qaytardi — config to'liq emas."));
    hr();
    return;
  }
  row("Server", meta?.server || cfg.server);
  row("Davlat (so'ralgan)", (meta?.country || "—").toUpperCase());
  row("Session", meta?.session || "—");
  hr();

  // Proxy orqali HTTP so'rov (brauzersiz — Playwright request konteksti).
  const ctx = await request.newContext({
    proxy: {
      server: cfg.server,
      username: cfg.username,
      password: cfg.password,
    },
    timeout: 30000,
    ignoreHTTPSErrors: true,
  });

  // 1) Exit IP (ipify).
  let exitIp = "";
  const t0 = Date.now();
  try {
    const r = await ctx.get("https://api.ipify.org?format=json");
    if (r.ok()) {
      exitIp = (await r.json()).ip;
      row("Exit IP", green(exitIp) + gray(`  (+${Date.now() - t0}ms)`), true);
    } else {
      row("Exit IP", red(`xato (HTTP ${r.status()})`), false);
    }
  } catch (e: any) {
    row("Exit IP", red(`ULANMADI: ${e?.message || e}`), false);
    console.log("");
    console.log(
      yellow(
        "  => Proxy javob bermadi. Balans/ulanishni tekshiring (IPRoyal).",
      ),
    );
    hr();
    await ctx.dispose();
    return;
  }

  // 2) Geo + reputatsiya (ip-api.com — proxy/hosting bayrog'i bepul).
  if (exitIp) {
    try {
      const url =
        `http://ip-api.com/json/${exitIp}` +
        `?fields=status,country,countryCode,regionName,city,isp,org,as,proxy,hosting,mobile`;
      const r = await ctx.get(url);
      const g: any = r.ok() ? await r.json() : null;
      if (g && g.status === "success") {
        hr();
        row(
          "Joylashuv",
          `${g.country} (${g.countryCode}), ${g.regionName}, ${g.city}`,
        );
        row("ISP", g.isp || "—");
        row("Org", g.org || "—");
        row("AS", g.as || "—");
        hr();
        // Reputatsiya bayroqlari — ENG MUHIMI.
        const wantCc = (meta?.country || "").toUpperCase();
        const gotCc = (g.countryCode || "").toUpperCase();
        row(
          "Davlat mos",
          gotCc === wantCc
            ? green(`ha (${gotCc})`)
            : red(`YO'Q (${gotCc} != ${wantCc})`),
          gotCc === wantCc,
        );
        row(
          "proxy bayroq",
          g.proxy ? red("HA (flagged!)") : green("yo'q"),
          !g.proxy,
        );
        row(
          "hosting/DC",
          g.hosting ? red("HA (datacenter!)") : green("yo'q (residential)"),
          !g.hosting,
        );
        row("mobile", g.mobile ? yellow("ha") : "yo'q");
        hr();
        // Xulosa.
        if (g.proxy || g.hosting) {
          console.log(
            red(
              "  XULOSA: bu IP 'proxy/datacenter' deb belgilangan — VFS/Cloudflare\n" +
                "  uni rad etishi (429/blok) ehtimoli YUQORI. Toza residential IP kerak.",
            ),
          );
        } else if (gotCc !== wantCc) {
          console.log(
            yellow(
              "  XULOSA: IP toza, lekin so'ralgan davlatda EMAS — timezone/til\n" +
                "  nomuvofiqligi bo'lishi mumkin.",
            ),
          );
        } else {
          console.log(
            green(
              "  XULOSA: IP toza residential + davlat mos. Proxy sog'lom.\n" +
                "  Agar VFS baribir 429 bersa — sabab IP RATE-LIMIT (ko'p so'rov) yoki akkaunt.",
            ),
          );
        }
        hr();
      } else {
        row("Geo", yellow("ip-api javob bermadi (limit?)"));
        hr();
      }
    } catch (e: any) {
      row("Geo", red(`xato: ${e?.message || e}`));
      hr();
    }
  }

  await ctx.dispose();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
