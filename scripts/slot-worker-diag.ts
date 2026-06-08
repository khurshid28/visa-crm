import "dotenv/config";
import { prisma } from "../lib/prisma";

// Slot-worker holatini tashxislash: slotlar, oyna vaqtlari, worker tekshiradimi.
async function main() {
  const now = new Date();
  const all = await prisma.slot.findMany({
    orderBy: { slotAt: "asc" },
  });
  console.log(`\n=== JAMI slotlar: ${all.length} ===`);
  console.log(`Hozir: ${now.toISOString()}\n`);

  for (const s of all) {
    const at = s.slotAt ? new Date(s.slotAt) : null;
    const windowMs = s.windowMinutes * 60_000;
    const leadMs = s.registerLeadMinutes * 60_000;
    let phase = "—";
    if (!s.active) phase = "NOFAOL (active=false)";
    else if (s.paused) phase = "PAUSE";
    else if (!at) phase = "slotAt YO'Q";
    else {
      const leadStart = at.getTime() - windowMs - leadMs;
      const checkStart = at.getTime() - windowMs;
      const end = at.getTime() + windowMs;
      const t = now.getTime();
      if (t < leadStart) {
        const mins = Math.ceil((leadStart - t) / 60_000);
        phase = `HALI ERTA (tekshiruv ${mins} daq dan keyin boshlanadi)`;
      } else if (t < checkStart) phase = "REGISTER OYNASI (kalendar hali emas)";
      else if (t > end) phase = "OYNA TUGADI";
      else phase = ">>> TEKSHIRUV OYNASI (worker hozir kalendarni ochadi) <<<";
    }
    console.log(
      `#${s.id} "${s.name}" | active=${s.active} paused=${s.paused} | slotAt=${
        at ? at.toISOString() : "yo'q"
      } | window=${s.windowMinutes}m lead=${s.registerLeadMinutes}m`,
    );
    console.log(`     faza: ${phase}`);
    console.log(
      `     oxirgi tekshiruv: ${
        s.lastCheckAt ? new Date(s.lastCheckAt).toISOString() : "—"
      } | xabar: ${s.lastMessage || "—"}`,
    );
  }

  const active = all.filter((s) => s.active && !s.paused);
  console.log(`\n=== FAOL (active && !paused): ${active.length} ===`);
  if (active.length === 0) {
    console.log(
      "Worker ishlaydi, lekin tekshiradigan faol slot YO'Q — har siklda 'faol slot yo'q — kutilmoqda' deydi.",
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("XATO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
