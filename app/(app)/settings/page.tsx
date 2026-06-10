import SettingsManager from "@/components/SettingsManager";
import { getAppSettings, maskSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const s = await getAppSettings();
  return (
    <div className="mx-auto max-w-4xl">
      <SettingsManager initial={maskSettings(s)} />
    </div>
  );
}
