// Telegram bot ishga tushirish nuqtasi (long polling).
// Ishga tushirish:  npm run bot
// .env: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_IDS, DATABASE_URL

import "dotenv/config";
import { runBotPolling } from "../lib/telegram-bot";

runBotPolling().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Bot to'xtadi:", e);
  process.exit(1);
});
