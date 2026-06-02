"use client";

type Slice = { label: string; value: number; color: string };

export function StatusDonut({ data }: { data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const size = 180;
  const stroke = 26;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;

  let offset = 0;
  const segments =
    total > 0
      ? data
          .filter((d) => d.value > 0)
          .map((d) => {
            const frac = d.value / total;
            const seg = {
              ...d,
              dash: frac * circ,
              gap: circ - frac * circ,
              offset,
            };
            offset -= frac * circ;
            return seg;
          })
      : [];

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-8">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#eef2f7"
            strokeWidth={stroke}
          />
          {segments.map((s, i) => (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${s.dash} ${s.gap}`}
              strokeDashoffset={s.offset}
              style={{ transition: "stroke-dasharray .6s ease" }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-slate-900">{total}</span>
          <span className="text-xs text-slate-400">arizachi</span>
        </div>
      </div>

      <ul className="flex-1 space-y-2">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: d.color }}
            />
            <span className="flex-1 text-slate-600">{d.label}</span>
            <span className="font-semibold text-slate-800">{d.value}</span>
          </li>
        ))}
        {total === 0 && (
          <li className="text-sm text-slate-400">Hali ma&apos;lumot yo&apos;q</li>
        )}
      </ul>
    </div>
  );
}

type Bar = { label: string; value: number };

export function GroupBars({ data }: { data: Bar[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));

  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-sm text-slate-600">
            {d.label}
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600"
              style={{
                width: `${(d.value / max) * 100}%`,
                transition: "width .6s ease",
              }}
            />
          </div>
          <span className="w-8 text-right text-sm font-semibold text-slate-700">
            {d.value}
          </span>
        </div>
      ))}
      {data.length === 0 && (
        <p className="text-sm text-slate-400">Hali guruh yo&apos;q</p>
      )}
    </div>
  );
}
