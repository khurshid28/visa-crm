// O'zbekcha sana formatlash (toLocaleString("uz") "M06" kabi buzilgan
// natija beradi, shuning uchun qo'lda formatlaymiz).

const UZ_MONTHS = [
  "yan",
  "fev",
  "mar",
  "apr",
  "may",
  "iyn",
  "iyl",
  "avg",
  "sen",
  "okt",
  "noy",
  "dek",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// "02 iyn 2026"
export function fmtDate(value?: string | number | Date | null): string {
  if (value == null) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return `${pad2(d.getDate())} ${UZ_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// "02 iyn 2026, 14:30"
export function fmtDateTime(value?: string | number | Date | null): string {
  if (value == null) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";
  return `${pad2(d.getDate())} ${UZ_MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
