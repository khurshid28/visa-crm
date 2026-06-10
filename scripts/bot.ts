// Telegram bot ishga tushirish nuqtasi (long polling).
// Ishga tushirish:  npm run bot
// .env: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_IDS, DATABASE_URL

import "dotenv/config";
import { runBotPolling } from "../lib/telegram-bot";
import { startCpuWatchdog, type CpuStat } from "../lib/cpu";
import { startProxyWatchdog, type ProxyHealth } from "../lib/proxy";
import { todayUsageGb } from "../lib/proxy-usage";
import { broadcastMessage, isTelegramConfigured } from "../lib/telegram";
import { loadSettingsIntoEnv } from "../lib/settings";

// CPU watchdog — server yuklamasi 80% (chegara) dan oshsa adminlarga
// Telegram orqali ogohlantiradi (spam bo'lmasligi uchun cooldown bilan).
// Bot jarayoni doim ishlab turadi (Docker'da ham), shu sabab shu yerda.
function fmtAlert(s: CpuStat): string {
  return (
    `\u26a0\ufe0f <b>CPU yuklamasi yuqori</b>\n` +
    `Hozir: <b>${s.percent}%</b> (chegara ${s.threshold}%)\n` +
    `Yadrolar: ${s.cores} \u00b7 RAM: ${s.memPercent}%\n\n` +
    `Workerlar sekinlashishi mumkin. Active workerlarni kamaytiring ` +
    `yoki serverga CPU qo'shing.`
  );
}

function fmtRecover(s: CpuStat): string {
  return `\u2705 <b>CPU normallashdi</b>: ${s.percent}% (chegara ${s.threshold}%).`;
}

// PROKSI watchdog — proksi o'lsa (HTTP 402 = balans/trafik tugagan yoki
// ulanmaydi) adminlarga darrov xabar beradi. Bu holatda workerlar behuda
// Chrome ochmaydi — IPRoyal hisobini to'ldirish kerak.
function fmtProxyAlert(h: ProxyHealth, todayGb: number): string {
  const head = h.outOfBalance
    ? `\u26a0\ufe0f <b>Proksi balansi tugagan \u2014 ish bajarilmaydi</b>`
    : `\u26a0\ufe0f <b>Proksi ishlamayapti \u2014 ish bajarilmaydi</b>`;
  return (
    `${head}\n` +
    `Sabab: ${h.reason}\n` +
    `Bugun ishlatilgan: <b>${todayGb.toFixed(2)} GB</b>\n\n` +
    `Workerlar yangi ish boshlamaydi. IPRoyal hisobini to'ldiring, ` +
    `so'ng sozlamalarda "Proksi to'landi" tugmasi bilan blokni oching.`
  );
}

function fmtProxyRecover(h: ProxyHealth): string {
  const ip = h.exitIp ? ` \u00b7 chiqish IP ${h.exitIp}` : "";
  return `\u2705 <b>Proksi tiklandi</b>${ip}. Ishlar avtomatik davom etadi.`;
}

// Sozlamalar endi bazadan keladi (TELEGRAM_BOT_TOKEN, PROXY_* va h.k. .env da
// comment qilingan). Shu sabab watchdog/polling boshlashdan oldin DB dan
// env ga yuklab olamiz.
(async () => {
  await loadSettingsIntoEnv(true);

  if (isTelegramConfigured()) {
    startCpuWatchdog({
      onAlert: async (s) => {
        await broadcastMessage(fmtAlert(s)).catch(() => {});
      },
      onRecover: async (s) => {
        await broadcastMessage(fmtRecover(s)).catch(() => {});
      },
    });
    // eslint-disable-next-line no-console
    console.log("[bot] CPU watchdog yoqildi (80% dan oshsa ogohlantiradi)");

    startProxyWatchdog({
      onAlert: async (h) => {
        const todayGb = await todayUsageGb().catch(() => 0);
        await broadcastMessage(fmtProxyAlert(h, todayGb)).catch(() => {});
      },
      onRecover: async (h) => {
        await broadcastMessage(fmtProxyRecover(h)).catch(() => {});
      },
    });
    // eslint-disable-next-line no-console
    console.log(
      "[bot] Proksi watchdog yoqildi (402/o'lim holatida ogohlantiradi)",
    );
  }

  await runBotPolling();
})().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Bot to'xtadi:", e);
  process.exit(1);
});
