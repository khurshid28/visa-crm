// Telegram bot ishga tushirish nuqtasi (long polling).
// Ishga tushirish:  npm run bot
// .env: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_IDS, DATABASE_URL

import "dotenv/config";
import { runBotPolling } from "../lib/telegram-bot";
import { startCpuWatchdog, type CpuStat } from "../lib/cpu";
import { broadcastMessage, isTelegramConfigured } from "../lib/telegram";

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
}

runBotPolling().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Bot to'xtadi:", e);
  process.exit(1);
});
