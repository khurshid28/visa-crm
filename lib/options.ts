// Jins va davlat (millat) ro'yxatlari — formani tanlash uchun.
// Qiymatlar MRZ chiqishi bilan mos: jins MALE/FEMALE, davlat ISO3 kodi.

export const GENDERS: { value: string; label: string }[] = [
  { value: "MALE", label: "Erkak" },
  { value: "FEMALE", label: "Ayol" },
];

// VFS Global appointment kategoriyalari va sub-kategoriyalari.
// Qiymatlar VFS saytidagi matn bilan AYNAN mos bo'lishi shart (avtomatlash
// shu matn bo'yicha tanlaydi), shuning uchun value = label.
export const CATEGORIES: { value: string; label: string }[] = [
  { value: "Latvia Long Stay/Visa D", label: "Latvia Long Stay/Visa D" },
  { value: "Latvia Short Stay", label: "Latvia Short Stay" },
];

export const SUBCATEGORIES: { value: string; label: string }[] = [
  {
    value: "Cargo drivers (Visa D) Tajik",
    label: "Cargo drivers (Visa D) Tajik",
  },
  {
    value: "Cargo drivers (Visa D) Uzbek, Turkmen",
    label: "Cargo drivers (Visa D) Uzbek, Turkmen",
  },
  { value: "OCMA decision Tajik", label: "OCMA decision Tajik" },
  {
    value: "OCMA decision Uzbek, Turkmen",
    label: "OCMA decision Uzbek, Turkmen",
  },
  { value: "Seasonal Works", label: "Seasonal Works" },
];

export const DEFAULT_COUNTRY = "UZB";

// Asosiy va yon-atrofdagi ~30 davlat (qisqartirilgan o'zbekcha nomlar bilan).
export const COUNTRY_NAMES: Record<string, string> = {
  UZB: "O'zbekiston",
  KAZ: "Qozog'iston",
  KGZ: "Qirg'iziston",
  TJK: "Tojikiston",
  TKM: "Turkmaniston",
  RUS: "Rossiya",
  TUR: "Turkiya",
  AFG: "Afg'oniston",
  AZE: "Ozarbayjon",
  ARM: "Armaniston",
  GEO: "Gruziya",
  BLR: "Belarus",
  UKR: "Ukraina",
  MDA: "Moldova",
  CHN: "Xitoy",
  KOR: "Janubiy Koreya",
  JPN: "Yaponiya",
  IND: "Hindiston",
  PAK: "Pokiston",
  IRN: "Eron",
  IRQ: "Iroq",
  SAU: "Saudiya Arabistoni",
  ARE: "BAA",
  QAT: "Qatar",
  KWT: "Quvayt",
  USA: "AQSH",
  GBR: "Buyuk Britaniya",
  DEU: "Germaniya",
  FRA: "Fransiya",
  ITA: "Italiya",
  ESP: "Ispaniya",
  POL: "Polsha",
  EGY: "Misr",
  LVA: "Latviya",
  EST: "Estoniya",
  LTU: "Litva",
  CZE: "Chexiya",
  NLD: "Niderlandiya",
  AUT: "Avstriya",
  GRC: "Gretsiya",
  SWE: "Shvetsiya",
  FIN: "Finlyandiya",
  HUN: "Vengriya",
  PRT: "Portugaliya",
  BEL: "Belgiya",
  CHE: "Shveytsariya",
  DNK: "Daniya",
  NOR: "Norvegiya",
};

/** ISO3 -> ISO2 (bayroq emoji uchun). Faqat ro'yxatdagi davlatlar. */
const ISO3_TO_ISO2: Record<string, string> = {
  UZB: "UZ",
  KAZ: "KZ",
  KGZ: "KG",
  TJK: "TJ",
  TKM: "TM",
  RUS: "RU",
  TUR: "TR",
  AFG: "AF",
  IND: "IN",
  PAK: "PK",
  AZE: "AZ",
  ARM: "AM",
  GEO: "GE",
  BLR: "BY",
  UKR: "UA",
  MDA: "MD",
  CHN: "CN",
  KOR: "KR",
  PRK: "KP",
  JPN: "JP",
  USA: "US",
  GBR: "GB",
  DEU: "DE",
  FRA: "FR",
  ITA: "IT",
  ESP: "ES",
  PRT: "PT",
  NLD: "NL",
  BEL: "BE",
  CHE: "CH",
  AUT: "AT",
  SWE: "SE",
  NOR: "NO",
  FIN: "FI",
  DNK: "DK",
  POL: "PL",
  CZE: "CZ",
  SVK: "SK",
  HUN: "HU",
  ROU: "RO",
  BGR: "BG",
  GRC: "GR",
  HRV: "HR",
  SRB: "RS",
  SVN: "SI",
  BIH: "BA",
  MKD: "MK",
  ALB: "AL",
  MNE: "ME",
  EST: "EE",
  LVA: "LV",
  LTU: "LT",
  IRL: "IE",
  ISL: "IS",
  LUX: "LU",
  CYP: "CY",
  MLT: "MT",
  IRN: "IR",
  IRQ: "IQ",
  SAU: "SA",
  ARE: "AE",
  QAT: "QA",
  KWT: "KW",
  BHR: "BH",
  OMN: "OM",
  YEM: "YE",
  JOR: "JO",
  LBN: "LB",
  SYR: "SY",
  ISR: "IL",
  PSE: "PS",
  EGY: "EG",
  LBY: "LY",
  TUN: "TN",
  DZA: "DZ",
  MAR: "MA",
  SDN: "SD",
  ETH: "ET",
  KEN: "KE",
  TZA: "TZ",
  UGA: "UG",
  NGA: "NG",
  GHA: "GH",
  ZAF: "ZA",
  AGO: "AO",
  COD: "CD",
  CMR: "CM",
  CIV: "CI",
  SEN: "SN",
  MLI: "ML",
  NER: "NE",
  TCD: "TD",
  SOM: "SO",
  ZWE: "ZW",
  ZMB: "ZM",
  MOZ: "MZ",
  MWI: "MW",
  RWA: "RW",
  BDI: "BI",
  MDG: "MG",
  AUS: "AU",
  NZL: "NZ",
  CAN: "CA",
  MEX: "MX",
  BRA: "BR",
  ARG: "AR",
  CHL: "CL",
  COL: "CO",
  PER: "PE",
  VEN: "VE",
  ECU: "EC",
  BOL: "BO",
  PRY: "PY",
  URY: "UY",
  CUB: "CU",
  DOM: "DO",
  GTM: "GT",
  HND: "HN",
  CRI: "CR",
  PAN: "PA",
  IDN: "ID",
  MYS: "MY",
  SGP: "SG",
  THA: "TH",
  VNM: "VN",
  PHL: "PH",
  MMR: "MM",
  KHM: "KH",
  LAO: "LA",
  BGD: "BD",
  LKA: "LK",
  NPL: "NP",
  BTN: "BT",
  MNG: "MN",
  MDV: "MV",
  BRN: "BN",
  HKG: "HK",
  TWN: "TW",
};

/** Davlat kodidan bayroq emoji (ISO2 -> regional indicator harflar). */
export function countryFlag(code: string): string {
  const iso2 = ISO3_TO_ISO2[(code || "").toUpperCase()];
  if (!iso2) return "🏳️";
  return iso2
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

/** Davlat ISO2 kodi (bayroq rasmi uchun). Topilmasa "" qaytadi. */
export function countryIso2(code: string): string {
  return ISO3_TO_ISO2[(code || "").toUpperCase()] ?? "";
}

/** Davlat bayrog'ining rasm manzili (Windowsda emoji ko'rinmaydi). */
export function countryFlagUrl(code: string): string {
  const iso2 = countryIso2(code).toLowerCase();
  return iso2 ? `https://flagcdn.com/${iso2}.svg` : "";
}

// Asosiy davlatlar tepada, qolganlari alifbo bo'yicha — Select ro'yxati uchun.
const PRIORITY = [
  "UZB",
  "KAZ",
  "KGZ",
  "TJK",
  "TKM",
  "RUS",
  "TUR",
  "AFG",
  "IND",
  "PAK",
];

export type CountryOption = {
  value: string;
  label: string;
  iso2: string;
};

function toOption(code: string): CountryOption {
  const name = COUNTRY_NAMES[code] ?? code;
  return {
    value: code,
    label: `${name} (${code})`,
    iso2: countryIso2(code).toLowerCase(),
  };
}

export const COUNTRIES: CountryOption[] = [
  ...PRIORITY.map(toOption),
  ...Object.keys(COUNTRY_NAMES)
    .filter((c) => !PRIORITY.includes(c))
    .sort((a, b) => COUNTRY_NAMES[a].localeCompare(COUNTRY_NAMES[b], "uz"))
    .map(toOption),
];

// Yo'nalish (slot) uchun: qayerdan (Markaziy Osiyo) — qayerga (EU/Shengen).
const ORIGIN_PRIORITY = ["UZB", "KAZ", "KGZ", "TJK", "TKM"];
const DEST_PRIORITY = [
  "LVA",
  "LTU",
  "EST",
  "POL",
  "DEU",
  "FRA",
  "ITA",
  "ESP",
  "CZE",
  "NLD",
  "AUT",
  "GRC",
  "SWE",
  "FIN",
  "HUN",
  "PRT",
  "BEL",
  "CHE",
  "DNK",
  "NOR",
];

/** Slot yo'nalishi uchun "qayerdan" davlatlari (Markaziy Osiyo tepada). */
export const ORIGIN_COUNTRIES: CountryOption[] = [
  ...ORIGIN_PRIORITY.map(toOption),
  ...COUNTRIES.filter((c) => !ORIGIN_PRIORITY.includes(c.value)),
];

/** Slot yo'nalishi uchun "qayerga" davlatlari (EU/Shengen tepada). */
export const DEST_COUNTRIES: CountryOption[] = [
  ...DEST_PRIORITY.map(toOption),
  ...COUNTRIES.filter((c) => !DEST_PRIORITY.includes(c.value)),
];

/** Davlatning o'qiladigan nomi (ISO3 koddan). */
export function countryName(code: string): string {
  return COUNTRY_NAMES[(code || "").toUpperCase()] ?? code;
}

// MRZ ba'zan maxsus yoki OCR xato kodlar beradi — eng yaqin ISO3 ga keltiramiz.
const ALIASES: Record<string, string> = {
  // MRZ maxsus kodlari
  D: "DEU", // Germaniya eski kod
  GBD: "GBR",
  GBN: "GBR",
  GBO: "GBR",
  GBP: "GBR",
  GBS: "GBR",
  // OCR ko'p adashtiradigan variantlar
  UZ: "UZB",
  RU: "RUS",
  KZ: "KAZ",
};

// OCR raqamlarni harfga adashtiradi (UZB -> U2B). Millat kodi faqat harf
// bo'lgani uchun raqamlarni eng yaqin harfga qaytaramiz.
const DIGIT_TO_LETTER: Record<string, string> = {
  "0": "O",
  "1": "I",
  "2": "Z",
  "5": "S",
  "6": "G",
  "8": "B",
};

// Excel ko'pincha davlatni to'liq nom bilan beradi ("UZBEKISTAN").
// Bunday to'liq nomlarni ISO3 kodga keltiramiz (faqat harflar, katta harf).
const NAME_TO_CODE: Record<string, string> = {
  UZBEKISTAN: "UZB",
  OZBEKISTON: "UZB",
  KAZAKHSTAN: "KAZ",
  QOZOGISTON: "KAZ",
  KYRGYZSTAN: "KGZ",
  QIRGIZISTON: "KGZ",
  TAJIKISTAN: "TJK",
  TOJIKISTON: "TJK",
  TURKMENISTAN: "TKM",
  TURKMANISTON: "TKM",
  RUSSIA: "RUS",
  RUSSIANFEDERATION: "RUS",
  ROSSIYA: "RUS",
  TURKEY: "TUR",
  TURKIYE: "TUR",
  TURKIYA: "TUR",
  AFGHANISTAN: "AFG",
  AFGONISTON: "AFG",
  AZERBAIJAN: "AZE",
  OZARBAYJON: "AZE",
  ARMENIA: "ARM",
  ARMANISTON: "ARM",
  GEORGIA: "GEO",
  GRUZIYA: "GEO",
  BELARUS: "BLR",
  UKRAINE: "UKR",
  UKRAINA: "UKR",
  MOLDOVA: "MDA",
  CHINA: "CHN",
  XITOY: "CHN",
  SOUTHKOREA: "KOR",
  KOREAREPUBLICOF: "KOR",
  REPUBLICOFKOREA: "KOR",
  JAPAN: "JPN",
  YAPONIYA: "JPN",
  INDIA: "IND",
  HINDISTON: "IND",
  PAKISTAN: "PAK",
  POKISTON: "PAK",
  IRAN: "IRN",
  ERON: "IRN",
  IRAQ: "IRQ",
  IROQ: "IRQ",
  SAUDIARABIA: "SAU",
  UNITEDARABEMIRATES: "ARE",
  UAE: "ARE",
  QATAR: "QAT",
  KUWAIT: "KWT",
  QUVAYT: "KWT",
  UNITEDSTATES: "USA",
  UNITEDSTATESOFAMERICA: "USA",
  AMERICA: "USA",
  AQSH: "USA",
  UNITEDKINGDOM: "GBR",
  GREATBRITAIN: "GBR",
  ENGLAND: "GBR",
  GERMANY: "DEU",
  GERMANIYA: "DEU",
  FRANCE: "FRA",
  FRANSIYA: "FRA",
  ITALY: "ITA",
  ITALIYA: "ITA",
  SPAIN: "ESP",
  ISPANIYA: "ESP",
  POLAND: "POL",
  POLSHA: "POL",
  EGYPT: "EGY",
  MISR: "EGY",
};

/**
 * MRZ dan kelgan millat kodini formaga mos ISO3 ga keltiradi.
 * Topilmasa — kelgan qiymatni (katta harf bilan) qaytaradi.
 */
export function normalizeNationality(raw: string): string {
  const upper = (raw || "").toUpperCase().trim();
  if (!upper) return "";

  // Raqamlarni harfga almashtiramiz (U2B -> UZB), keyin faqat harflarni olamiz.
  const lettered = upper
    .split("")
    .map((ch) => DIGIT_TO_LETTER[ch] ?? ch)
    .join("");
  const code = lettered.replace(/[^A-Z]/g, "");
  if (!code) return "";

  if (COUNTRY_NAMES[code]) return code;
  if (ALIASES[code]) return ALIASES[code];

  // To'liq nom bilan kelgan bo'lsa ("UZBEKISTAN") — kodga keltiramiz.
  const nameKey = upper.replace(/[^A-Z]/g, "");
  if (NAME_TO_CODE[nameKey]) return NAME_TO_CODE[nameKey];

  // Raqamlarni almashtirmasdan ham sinaymiz (ehtiyot uchun)
  const plain = upper.replace(/[^A-Z]/g, "");
  if (COUNTRY_NAMES[plain]) return plain;
  if (ALIASES[plain]) return ALIASES[plain];

  // OCR bitta harfni tushirib qolsa (UZB -> UB) yoki adashtirsa, eng yaqin
  // davlat kodini topamiz. Avval asosiy davlatlar ichidan subsequence (harflar
  // tartibi saqlangan) moslik, keyin 1 ta harf farqi (tahrir masofasi) bo'yicha.
  const candidates = [...PRIORITY, ...Object.keys(COUNTRY_NAMES)];
  const seen = new Set<string>();
  const uniq = candidates.filter((c) => (seen.has(c) ? false : seen.add(c)));

  if (code.length >= 2) {
    const sub = uniq.find((c) => isSubsequence(code, c));
    if (sub) return sub;
  }
  if (code.length === 3) {
    const near = uniq.find((c) => oneCharDiff(code, c));
    if (near) return near;
  }

  return code;
}

// `a` harflari `b` ichida tartib saqlab kelsa true (UB -> UZB).
function isSubsequence(a: string, b: string): boolean {
  let i = 0;
  for (let j = 0; j < b.length && i < a.length; j++) {
    if (a[i] === b[j]) i++;
  }
  return i === a.length;
}

// Bir xil uzunlikdagi ikki kod faqat 1 ta pozitsiyada farq qilsa true.
function oneCharDiff(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) diff++;
    if (diff > 1) return false;
  }
  return diff === 1;
}

/** Davlat kodidan to'liq nom (Select tashqarisida ko'rsatish uchun). */
export function countryLabel(code: string): string {
  const c = (code || "").toUpperCase();
  if (!c) return "—";
  return COUNTRY_NAMES[c] ? `${COUNTRY_NAMES[c]} (${c})` : c;
}
