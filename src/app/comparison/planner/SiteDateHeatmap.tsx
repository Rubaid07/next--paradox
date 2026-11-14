import { PanelTitle, Chip } from "./Section";
import {
  GRID_COLS,
  GRID_STEP_DAYS,
  fmtDay,
  gridDay,
  heatColor,
  metricValue,
  type CellMetrics,
  type HeatMetric,
  type Priority,
  type SiteData,
} from "../../../lib/compareModel";

interface Props {
  sites: SiteData[];
  grid: CellMetrics[][]; // [site][col]
  metric: HeatMetric;
  onMetric: (m: HeatMetric) => void;
  priority: Priority;
  selectedId: string;
  gridStart: number;
  plannedDay: number;
  effectiveDay: number;
  onPick: (siteId: string, day: number) => void;
}

const METRICS: { key: HeatMetric; label: string }[] = [
  { key: "score", label: "Score" },
  { key: "sun", label: "Sun" },
  { key: "power", label: "Power" },
  { key: "comms", label: "Comms" },
  { key: "risk", label: "Risk" },
];

export default function SiteDateHeatmap({ sites, grid, metric, onMetric, priority, selectedId, gridStart, plannedDay, effectiveDay, onPick }: Props) {
  const near = (c: number, day: number) => Math.abs(gridDay(c, gridStart) - day) <= GRID_STEP_DAYS / 2;
  const note = metric === "risk" ? "Lower is better" : "Higher is better";

  return (
    <div className="relative min-h-[420px] overflow-hidden rounded-lg border border-slate-800 p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(167,165,255,0.07),transparent_65%)]" />
      <div className="relative">
        <PanelTitle
          right={<span className="text-[10px] font-normal normal-case tracking-normal text-[#7F93B3]">Click a cell to set site &amp; launch date</span>}
        >
          Site × Date heatmap
        </PanelTitle>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {METRICS.map((m) => (
            <Chip key={m.key} active={metric === m.key} onClick={() => onMetric(m.key)}>
              {m.label}
            </Chip>
          ))}
          <span className="ml-auto text-[10px] text-[#7F93B3]">{note}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-[3px] text-[10px]">
            <thead>
              <tr>
                <th className="w-[130px] min-w-[130px] text-left font-medium text-[#7F93B3]">Site</th>
                {Array.from({ length: GRID_COLS }, (_, c) => (
                  <th
                    key={c}
                    className={`min-w-[42px] font-medium tabular-nums ${near(c, plannedDay) ? "text-[#a7a5ff]" : "text-[#7F93B3]"}`}
                  >
                    {fmtDay(gridDay(c, gridStart))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sites.map((s, r) => (
                <tr key={s.id}>
                  <td
                    className={`truncate pr-2 text-left text-[12px] font-semibold ${
                      s.id === selectedId ? "text-[#E8EAED]" : "text-[#C9CDD4]"
                    }`}
                  >
                    {s.name}
                  </td>
                  {grid[r]?.map((m, c) => {
                    const v = metricValue(m, metric, priority);
                    const t = metric === "risk" ? 1 - v / 100 : v / 100;
                    const isPlanned = near(c, plannedDay) && s.id === selectedId;
                    const isDelayed = effectiveDay !== plannedDay && !near(c, plannedDay) && near(c, effectiveDay);
                    return (
                      <td key={c} className="p-0">
                        <button
                          onClick={() => onPick(s.id, gridDay(c, gridStart))}
                          title={`${s.name} · ${fmtDay(gridDay(c, gridStart))} · ${v.toFixed(0)}`}
                          className={`h-8 w-full rounded-[3px] text-[10px] font-semibold tabular-nums text-white/90 transition hover:brightness-125 ${
                            isPlanned ? "ring-2 ring-white" : ""
                          } ${isDelayed ? "outline outline-1 outline-dashed outline-cyan-300" : ""}`}
                          style={{ backgroundColor: heatColor(t) }}
                        >
                          {v.toFixed(0)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center gap-3 text-[10px] text-[#7F93B3]">
          <span>Poor</span>
          <div className="h-2 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})` }} />
          <span>Good</span>
          <span className="ml-auto">White ring = planned launch · dashed = delayed launch</span>
        </div>
      </div>
    </div>
  );
}