import amqp from "amqplib";
import Redis from "ioredis";
import { ApplicantStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { sanitizeProfileKey } from "./automation";

// Har bir job = bitta arizachi (user) + bosqich. 10 ta worker parallel oladi.
export type OrderJob = {
  jobId: string;
  applicantId: number;
  groupId: number;
  stage: "register" | "order";
  source: "web" | "bot" | "system";
  requestedAt: string;
  reason?: string;
};

export type EnqueueResult = {
  ok: boolean;
  queued: boolean;
  applicantId?: number;
  groupId: number;
  jobId?: string;
  reason?: string;
};

export type EnqueueManyResult = {
  totalGroups: number;
  queuedJobs: number;
  skippedJobs: number;
  details: EnqueueResult[];
};

let rabbitConn: amqp.ChannelModel | null = null;
let rabbitChannel: amqp.Channel | null = null;
let redisClient: Redis | null = null;

function queueName() {
  return process.env.ORDER_QUEUE_NAME || "order.jobs";
}

function rabbitUrl() {
  return process.env.RABBITMQ_URL || "amqp://guest:guest@127.0.0.1:5672";
}

function redisUrl() {
  return process.env.REDIS_URL || "redis://127.0.0.1:6379";
}

function dedupeKey(applicantId: number, stage: string) {
  return `order:queued:applicant:${applicantId}:${stage}`;
}

export function profileLockKey(profileKey: string) {
  return `order:profile:lock:${profileKey}`;
}

export function resolveProfileName() {
  return (
    process.env.ORDER_WORKER_PROFILE_NAME || process.env.HOSTNAME || "worker"
  );
}

export async function getRedis() {
  if (redisClient) return redisClient;
  redisClient = new Redis(redisUrl(), {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
  await redisClient.connect();
  return redisClient;
}

async function getChannel() {
  if (rabbitChannel) return rabbitChannel;
  rabbitConn = await amqp.connect(rabbitUrl());
  rabbitConn.on("close", () => {
    rabbitConn = null;
    rabbitChannel = null;
  });
  rabbitConn.on("error", () => {
    rabbitConn = null;
    rabbitChannel = null;
  });

  rabbitChannel = await rabbitConn.createChannel();
  await rabbitChannel.assertQueue(queueName(), { durable: true });
  return rabbitChannel;
}

// Bitta arizachi uchun job qo'shadi (dedupe bilan).
async function enqueueApplicantJob(params: {
  applicantId: number;
  groupId: number;
  stage: "register" | "order";
  source: "web" | "bot" | "system";
  reason?: string;
  force?: boolean;
}): Promise<EnqueueResult> {
  const { applicantId, groupId, stage, source } = params;
  const redis = await getRedis();
  const dedupe = await redis.set(
    dedupeKey(applicantId, stage),
    "1",
    "EX",
    60 * 20,
    "NX",
  );
  if (!params.force && dedupe !== "OK") {
    return {
      ok: true,
      queued: false,
      applicantId,
      groupId,
      reason: "Allaqachon navbatda",
    };
  }

  const job: OrderJob = {
    jobId: `${Date.now()}-${applicantId}-${Math.random().toString(36).slice(2, 8)}`,
    applicantId,
    groupId,
    stage,
    source,
    requestedAt: new Date().toISOString(),
    reason: params.reason,
  };

  const ch = await getChannel();
  const sent = ch.sendToQueue(queueName(), Buffer.from(JSON.stringify(job)), {
    persistent: true,
    contentType: "application/json",
    messageId: job.jobId,
    timestamp: Date.now(),
  });

  if (!sent) {
    await redis.del(dedupeKey(applicantId, stage));
    return {
      ok: false,
      queued: false,
      applicantId,
      groupId,
      reason: "Queue'ga yuborib bo'lmadi",
    };
  }

  return { ok: true, queued: true, applicantId, groupId, jobId: job.jobId };
}

// Guruhdagi barcha REGISTERED arizachilar uchun order jobi qo'shadi (fan-out).
export async function enqueueGroupOrder(params: {
  groupId: number;
  source?: "web" | "bot" | "system";
  reason?: string;
  force?: boolean;
}): Promise<EnqueueManyResult & { groupId: number }> {
  const groupId = Number(params.groupId);
  const source = params.source || "web";

  const applicants = await prisma.applicant.findMany({
    where: { groupId, status: ApplicantStatus.REGISTERED },
    select: { id: true },
  });

  const details: EnqueueResult[] = [];
  for (const a of applicants) {
    details.push(
      await enqueueApplicantJob({
        applicantId: a.id,
        groupId,
        stage: "order",
        source,
        reason: params.reason,
        force: params.force,
      }),
    );
  }

  const queuedJobs = details.filter((d) => d.queued).length;
  return {
    groupId,
    totalGroups: 1,
    queuedJobs,
    skippedJobs: details.length - queuedJobs,
    details,
  };
}

// Guruhdagi register kerak bo'lgan (NEW/EDITED/BOOKING) arizachilar uchun
// register jobi qo'shadi (fan-out) — 10 worker parallel bajaradi.
export async function enqueueGroupRegister(params: {
  groupId: number;
  source?: "web" | "bot" | "system";
  reason?: string;
  force?: boolean;
}): Promise<EnqueueManyResult & { groupId: number }> {
  const groupId = Number(params.groupId);
  const source = params.source || "web";

  const applicants = await prisma.applicant.findMany({
    where: {
      groupId,
      status: {
        in: [
          ApplicantStatus.NEW,
          ApplicantStatus.EDITED,
          ApplicantStatus.BOOKING,
        ],
      },
    },
    select: { id: true },
  });

  const details: EnqueueResult[] = [];
  for (const a of applicants) {
    details.push(
      await enqueueApplicantJob({
        applicantId: a.id,
        groupId,
        stage: "register",
        source,
        reason: params.reason,
        force: params.force,
      }),
    );
  }

  const queuedJobs = details.filter((d) => d.queued).length;
  return {
    groupId,
    totalGroups: 1,
    queuedJobs,
    skippedJobs: details.length - queuedJobs,
    details,
  };
}

// Bitta arizachini (user) navbatga qo'shadi — register yoki order.
export async function enqueueApplicant(params: {
  applicantId: number;
  stage: "register" | "order";
  source?: "web" | "bot" | "system";
  reason?: string;
  force?: boolean;
}): Promise<EnqueueResult> {
  const applicant = await prisma.applicant.findUnique({
    where: { id: Number(params.applicantId) },
    select: { id: true, groupId: true },
  });
  if (!applicant) {
    return {
      ok: false,
      queued: false,
      groupId: 0,
      reason: "Arizachi topilmadi",
    };
  }
  return enqueueApplicantJob({
    applicantId: applicant.id,
    groupId: applicant.groupId,
    stage: params.stage,
    source: params.source || "web",
    reason: params.reason,
    force: params.force,
  });
}

// Barcha guruhlardagi REGISTERED arizachilar uchun order jobi qo'shadi.
export async function enqueueAllRegisteredGroups(
  source: "web" | "bot" | "system" = "system",
): Promise<EnqueueManyResult> {
  const applicants = await prisma.applicant.findMany({
    where: { status: ApplicantStatus.REGISTERED, group: { paused: false } },
    select: { id: true, groupId: true },
  });

  const details: EnqueueResult[] = [];
  for (const a of applicants) {
    details.push(
      await enqueueApplicantJob({
        applicantId: a.id,
        groupId: a.groupId,
        stage: "order",
        source,
        reason: "global-monitor",
      }),
    );
  }

  const groups = new Set(applicants.map((a) => a.groupId));
  const queuedJobs = details.filter((d) => d.queued).length;
  return {
    totalGroups: groups.size,
    queuedJobs,
    skippedJobs: details.length - queuedJobs,
    details,
  };
}

// Eskirgan (registerFinishedAt yo'q yoki TTL'dan eski) REGISTERED arizachilarni
// qayta register qilish uchun navbatga qo'shadi (slot oynasidan oldingi lead).
export async function enqueueStaleReRegisters(
  source: "web" | "bot" | "system" = "system",
): Promise<{ total: number; queued: number; skipped: number }> {
  const ttlH = Number(process.env.REGISTER_TTL_HOURS || 24);
  const cutoff = new Date(Date.now() - (ttlH > 0 ? ttlH : 24) * 3600 * 1000);

  const applicants = await prisma.applicant.findMany({
    where: {
      status: ApplicantStatus.REGISTERED,
      OR: [
        { registerFinishedAt: null },
        { registerFinishedAt: { lt: cutoff } },
      ],
    },
    select: { id: true, groupId: true },
  });

  const details: EnqueueResult[] = [];
  for (const a of applicants) {
    details.push(
      await enqueueApplicantJob({
        applicantId: a.id,
        groupId: a.groupId,
        stage: "register",
        source,
        reason: "slot-lead-reregister",
      }),
    );
  }

  const queued = details.filter((d) => d.queued).length;
  return { total: applicants.length, queued, skipped: details.length - queued };
}

// Bitta slotga bog'langan guruhlardagi REGISTERED arizachilar uchun order jobi.
export async function enqueueSlotRegisteredGroups(
  slotId: number,
  source: "web" | "bot" | "system" = "system",
): Promise<EnqueueManyResult> {
  const applicants = await prisma.applicant.findMany({
    where: {
      status: ApplicantStatus.REGISTERED,
      group: { paused: false, slotId },
    },
    select: { id: true, groupId: true },
  });

  const details: EnqueueResult[] = [];
  for (const a of applicants) {
    details.push(
      await enqueueApplicantJob({
        applicantId: a.id,
        groupId: a.groupId,
        stage: "order",
        source,
        reason: `slot-${slotId}-monitor`,
      }),
    );
  }

  const groups = new Set(applicants.map((a) => a.groupId));
  const queuedJobs = details.filter((d) => d.queued).length;
  return {
    totalGroups: groups.size,
    queuedJobs,
    skippedJobs: details.length - queuedJobs,
    details,
  };
}

// Slotga bog'langan guruhlardagi eskirgan registerlarni qayta navbatga qo'shadi.
export async function enqueueSlotStaleReRegisters(
  slotId: number,
  source: "web" | "bot" | "system" = "system",
): Promise<{ total: number; queued: number; skipped: number }> {
  const ttlH = Number(process.env.REGISTER_TTL_HOURS || 24);
  const cutoff = new Date(Date.now() - (ttlH > 0 ? ttlH : 24) * 3600 * 1000);

  const applicants = await prisma.applicant.findMany({
    where: {
      status: ApplicantStatus.REGISTERED,
      group: { slotId },
      OR: [
        { registerFinishedAt: null },
        { registerFinishedAt: { lt: cutoff } },
      ],
    },
    select: { id: true, groupId: true },
  });

  const details: EnqueueResult[] = [];
  for (const a of applicants) {
    details.push(
      await enqueueApplicantJob({
        applicantId: a.id,
        groupId: a.groupId,
        stage: "register",
        source,
        reason: `slot-${slotId}-lead-reregister`,
      }),
    );
  }

  const queued = details.filter((d) => d.queued).length;
  return { total: applicants.length, queued, skipped: details.length - queued };
}

export async function consumeOrderQueue(
  onMessage: (job: OrderJob) => Promise<void>,
): Promise<void> {
  const ch = await getChannel();
  await ch.prefetch(Number(process.env.ORDER_WORKER_PREFETCH || 1));

  await ch.consume(queueName(), async (msg) => {
    if (!msg) return;

    let job: OrderJob | null = null;
    try {
      job = JSON.parse(msg.content.toString("utf8")) as OrderJob;
    } catch {
      ch.ack(msg);
      return;
    }

    try {
      await onMessage(job);
      ch.ack(msg);
    } catch {
      ch.nack(msg, false, true);
    }
  });
}

// Bir userning gmail profilini bitta worker egallaydi (parallel ziddiyat yo'q).
export async function acquireProfileLock(profileKey: string, holder: string) {
  const safe = sanitizeProfileKey(profileKey) || "default";
  const redis = await getRedis();
  const got = await redis.set(
    profileLockKey(safe),
    holder,
    "EX",
    60 * 15,
    "NX",
  );
  return got === "OK";
}

export async function releaseProfileLock(
  profileKey: string,
  applicantId: number,
) {
  const safe = sanitizeProfileKey(profileKey) || "default";
  const redis = await getRedis();
  await redis.del(profileLockKey(safe));
  await redis.del(dedupeKey(applicantId, "order"));
  await redis.del(dedupeKey(applicantId, "register"));
}

// ----------------------- Worker heartbeat (monitoring) -----------------------

const HEARTBEAT_PREFIX = "worker:heartbeat:";

export type WorkerHeartbeat = {
  profile: string;
  status: "idle" | "busy";
  applicantId?: number;
  groupId?: number;
  stage?: string;
  updatedAt: string;
};

export async function setWorkerHeartbeat(hb: WorkerHeartbeat) {
  try {
    const redis = await getRedis();
    await redis.set(
      `${HEARTBEAT_PREFIX}${hb.profile}`,
      JSON.stringify(hb),
      "EX",
      60,
    );
  } catch {
    /* heartbeat muhim emas — xato bo'lsa o'tkazib yuboramiz */
  }
}

export async function getWorkersStatus(): Promise<WorkerHeartbeat[]> {
  try {
    const redis = await getRedis();
    const keys = await redis.keys(`${HEARTBEAT_PREFIX}*`);
    if (!keys.length) return [];
    const values = await redis.mget(keys);
    const out: WorkerHeartbeat[] = [];
    for (const v of values) {
      if (!v) continue;
      try {
        out.push(JSON.parse(v) as WorkerHeartbeat);
      } catch {
        /* skip */
      }
    }
    return out.sort((a, b) => a.profile.localeCompare(b.profile));
  } catch {
    return [];
  }
}

export async function getQueueDepth(): Promise<number> {
  try {
    const ch = await getChannel();
    const q = await ch.checkQueue(queueName());
    return q.messageCount;
  } catch {
    return 0;
  }
}
