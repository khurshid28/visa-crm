"use client";

type Slice = { label: string; value: number; color: string };

// ----------------------------- Donut chart ----------------------------------

export function StatusDonut({ data }: { data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const size = 200;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const gap = total > 1 ? 0.012 * circ : 0; // segmentlar orasidagi nozik bo'shliq

  let offset = 0;
  const segments =
    total > 0
      ? data
          .filter((d) => d.value > 0)
          .map((d) => {
            const frac = d.value / total;
            const len = Math.max(frac * circ - gap, 0.5);
            const seg = {
              ...d,
              dash: len,
              gap: circ - len,
              offset,
            };
            offset -= frac * circ;
            return seg;
          })
      : [];

  const sorted = [...data].sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90 drop-shadow-sm">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            className="stroke-slate-100 dark:stroke-slate-800"
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
              style={{
                transition: "stroke-dasharray .7s cubic-bezier(.4,0,.2,1)",
              }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {total}
          </span>
          <span className="text-xs font-medium text-slate-400">arizachi</span>
        </div>
      </div>

      <ul className="flex-1 space-y-1">
        {sorted.map((d) => {
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
          return (
            <li
              key={d.label}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white dark:ring-slate-900"
                style={{
                  background: d.color,
                  boxShadow: `0 0 0 1px ${d.color}33`,
                }}
              />
              <span className="flex-1 truncate text-slate-600 dark:text-slate-300">
                {d.label}
              </span>
              <span className="tabular-nums text-xs font-medium text-slate-400">
                {pct}%
              </span>
              <span className="w-8 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">
                {d.value}
              </span>
            </li>
          );
        })}
        {total === 0 && (
          <li className="px-2 py-1.5 text-sm text-slate-400">
            Hali ma&apos;lumot yo&apos;q
          </li>
        )}
      </ul>
    </div>
  );
}

type Bar = { label: string; value: number };

const BAR_COLORS = [
  ["#6366f1", "#818cf8"],
  ["#0ea5e9", "#38bdf8"],
  ["#10b981", "#34d399"],
  ["#f59e0b", "#fbbf24"],
  ["#8b5cf6", "#a78bfa"],
  ["#ec4899", "#f472b6"],
];

export function GroupBars({ data }: { data: Bar[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const sorted = [...data].sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-3.5">
      {sorted.map((d, i) => {
        const [from, to] = BAR_COLORS[i % BAR_COLORS.length];
        const pct = (d.value / max) * 100;
        return (
          <div key={d.label} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-sm text-slate-600 dark:text-slate-300">
              {d.label}
            </span>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${from}, ${to})`,
                  transition: "width .7s cubic-bezier(.4,0,.2,1)",
                }}
              />
            </div>
            <span className="w-8 text-right tabular-nums text-sm font-semibold text-slate-700 dark:text-slate-200">
              {d.value}
            </span>
          </div>
        );
      })}
      {data.length === 0 && (
        <p className="text-sm text-slate-400">Hali guruh yo&apos;q</p>
      )}
    </div>
  );
}

// ----------------------------- Line / area chart -----------------------------

export type LineSeries = {
  label: string;
  color: string;
  points: number[];
};

// Catmull-Rom -> bezier silliq egri chiziq.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function niceCeil(v: number): number {
  if (v <= 5) return 5;
  if (v <= 10) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function LineChart({
  series,
  labels,
  height = 220,
  unit = "",
}: {
  series: LineSeries[];
  labels: string[];
  height?: number;
  unit?: string;
}) {
  const width = 560;
  const padX = 34;
  const padTop = 18;
  const padBottom = 26;
  const n = labels.length;
  const allVals = series.flatMap((s) => s.points);
  const rawMax = Math.max(1, ...allVals);
  const niceMax = niceCeil(rawMax);
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;

  const x = (i: number) =>
    padX + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padTop + innerH - (v / niceMax) * innerH;

  const gridY = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = Math.ceil(n / 7) || 1;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {series.map((s, si) => (
            <linearGradient
              key={si}
              id={`area-${si}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {/* Grid + Y o'qi belgilari */}
        {gridY.map((g, i) => {
          const gy = padTop + innerH - g * innerH;
          return (
            <g key={i}>
              <line
                x1={padX}
                x2={width - padX}
                y1={gy}
                y2={gy}
                className="stroke-slate-100 dark:stroke-slate-800"
                strokeWidth={1}
                strokeDasharray={g === 0 ? "0" : "3 4"}
              />
              <text
                x={padX - 8}
                y={gy + 3}
                textAnchor="end"
                className="fill-slate-300 dark:fill-slate-600"
                fontSize={9}
              >
                {Math.round(niceMax * g)}
              </text>
            </g>
          );
        })}

        {series.map((s, si) => {
          const pts = s.points.map((v, i) => ({ x: x(i), y: y(v) }));
          const line = smoothPath(pts);
          const area =
            line +
            ` L ${pts[pts.length - 1].x} ${padTop + innerH}` +
            ` L ${pts[0].x} ${padTop + innerH} Z`;
          return (
            <g key={si}>
              <path d={area} fill={`url(#area-${si})`} />
              <path
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {pts.map((p, i) => (
                <g key={i}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={4}
                    fill="white"
                    stroke={s.color}
                    strokeWidth={2}
                    className="dark:fill-slate-900"
                  />
                  {s.points[i] > 0 && (
                    <text
                      x={p.x}
                      y={p.y - 10}
                      textAnchor="middle"
                      className="fill-slate-400 dark:fill-slate-500"
                      fontSize={9}
                      fontWeight={600}
                    >
                      {s.points[i]}
                    </text>
                  )}
                </g>
              ))}
            </g>
          );
        })}

        {/* X o'qi belgilari */}
        {labels.map((l, i) =>
          i % labelStep === 0 ? (
            <text
              key={i}
              x={x(i)}
              y={height - 8}
              textAnchor="middle"
              className="fill-slate-400 dark:fill-slate-500"
              fontSize={9}
            >
              {l}
            </text>
          ) : null,
        )}
      </svg>

      {series.length > 1 || unit ? (
        <div className="mt-2 flex flex-wrap items-center gap-4">
          {series.map((s) => (
            <span
              key={s.label}
              className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
              {unit ? ` (${unit})` : ""}
            </span>
          ))}
        </div>
      ) : null}
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
