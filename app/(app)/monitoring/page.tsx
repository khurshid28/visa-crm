import MonitoringDashboard from "@/components/MonitoringDashboard";

export const dynamic = "force-dynamic";

export default function MonitoringPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Monitoring</h1>
        <p className="mt-1 text-sm text-slate-500">
          Workerlar, navbat, register/order vaqtlari va har bir user loglari (har
          5 soniyada yangilanadi)
        </p>
      </div>
      <MonitoringDashboard />
    </div>
  );
}
