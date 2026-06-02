// Jins va davlat (millat) ro'yxatlari — formani tanlash uchun.
// Qiymatlar MRZ chiqishi bilan mos: jins MALE/FEMALE, davlat ISO3 kodi.

export const GENDERS: { value: string; label: string }[] = [
  { value: "MALE", label: "Erkak" },
  { value: "FEMALE", label: "Ayol" },
];

// Eng ko'p uchraydigan ~10 davlat. Default — UZB.
export const COUNTRIES: { value: string; label: string }[] = [
  { value: "UZB", label: "O'zbekiston (UZB)" },
  { value: "KAZ", label: "Qozog'iston (KAZ)" },
  { value: "KGZ", label: "Qirg'iziston (KGZ)" },
  { value: "TJK", label: "Tojikiston (TJK)" },
  { value: "TKM", label: "Turkmaniston (TKM)" },
  { value: "RUS", label: "Rossiya (RUS)" },
  { value: "TUR", label: "Turkiya (TUR)" },
  { value: "AFG", label: "Afg'oniston (AFG)" },
  { value: "IND", label: "Hindiston (IND)" },
  { value: "PAK", label: "Pokiston (PAK)" },
];

export const DEFAULT_COUNTRY = "UZB";
