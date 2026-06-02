// TD3 (passport) MRZ parser — deterministik, check-digit tekshiruvi bilan.
// Brauzerda ham, serverda ham ishlaydi (sof TS, tashqi bog'liqliksiz).
//
// MRZ — passportning pastki qismidagi 2 qator (har biri 44 belgi):
//   P<UZBMUKHAMMADIEV<<JURA<ESHMAMAT<UGLI<<<<<<<
//   FA22695025UZB9309256M3103038325099319000049 64

export type MrzResult = {
  ok: boolean; // barcha asosiy check-digitlar to'g'ri
  documentType: string;
  issuingCountry: string;
  surname: string;
  name: string;
  passportNumber: string;
  nationality: string;
  birthdate: string; // dd.mm.yyyy
  gender: string; // MALE | FEMALE | ""
  passportValidity: string; // dd.mm.yyyy
  checks: {
    passportNumber: boolean;
    birthdate: boolean;
    expiry: boolean;
  };
  raw: { line1: string; line2: string };
  errors: string[];
};

const CHAR_VALUE = (c: string): number => {
  if (c === "<") return 0;
  if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
  if (c >= "A" && c <= "Z") return c.charCodeAt(0) - 55; // A=10 ... Z=35
  return 0;
};

const WEIGHTS = [7, 3, 1];

function checkDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) {
    sum += CHAR_VALUE(field[i]) * WEIGHTS[i % 3];
  }
  return sum % 10;
}

function pad44(line: string): string {
  return (line + "<".repeat(44)).slice(0, 44);
}

// YYMMDD -> dd.mm.yyyy. isBirth: tug'ilgan sana uchun asr aniqlash.
function toDate(yymmdd: string, isBirth: boolean): string {
  if (!/^\d{6}$/.test(yymmdd)) return "";
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const nowYY = new Date().getFullYear() % 100;
  let year: number;
  if (isBirth) {
    year = yy > nowYY ? 1900 + yy : 2000 + yy;
  } else {
    // amal muddati — odatda kelajak: 20yy
    year = 2000 + yy;
  }
  return `${dd}.${mm}.${year}`;
}

// OCR ko'p adashtiradigan belgilar. Raqamli maydonlarda harf -> raqam.
const TO_DIGIT: Record<string, string> = {
  O: "0",
  Q: "0",
  D: "0",
  I: "1",
  L: "1",
  Z: "2",
  S: "5",
  B: "8",
  G: "6",
  T: "7",
};
function digitsOnly(s: string): string {
  return s
    .split("")
    .map((c) => TO_DIGIT[c] ?? c)
    .join("");
}

// Bitta "line2" nomzodini tahlil qilib, to'g'ri check-digit sonini qaytaradi.
function scoreLine2(line: string): { parsed: Line2; valid: number } | null {
  const l = pad44(line);
  const passportNumberRaw = l.slice(0, 9);
  const passportCheck = digitsOnly(l[9]);
  const nationality = l.slice(10, 13).replace(/</g, "");
  const birth = digitsOnly(l.slice(13, 19));
  const birthCheck = digitsOnly(l[19]);
  const sex = l[20];
  const expiry = digitsOnly(l.slice(21, 27));
  const expiryCheck = digitsOnly(l[27]);

  const checks = {
    passportNumber: String(checkDigit(passportNumberRaw)) === passportCheck,
    birthdate: String(checkDigit(birth)) === birthCheck,
    expiry: String(checkDigit(expiry)) === expiryCheck,
  };
  const valid =
    (checks.passportNumber ? 1 : 0) +
    (checks.birthdate ? 1 : 0) +
    (checks.expiry ? 1 : 0);

  // Tuzilma minimal mosligi: sana joylari raqam bo'lishi kerak
  const looksLikeMrz =
    /^\d{6}$/.test(birth) && /^\d{6}$/.test(expiry) && /[MFX<]/.test(sex);
  if (!looksLikeMrz && valid === 0) return null;

  return {
    parsed: {
      passportNumberRaw,
      passportNumber: passportNumberRaw.replace(/</g, ""),
      passportCheck,
      nationality,
      birth,
      birthCheck,
      sex,
      expiry,
      expiryCheck,
      checks,
    },
    valid,
  };
}

type Line2 = {
  passportNumberRaw: string;
  passportNumber: string;
  passportCheck: string;
  nationality: string;
  birth: string;
  birthCheck: string;
  sex: string;
  expiry: string;
  expiryCheck: string;
  checks: { passportNumber: boolean; birthdate: boolean; expiry: boolean };
};

// Raw matndan eng yaxshi MRZ juftligini (line1/line2) tanlaydi.
function extractLines(text: string): { line1: string; line2: string } | null {
  let raw = text
    .toUpperCase()
    .split(/\r?\n/)
    .map((l) => l.replace(/[^A-Z0-9<]/g, ""))
    .filter((l) => l.length >= 28);

  // Ba'zan OCR ikkala qatorni bitta qilib qo'shadi (~88 belgi) — bo'lamiz.
  const split: string[] = [];
  for (const l of raw) {
    if (l.length >= 80) {
      split.push(l.slice(0, 44), l.slice(44));
    } else {
      split.push(l);
    }
  }
  raw = split.filter((l) => l.length >= 28);
  if (raw.length < 2) return null;

  // Eng yaxshi line2 nomzodini tanlaymiz (check-digit soni bo'yicha).
  let bestIdx = -1;
  let best: { parsed: Line2; valid: number } | null = null;
  for (let i = 0; i < raw.length; i++) {
    const s = scoreLine2(raw[i]);
    if (!s) continue;
    if (!best || s.valid > best.valid) {
      best = s;
      bestIdx = i;
    }
  }
  if (!best || bestIdx < 0) return null;

  // line1 — line2 dan oldingi, ism ajratuvchisi "<<" bor qator (yoki P bilan).
  let l1 = "";
  for (let i = bestIdx - 1; i >= 0; i--) {
    if (raw[i].includes("<<") || /^P/.test(raw[i])) {
      l1 = raw[i];
      break;
    }
  }
  if (!l1) {
    const prev = raw[bestIdx - 1];
    l1 =
      prev && prev.includes("<")
        ? prev
        : raw.find((l) => l.includes("<<")) || "";
  }

  return { line1: pad44(l1), line2: pad44(raw[bestIdx]) };
}

/** MRZ matnini (yoki 2 qatorni) tahlil qiladi. */
export function parseMrz(input: string): MrzResult | null {
  const lines = extractLines(input);
  if (!lines) return null;
  const { line1, line2 } = lines;
  const errors: string[] = [];

  // 1-qator: ism/familiya
  const documentType = line1[0] || "";
  const issuingCountry = line1.slice(2, 5).replace(/</g, "");
  const namePart = line1.slice(5);
  const [surnameRaw, givenRaw = ""] = namePart.split("<<");
  const surname = surnameRaw.replace(/</g, " ").trim();
  const name = givenRaw.replace(/</g, " ").replace(/\s+/g, " ").trim();

  // 2-qator: maydonlar (OCR tuzatish bilan)
  const l2 = scoreLine2(line2);
  if (!l2) return null;
  const {
    passportNumberRaw,
    passportNumber,
    passportCheck,
    nationality,
    birth,
    birthCheck,
    sex,
    expiry,
    expiryCheck,
  } = l2.parsed;

  const checks = {
    passportNumber: String(checkDigit(passportNumberRaw)) === passportCheck,
    birthdate: String(checkDigit(birth)) === birthCheck,
    expiry: String(checkDigit(expiry)) === expiryCheck,
  };
  if (!checks.passportNumber) errors.push("Passport raqami check-digit xato");
  if (!checks.birthdate) errors.push("Tug'ilgan sana check-digit xato");
  if (!checks.expiry) errors.push("Amal muddati check-digit xato");

  const gender = sex === "M" ? "MALE" : sex === "F" ? "FEMALE" : "";

  return {
    ok: checks.passportNumber && checks.birthdate && checks.expiry,
    documentType,
    issuingCountry,
    surname,
    name,
    passportNumber,
    nationality,
    birthdate: toDate(birth, true),
    gender,
    passportValidity: toDate(expiry, false),
    checks,
    raw: { line1, line2 },
    errors,
  };
}
