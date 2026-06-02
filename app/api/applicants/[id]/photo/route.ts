import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";

type Params = { params: { id: string } };

// Rasmlar saqlanadigan papka (loyiha ildizidagi `uploads/passports`).
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "passports");

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

// POST — passport rasmini asl formatida saqlaydi va yo'lini yozadi.
export async function POST(req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const applicant = await prisma.applicant.findUnique({ where: { id } });
  if (!applicant) {
    return NextResponse.json({ error: "Topilmadi" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Fayl topilmadi" }, { status: 400 });
  }

  const ext = EXT[file.type] || "png";
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const fileName = `${id}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(UPLOAD_DIR, fileName), buf);

  const publicPath = `/api/applicants/${id}/photo`;
  await prisma.applicant.update({
    where: { id },
    data: { passportPhoto: publicPath },
  });

  return NextResponse.json({ ok: true, path: publicPath });
}

// GET — saqlangan passport rasmini qaytaradi (ko'rish uchun).
export async function GET(_req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  let found: { file: string; type: string } | null = null;
  for (const [type, ext] of Object.entries({
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
  } as Record<string, string>)) {
    const p = path.join(UPLOAD_DIR, `${id}.${type}`);
    try {
      await fs.access(p);
      found = { file: p, type: ext };
      break;
    } catch {
      // keyingisini sinab ko'ramiz
    }
  }
  if (!found) {
    return NextResponse.json({ error: "Rasm yo'q" }, { status: 404 });
  }
  const data = await fs.readFile(found.file);
  return new NextResponse(new Uint8Array(data), {
    headers: { "Content-Type": found.type, "Cache-Control": "no-store" },
  });
}
