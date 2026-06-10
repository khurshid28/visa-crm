import "dotenv/config";
import {
  listWorkers,
  activeWorkers,
  setActive,
  setActiveCount,
  addWorkers,
  ensureSeed,
  cpuAdvice,
  recommendedMax,
  cpuCores,
  workersPerCpu,
  isStale,
} from "../lib/workers";

// ===========================================================================
//  Worker boshqaruv CLI
//
//    npm run workers                # ro'yxat + CPU ma'lumot
//    npm run workers list
//    npm run workers on 8           # tartib bo'yicha birinchi 8 tasini active
//    npm run workers off 2          # active sonidan 2 tasini o'chiradi
//    npm run workers add 10         # yana 10 ta worker qo'shadi
//    npm run workers enable 3       # id=3 workerni yoqadi
//    npm run workers disable 3      # id=3 workerni o'chiradi
//    npm run workers cpu            # CPU sig'imi haqida tushuntirish
// ===========================================================================

function pad(s: string | number, n: number) {
  const v = String(s);
  return v.length >= n ? v : v + " ".repeat(n - v.length);
}

async function printList() {
  const workers = await listWorkers();
  const advice = await cpuAdvice();

  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(
    pad("ID", 4) +
      pad("NOM", 12) +
      pad("ACTIVE", 8) +
      pad("HOLAT", 10) +
      pad("JOBS", 6) +
      "CURRENT",
  );
  // eslint-disable-next-line no-console
  console.log("-".repeat(56));
  for (const w of workers) {
    const live = w.status !== "offline" && !isStale(w);
    const status =
      w.status === "offline" ? "offline" : live ? w.status : "stale";
    // eslint-disable-next-line no-console
    console.log(
      pad(w.id, 4) +
        pad(w.name, 12) +
        pad(w.active ? "ha" : "yo'q", 8) +
        pad(status, 10) +
        pad(w.jobsDone, 6) +
        (w.currentJob || "-"),
    );
  }
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(
    `CPU: ${cpuCores()} yadro × ${workersPerCpu()} = tavsiya max ${recommendedMax()} ta active`,
  );
  // eslint-disable-next-line no-console
  console.log(advice.overLimit ? `⚠ ${advice.message}` : advice.message);
  // eslint-disable-next-line no-console
  console.log("");
}

function usage() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Worker boshqaruv:",
      "  npm run workers              # ro'yxat + CPU ma'lumot",
      "  npm run workers list",
      "  npm run workers on <N>       # tartib bo'yicha birinchi N tasini active",
      "  npm run workers off <N>      # active sonidan N tasini o'chiradi",
      "  npm run workers add <N>      # yana N ta worker qo'shadi",
      "  npm run workers enable <id>  # bitta workerni yoqadi",
      "  npm run workers disable <id> # bitta workerni o'chiradi",
      "  npm run workers cpu          # CPU sig'imi haqida",
    ].join("\n"),
  );
}

async function main() {
  const [rawCmd, rawArg] = process.argv.slice(2);
  const cmd = (rawCmd || "list").toLowerCase();
  const arg = Number(rawArg);

  // Bazada kamida default (10) ta worker borligini ta'minlaymiz.
  await ensureSeed();

  switch (cmd) {
    case "list":
      await printList();
      break;

    case "on":
    case "active": {
      if (!Number.isFinite(arg) || arg < 0) {
        // eslint-disable-next-line no-console
        console.error("Nechta? Masalan: npm run workers on 8");
        break;
      }
      const advice = await cpuAdvice();
      const r = await setActiveCount(arg);
      // eslint-disable-next-line no-console
      console.log(
        `${r.active}/${r.total} ta worker active qilindi (tartib bo'yicha).`,
      );
      if (arg > recommendedMax()) {
        // eslint-disable-next-line no-console
        console.warn(`⚠ ${advice.message}`);
      }
      await printList();
      break;
    }

    case "off": {
      if (!Number.isFinite(arg) || arg < 0) {
        // eslint-disable-next-line no-console
        console.error("Nechta? Masalan: npm run workers off 2");
        break;
      }
      const active = (await activeWorkers()).length;
      const r = await setActiveCount(Math.max(0, active - arg));
      // eslint-disable-next-line no-console
      console.log(`${r.active}/${r.total} ta worker active qoldi.`);
      await printList();
      break;
    }

    case "add": {
      if (!Number.isFinite(arg) || arg <= 0) {
        // eslint-disable-next-line no-console
        console.error("Nechta? Masalan: npm run workers add 10");
        break;
      }
      const r = await addWorkers(arg);
      // eslint-disable-next-line no-console
      console.log(`${r.added} ta qo'shildi. Jami: ${r.total} ta.`);
      if (r.warning) {
        // eslint-disable-next-line no-console
        console.warn(`⚠ ${r.warning}`);
      }
      await printList();
      break;
    }

    case "enable": {
      if (!Number.isFinite(arg)) {
        // eslint-disable-next-line no-console
        console.error("Qaysi id? Masalan: npm run workers enable 3");
        break;
      }
      await setActive(arg, true);
      await printList();
      break;
    }

    case "disable": {
      if (!Number.isFinite(arg)) {
        // eslint-disable-next-line no-console
        console.error("Qaysi id? Masalan: npm run workers disable 3");
        break;
      }
      await setActive(arg, false);
      await printList();
      break;
    }

    case "cpu": {
      const a = await cpuAdvice();
      // eslint-disable-next-line no-console
      console.log(
        `CPU: ${a.cores} yadro × ${a.perCpu} = tavsiya max ${a.recommendedMax} ta active. Hozir ${a.activeNow} ta active.`,
      );
      // eslint-disable-next-line no-console
      console.log(a.message);
      break;
    }

    default:
      usage();
      break;
  }

  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("workers CLI xato:", e);
  process.exit(1);
});
