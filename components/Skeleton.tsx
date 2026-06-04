// Qayta ishlatiluvchi skeleton bloklari — sahifa o'tishida darhol ko'rinadi.

export function SkelBox({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-slate-200/70 dark:bg-slate-700/50 ${className}`}
    />
  );
}

export function PageHeaderSkel() {
  return (
    <div className="space-y-2">
      <SkelBox className="h-7 w-48" />
      <SkelBox className="h-4 w-72" />
    </div>
  );
}

export function StatCardsSkel({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card flex items-center gap-3 p-4">
          <SkelBox className="h-11 w-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkelBox className="h-3 w-20" />
            <SkelBox className="h-5 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ControlsSkel() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SkelBox className="h-10 flex-1 min-w-[200px]" />
      <SkelBox className="h-10 w-32" />
    </div>
  );
}

export function TableSkel({
  rows = 8,
  cols = 6,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="table-wrap">
      <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
        <div className="flex gap-4">
          {Array.from({ length: cols }).map((_, i) => (
            <SkelBox key={i} className="h-3 flex-1" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: cols }).map((_, c) => (
              <SkelBox key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GallerySkel({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-slate-100 dark:bg-slate-900/60 dark:ring-slate-800"
        >
          <SkelBox className="aspect-[3/4] w-full rounded-none" />
          <div className="space-y-2 p-3">
            <div className="flex items-center gap-2">
              <SkelBox className="h-7 w-7 rounded-full" />
              <SkelBox className="h-4 flex-1" />
            </div>
            <SkelBox className="h-3 w-2/3" />
            <SkelBox className="h-5 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}
