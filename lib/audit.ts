// Arizachi (user/mijoz) o'zgarishlarini tarixga yozish (audit log).
// Web (API route) va kelajakda bot ham shu funksiyani ishlatadi.

import { prisma } from "./prisma";

// JSON'ga xavfsiz aylantiradi (Date va undefined'larni qisqartiradi).
function toJson(
  obj: Record<string, unknown> | null | undefined,
): string | null {
  if (!obj) return null;
  try {
    return JSON.stringify(obj);
  } catch {
    return null;
  }
}

// Bitta arizachi o'zgarishini yozadi. Yozuv muvaffaqiyatsiz bo'lsa ham
// asosiy amal (tahrir/o'chirish) buzilmaydi.
export async function logApplicantChange(params: {
  applicantId: number | null;
  groupId?: number | null;
  action: "edit" | "status" | "delete";
  fields?: string[];
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  actor?: string | null;
  source?: "web" | "bot" | "system";
}): Promise<void> {
  try {
    await prisma.applicantChangeLog.create({
      data: {
        applicantId: params.applicantId,
        groupId: params.groupId ?? null,
        action: params.action,
        fields: params.fields?.length ? params.fields.join(", ") : null,
        before: toJson(params.before),
        after: toJson(params.after),
        actor: params.actor ?? null,
        source: params.source ?? "web",
      },
    });
  } catch {
    // audit yozuvi muvaffaqiyatsiz bo'lsa ham davom etamiz.
  }
}
