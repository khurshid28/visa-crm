import SettingsManager from "@/components/SettingsManager";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  // Sozlamalar "qulf" ortida — SettingsManager super login/parol bilan ochilgach
  // ma'lumotlarni o'zi server'dan oladi. Sahifa HTML'ida hech narsa ko'rinmaydi.
  return (
    <div className="mx-auto max-w-4xl">
      <SettingsManager />
    </div>
  );
}
