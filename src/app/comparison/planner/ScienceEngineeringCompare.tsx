
import { PanelTitle } from "./Section";
import {
  PRIORITY_WEIGHTS,
  AUTONOMY_LIMIT_H,
  fmtHours,
  rankCmp,
  scoreBreakdown,
  type AgreementPrice,
  type CellMetrics,
  type Priority,
  type SiteData,
  type Stance,
  type TeamRow,
} from "../../../lib/compareModel";

interface Props {
  rows: TeamRow[];
  sites: SiteData[];
  metrics: Record<string, CellMetrics>;
  scores: Record<string, number>;
  agreement: number;
  price: AgreementPrice;
  priority: Priority;
  overallTop: string;
  sciW: number;
  engW: number;
  onSci: (v: number) => void;
  onEng: (v: number) => void;
  dateLabel: string;
  duration: number;
}

const TAG: Record<Stance, { text: string; cls: string }> = {
  consensus: {
    text: "Consensus",
    cls: "border-[#A7A5FF]/50 bg-[#A7A5FF]/[0.08] text-[#A7A5FF]",
  },
  conflict: {
    text: "Conflict",
    cls: "border-white/30 bg-white/[0.05] text-white/80",
  },
  neutral: {
    text: "—",
    cls: "border-transparent text-[#7F93B3]",
  },
};

type Ctx = {
  m: CellMetrics;
  score: number;
  row: TeamRow;
};

type Col = {
  label: string;
  get: (c: Ctx) => number;
  fmt: (v: number) => string;
  sub?: (c: Ctx) => string;
  lowerBetter?: boolean;
};

const pct = (v: number) => `${v.toFixed(0)}%`;

const COLS: Col[] = [
  {
    label: "Overall Score",
    get: (c) => c.score,
    fmt: (v) => v.toFixed(0),
  },
  {
    label: "Power Availability",
    get: (c) => c.m.powerAvail,
    fmt: pct,
  },
  {
    label: "Comm Availability",
    get: (c) => c.m.commAvail,
    fmt: pct,
  },
  {
    label: "Power + Comm Overlap",
    get: (c) => c.m.overlap,
    fmt: pct,
  },
  {
    label: "Mission Continuity",
    get: (c) => c.m.continuity,
    fmt: pct,
  }
];

function Slider({
  id,
  label,
  left,
  right,
  value,
  onChange,
}: {
  id: string;
  label: string;
  left: string;
  right: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-[11px] text-[#7F93B3]"
      >
        {label}: {value}
      </label>

      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-[#a7a5ff]"
      />

      <div className="mt-1 flex justify-between text-[10px] text-[#7F93B3]">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

export default function ScienceEngineeringCompare({
  rows,
  sites,
  metrics,
  scores,
  agreement,
  price,
  priority,
  overallTop,
  sciW,
  engW,
  onSci,
  onEng,
  dateLabel,
  duration,
}: Props) {
  const key = (r: TeamRow) => ({
    score: scores[r.id],
    risk: metrics[r.id].risk,
    name: r.name,
  });

  const ordered = sites
    .map((s) => rows.find((r) => r.id === s.id)!)
    .filter(Boolean)
    .sort((a, b) => rankCmp(key(a), key(b)));

  const ctx = (r: TeamRow): Ctx => ({
    m: metrics[r.id],
    score: scores[r.id],
    row: r,
  });

  const best = COLS.map((c) => {
    const vals = ordered.map((r) => c.get(ctx(r)));
    return c.lowerBetter ? Math.min(...vals) : Math.max(...vals);
  });

  const [wp, wc, wr] = PRIORITY_WEIGHTS[priority];
  const samePick = price.site === overallTop;

  return (
    <section>
      <PanelTitle
        right={
          <span className="text-[10px] font-normal normal-case tracking-normal text-[#7F93B3]">
            Agreement {agreement.toFixed(0)}% (top-3 overlap) ·{" "}
            {dateLabel} · {duration}-day mission
          </span>
        }
      >
        Science — Engineering · All sites compare
      </PanelTitle>

      {/* Preference sliders */}
      <div className="mb-5 grid gap-6 sm:grid-cols-2">
        <Slider
          id="sci"
          label="Science preference"
          left="Power"
          right="Terrain relief"
          value={sciW}
          onChange={onSci}
        />

        <Slider
          id="eng"
          label="Engineering preference"
          left="Comms"
          right="Safety"
          value={engW}
          onChange={onEng}
        />
      </div>

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1050px] border-collapse text-left text-xs">
          <thead className="text-[11px] text-[#7F93B3]">
            <tr>
              <th className="whitespace-nowrap py-3 pr-3 font-medium">
                Rank &amp; Site Name
              </th>

              {COLS.map((c) => (
                <th
                  key={c.label}
                  className="whitespace-nowrap px-3 py-3 font-medium"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {ordered.map((r, idx) => {
              const tag = TAG[r.stance];

              return (
                <tr
                  key={r.id}
                  className="border-t border-slate-800/50 transition-colors hover:bg-white/[0.03]"
                >
                  <td className="whitespace-nowrap py-3 pr-3">
                    <span className="inline-flex items-center gap-3">
                      <span className="w-7 text-xs font-semibold tabular-nums text-[#a7a5ff]">
                        #{idx + 1}
                      </span>

                      <span className="text-xs font-semibold text-[#F1F6FF]">
                        {r.name}
                      </span>

                      {r.stance !== "neutral" && (
                        <span
                          className={`whitespace-nowrap rounded border px-2 py-1 text-[10px] font-semibold ${tag.cls}`}
                        >
                          {tag.text} · S#{r.scienceRank} / E#
                          {r.engineeringRank}
                        </span>
                      )}
                    </span>
                  </td>

                  {COLS.map((c, i) => {
                    const cx = ctx(r);
                    const v = c.get(cx);

                    return (
                      <td
                        key={c.label}
                        title={
                          c.label === "Overall Score"
                            ? scoreBreakdown(cx.m, priority)
                            : undefined
                        }
                        className={`whitespace-nowrap px-3 py-3 text-xs tabular-nums ${
                          v === best[i]
                            ? "font-semibold text-[#a7a5ff]"
                            : "text-[#C9D6EA]"
                        }`}
                      >
                        {c.fmt(v)}

                        {c.sub && (
                          <span className="ml-1.5 text-[10px] font-normal text-[#7F93B3]">
                            {c.sub(cx)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Price of agreement */}
      <p className="mt-4 text-xs leading-relaxed text-[#C9D6EA]">
        <span className="font-semibold text-[#F1F6FF]">
          Price of agreement:
        </span>{" "}

        {price.basis === "consensus" ? (
          <>the compromise is {price.site}</>
        ) : (
          <span className="text-[#AFC4FF]">
            no site is in both teams&rsquo; top 3 — the closest
            compromise is {price.site}
          </span>
        )}

        {" "}(smallest worst-case loss). Versus Science&rsquo;s own
        #1 ({price.scienceBest}) it costs Science{" "}
        {price.scienceLoss.toFixed(1)} pts; versus Engineering&rsquo;s
        own #1 ({price.engineeringBest}) it costs Engineering{" "}
        {price.engineeringLoss.toFixed(1)} pts.

        {!samePick && (
          <>
            {" "}The Overall-Score #1 is {overallTop}, which is a
            different ranking from the two team scores.
          </>
        )}
      </p>

      {/* Methodology */}
      <p className="mt-2 text-[10px] leading-relaxed text-[#7F93B3]">
        Overall = {wp} × Power Availability + {wc} × Comm Availability
        + {wr} × (100 − Risk) for the selected priority; hover a score
        for the breakdown. Mission Continuity = % powered with Earth
        contact within {AUTONOMY_LIMIT_H} h. Science = relief weight
        × normalised 5 km terrain relief (min–max across these sites)
        + rest × Power Availability. Engineering = safety weight ×
        (100 − Risk) + rest × Comm Availability. Consensus = site in
        both teams&rsquo; top 3, Conflict = in one team&rsquo;s top 3
        only (S# / E# = Science / Engineering rank). Violet = best in
        column. Rows are listed in Overall-Score order (ties: lower
        risk first).
      </p>
    </section>
  );
}
