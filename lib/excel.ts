import * as XLSX from "xlsx";

export type ParsedApplicant = {
  surname: string;
  name: string;
  passportNumber: string;
  nationality?: string;
  gender?: string;
  birthdate?: string;
  passportValidity?: string;
  phone?: string;
  email?: string;
  source?: string;
  subcategory?: string;
  city?: string;
  category?: string;
  price?: string;
  bookDateFrom?: string;
  bookDateTo?: string;
  regDaysBefore?: string;
  groupLabel?: string;
};

// VFS booking uchun majburiy maydonlar (to'liqlik shu bo'yicha aniqlanadi).
export const REQUIRED_FIELDS: (keyof ParsedApplicant)[] = [
  "surname",
  "name",
  "passportNumber",
  "nationality",
  "gender",
  "birthdate",
  "passportValidity",
];

// Excel sarlavhalarini ichki maydonlarga bog'laymiz.
const HEADER_MAP: Record<string, keyof ParsedApplicant> = {
  city: "city",
  category: "category",
  subcategory: "subcategory",
  price: "price",
  surname: "surname",
  familiya: "surname",
  name: "name",
  ism: "name",
  "passport number": "passportNumber",
  "passport raqami": "passportNumber",
  "pasport raqami": "passportNumber",
  "passport validity": "passportValidity",
  "pasport amal": "passportValidity",
  passport: "passportNumber",
  pasport: "passportNumber",
  birthdate: "birthdate",
  "tug'ilgan": "birthdate",
  gender: "gender",
  jins: "gender",
  phone: "phone",
  telefon: "phone",
  nationality: "nationality",
  millat: "nationality",
  "book date from": "bookDateFrom",
  "book date to": "bookDateTo",
  source: "source",
  "reg. days before": "regDaysBefore",
  "reg days before": "regDaysBefore",
  group: "groupLabel",
  "e-mail": "email",
  email: "email",
};

// Kalitlarni uzunligi bo'yicha kamayuvchi tartibda — "passport validity"
// "passport"dan oldin tekshiriladi.
const HEADER_ENTRIES = Object.entries(HEADER_MAP).sort(
  (a, b) => b[0].length - a[0].length,
);

function normHeader(h: string): keyof ParsedApplicant | null {
  const key = String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!key) return null;
  if (HEADER_MAP[key]) return HEADER_MAP[key];
  for (const [k, v] of HEADER_ENTRIES) {
    if (key.startsWith(k) || key.includes(k)) return v;
  }
  return null;
}

function clean(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

export function isComplete(rec: Partial<ParsedApplicant>): boolean {
  return REQUIRED_FIELDS.every((f) => clean(rec[f]).length > 0);
}

export function missingFields(rec: Partial<ParsedApplicant>): string[] {
  return REQUIRED_FIELDS.filter((f) => clean(rec[f]).length === 0);
}

// Majburiy maydonlarning o'zbekcha nomlari (xatolarni ko'rsatish uchun).
export const FIELD_LABELS: Record<string, string> = {
  surname: "Familiya",
  name: "Ism",
  passportNumber: "Passport raqami",
  nationality: "Fuqarolik",
  gender: "Jins",
  birthdate: "Tug'ilgan sana",
  passportValidity: "Passport amal muddati",
};

// Yetishmayotgan maydonlarni o'zbekcha nom bilan qaytaradi.
export function missingFieldLabels(rec: Partial<ParsedApplicant>): string[] {
  return missingFields(rec).map((f) => FIELD_LABELS[f] ?? f);
}

/**
 * Excel/CSV buffer'dan arizachilar ro'yxatini o'qiydi.
 * Faqat surname+name+passport bo'lgan qatorlar qabul qilinadi (minimal identifikatsiya).
 * To'liqligi (required) `isComplete`/`missingFields` orqali alohida aniqlanadi.
 */
export function parseApplicantsFromBuffer(buf: Buffer): ParsedApplicant[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (rows.length < 2) return [];

  // Sarlavha qatorini topamiz (passport/surname so'zi bo'lgan qator)
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const joined = rows[i].map((c) => String(c).toLowerCase()).join(" ");
    if (joined.includes("passport") || joined.includes("surname")) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = rows[headerRowIdx].map((h) => normHeader(String(h)));
  const out: ParsedApplicant[] = [];

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const rec: Partial<ParsedApplicant> = {};
    headers.forEach((field, c) => {
      if (field && !rec[field]) rec[field] = clean(row[c]);
    });
    if (rec.surname && rec.name && rec.passportNumber) {
      out.push({
        surname: rec.surname,
        name: rec.name,
        passportNumber: rec.passportNumber,
        nationality: rec.nationality || undefined,
        gender: rec.gender || undefined,
        birthdate: rec.birthdate || undefined,
        passportValidity: rec.passportValidity || undefined,
        phone: rec.phone || undefined,
        email: rec.email || undefined,
        source: rec.source || undefined,
        subcategory: rec.subcategory || undefined,
        city: rec.city || undefined,
        category: rec.category || undefined,
        price: rec.price || undefined,
        bookDateFrom: rec.bookDateFrom || undefined,
        bookDateTo: rec.bookDateTo || undefined,
        regDaysBefore: rec.regDaysBefore || undefined,
        groupLabel: rec.groupLabel || undefined,
      });
    }
  }
  return out;
}
