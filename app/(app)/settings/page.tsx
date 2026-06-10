import SettingsManager from "@/components/SettingsManager";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  // Sozlamalar "qulf" ortida — SettingsManager super login/parol bilan ochilgach
  // ma'lumotlarni o'zi server'dan oladi. Sahifa HTML'ida hech narsa ko'rinmaydi.
  // To'liq enli ko'rinish uchun max-width yo'q — kartalar ustunlarga taqsimlanadi.
  return <SettingsManager />;
}
