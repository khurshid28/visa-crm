import CpuMonitorCard from "@/components/CpuMonitorCard";
import ProxyUsagePanel from "@/components/ProxyUsagePanel";

export const dynamic = "force-dynamic";

export default function ServerPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Server
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Server holati: jonli CPU / RAM yuklamasi va proksi (IPRoyal) trafik
          hisobi. Bu yerda serverga tegishli barcha ko'rsatkichlar to'plangan.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1 rounded-full bg-brand-500" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
            Server
          </h2>
        </div>
        <CpuMonitorCard />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1 rounded-full bg-brand-500" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
            Proksi
          </h2>
        </div>
        <ProxyUsagePanel />
      </section>
    </div>
  );
}
