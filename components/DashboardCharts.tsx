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

// ----------------------------- Line chart -----------------------------------

export type LineSeries = {
  label: string;
  color: string;
  points: number[];
};

export function LineChart({
  series,
  labels,
  height = 200,
  unit = "",
}: {
  series: LineSeries[];
  labels: string[];
  height?: number;
  unit?: string;
}) {
  const width = 560;
  const padX = 36;
  const padY = 18;
  const n = labels.length;
  const allVals = series.flatMap((s) => s.points);
  const max = Math.max(1, ...allVals);
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const x = (i: number) => padX + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v: number) => padY + innerH - (v / max) * innerH;

  const gridY = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {gridY.map((g, i) => (
          <g key={i}>
            <line
              x1={padX}
              x2={width - padX}
              y1={padY + innerH - g * innerH}
              y2={padY + innerH - g * innerH}
              stroke="#eef2f7"
              strokeWidth={1}
            />
            <text
              x={4}
              y={padY + innerH - g * innerH + 4}
              className="fill-slate-300"
              fontSize={9}
            >
              {Math.round(max * g)}
            </text>
          </g>
        ))}

        {series.map((s, si) => {
          const d = s.points
            .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`)
            .join(" ");
          const area =
            `M ${x(0)} ${padY + innerH} ` +
            s.points.map((v, i) => `L ${x(i)} ${y(v)}`).join(" ") +
            ` L ${x(n - 1)} ${padY + innerH} Z`;
          return (
            <g key={si}>
              {si === 0 && (
                <path d={area} fill={s.color} opacity={0.08} />
              )}
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {s.points.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color} />
              ))}
            </g>
          );
        })}

        {labels.map((l, i) =>
          i % Math.ceil(n / 7 || 1) === 0 ? (
            <text
              key={i}
              x={x(i)}
              y={height - 4}
              textAnchor="middle"
              className="fill-slate-400"
              fontSize={9}
            >
              {l}
            </text>
          ) : null,
        )}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-4">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            {s.label}
            {unit ? ` (${unit})` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

// --------------------------- Grouped bar chart -------------------------------

export type GroupedBar = {
  label: string;
  values: { color: string; value: number }[];
};

export function GroupedBars({
  data,
  legend,
}: {
  data: GroupedBar[];
  legend: { label: string; color: string }[];
}) {
  const max = Math.max(
    1,
    ...data.flatMap((d) => d.values.map((v) => v.value)),
  );

  return (
    <div>
      <div className="flex h-48 items-end gap-4">
        {data.map((d) => (
          <div key={d.label} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex h-40 w-full items-end justify-center gap-1.5">
              {d.values.map((v, i) => (
                <div
                  key={i}
                  className="group relative w-full max-w-[26px] rounded-t-md"
                  style={{
                    height: `${(v.value / max) * 100}%`,
                    minHeight: v.value > 0 ? 4 : 0,
                    background: v.color,
                    transition: "height .6s ease",
                  }}
                >
                  <span className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-slate-500 opacity-0 group-hover:opacity-100">
                    {v.value}
                  </span>
                </div>
              ))}
            </div>
            <span className="w-full truncate text-center text-xs text-slate-500">
              {d.label}
            </span>
          </div>
        ))}
        {data.length === 0 && (
          <p className="text-sm text-slate-400">Hali ma&apos;lumot yo&apos;q</p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {legend.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
