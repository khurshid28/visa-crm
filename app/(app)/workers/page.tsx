import WorkersPanel from "@/components/WorkersPanel";

export const dynamic = "force-dynamic";

export default function WorkersPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Workerlar
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Worker pool boshqaruvi (register / login / slot / booking). Har bir
          worker = 1 ta haqiqiy Chrome, shuning uchun soni CPU yadrolariga
          bog'liq. Server resurslari va proksi hisobi «Server» bo'limida.
        </p>
      </div>

      <WorkersPanel />
    </div>
  );
}
