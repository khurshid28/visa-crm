import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { APPLICANT_STATUS } from "@/lib/status";

type Params = { params: { id: string } };

// GET /api/groups/:id/report — guruh arizachilarini Excel hisobot sifatida yuklab beradi.
// Asl Excel ustunlari + tizim qo'shgan maydonlar (email, status, appointment, ...).
export async function GET(_req: NextRequest, { params }: Params) {
  const groupId = Number(params.id);
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { applicants: { orderBy: { id: "asc" } } },
  });

  if (!group) {
    return NextResponse.json({ error: "Guruh topilmadi" }, { status: 404 });
  }

  const rows = group.applicants.map((a, i) => ({
    "#": i + 1,
    City: a.city ?? "",
    Category: a.category ?? "",
    Subcategory: a.subcategory ?? "",
    Price: a.price ?? "",
    Surname: a.surname,
    Name: a.name,
    "Passport number": a.passportNumber,
    "Passport validity": a.passportValidity ?? "",
    Birthdate: a.birthdate ?? "",
    Gender: a.gender ?? "",
    Phone: a.phone ?? "",
    Nationality: a.nationality ?? "",
    "Book date from": a.bookDateFrom ?? "",
    "Book date to": a.bookDateTo ?? "",
    Source: a.source ?? "",
    "Reg. days before": a.regDaysBefore ?? "",
    Group: a.groupLabel ?? "",
    "E-mail": a.email ?? "",
    // --- Tizim qo'shgan maydonlar ---
    "Tizim email": a.generatedEmail ?? "",
    "To'liq": a.complete ? "Ha" : "Yo'q",
    Status: APPLICANT_STATUS[a.status]?.label ?? a.status,
    "Appointment raqami": a.appointmentRef ?? "",
    Natija: a.resultNote ?? "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  // Ustun kengliklarini ozgina kengaytiramiz.
  const headerKeys = rows.length ? Object.keys(rows[0]) : [];
  ws["!cols"] = headerKeys.map((k) => ({
    wch: Math.max(10, Math.min(28, k.length + 4)),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Hisobot");
  const buf = XLSX.write(wb, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;

  const safeName = (group.name || `guruh-${groupId}`)
    .replace(/[^a-z0-9\-_]+/gi, "_")
    .slice(0, 40);
  const fileName = `hisobot-${safeName}.xlsx`;

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
