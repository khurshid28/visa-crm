import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildApplicantPdf } from "@/lib/pdf";

type Params = { params: { id: string } };

// GET /api/applicants/:id/pdf — arizachi uchun tasdiq PDF yaratib qaytaradi
export async function GET(_req: NextRequest, { params }: Params) {
  const id = Number(params.id);
  const a = await prisma.applicant.findUnique({
    where: { id },
    include: { group: true },
  });
  if (!a) return NextResponse.json({ error: "Topilmadi" }, { status: 404 });

  const bytes = await buildApplicantPdf(a);

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="appointment-${a.id}.pdf"`,
    },
  });
}
