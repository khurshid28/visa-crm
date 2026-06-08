import "dotenv/config";
import { prisma } from "../lib/prisma";
import { runSlotTick } from "../lib/slots";

// Botni SINASH: slot #1 ni tekshiruv oynasiga qo'yib (slotAt = hozir), bitta
// tick'ni notify=true bilan ishga tushiramiz. Worker aynan shunday chaqiradi.
// Akkaunt 429001 bloklangan bo'lsa ham "tekshiruv" xabari adminlarga ketadi
// (bu bot yuborish yo'lini isbotlaydi).
async function main() {
  const id = Number(process.argv[2] || 1);
  const now = new Date();

  const before = await prisma.slot.findUnique({ where: { id } });
  if (!before) {
    console.log(`Slot #${id} topilmadi.`);
    await prisma.$disconnect();
    return;
  }

  // Slotni tekshiruv oynasiga keltiramiz: slotAt = hozir, faol.
  await prisma.slot.update({
    where: { id },
    data: { slotAt: now, active: true, paused: false },
  });
  console.log(
    `Slot #${id} "${before.name}" slotAt = ${now.toISOString()} (hozir) qilindi.`,
  );

  console.log("runSlotTick(notify:true) ishga tushmoqda — bot xabar bersin...");
  const res = await runSlotTick(id, { notify: true });
  console.log("\n=== NATIJA ===");
  console.log("checked:", res.checked, "| slotOpen:", res.slotOpen);
  console.log("message:", res.message);

  // notifySlotCheck "fire-and-forget" — Telegram HTTP so'rovi tugashi uchun
  // jarayon yopilishidan oldin biroz kutamiz (worker'da 10 daq uyqu buni qoplaydi).
  console.log("\nTelegram yuborilishini kutamiz (8s)...");
  await new Promise((r) => setTimeout(r, 8000));
  console.log("Tugadi — adminlar Telegram'ni tekshirsin.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("XATO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
