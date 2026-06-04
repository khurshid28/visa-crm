import "dotenv/config";
import {
  consumeOrderQueue,
  acquireProfileLock,
  releaseProfileLock,
  resolveProfileName,
  setWorkerHeartbeat,
} from "../lib/order-queue";
import { bookApplicant } from "../lib/booking";
import { prisma } from "../lib/prisma";

const profileName = resolveProfileName();

async function heartbeat(
  status: "idle" | "busy",
  extra: Partial<{ applicantId: number; groupId: number; stage: string }> = {},
) {
  await setWorkerHeartbeat({
    profile: profileName,
    status,
    updatedAt: new Date().toISOString(),
    ...extra,
  });
}

async function start() {
  // eslint-disable-next-line no-console
  console.log(`[order-worker:${profileName}] started`);
  await heartbeat("idle");

  // Har 20 soniyada idle heartbeat (bo'sh turganda ham ko'rinib tursin).
  setInterval(() => {
    heartbeat("idle").catch(() => {});
  }, 20000);

  await consumeOrderQueue(async (job) => {
    const applicant = await prisma.applicant.findUnique({
      where: { id: job.applicantId },
      select: { id: true, generatedEmail: true, email: true },
    });
    if (!applicant) return;

    const profileKey =
      applicant.generatedEmail ||
      applicant.email ||
      `applicant-${applicant.id}`;

    // Shu userning gmail profilini band qilamiz — boshqa worker tegmaydi.
    const locked = await acquireProfileLock(profileKey, profileName);
    if (!locked) {
      // eslint-disable-next-line no-console
      console.log(
        `[order-worker:${profileName}] profil band, keyinroq: ${profileKey}`,
      );
      // qayta navbatga tushishi uchun throw
      throw new Error("profile locked");
    }

    try {
      await heartbeat("busy", {
        applicantId: job.applicantId,
        groupId: job.groupId,
        stage: job.stage,
      });
      // eslint-disable-next-line no-console
      console.log(
        `[order-worker:${profileName}] ${job.stage} applicant=${job.applicantId} (${profileKey})`,
      );
      const out = await bookApplicant(job.applicantId, job.stage, profileName);
      // eslint-disable-next-line no-console
      console.log(
        `[order-worker:${profileName}] done applicant=${job.applicantId} ok=${out?.result.ok}`,
      );
    } finally {
      await releaseProfileLock(profileKey, job.applicantId);
      await heartbeat("idle");
    }
  });
}

start().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(`[order-worker:${profileName}] fatal:`, e);
  process.exit(1);
});
