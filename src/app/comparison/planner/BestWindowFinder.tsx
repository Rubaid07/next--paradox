
import Link from "next/link";
import { FileText } from "lucide-react";
import { PanelTitle } from "./Section";
import {
  fmtDay,
  fmtDelta,
  fmtRange,
  type WindowHit,
} from "../../../lib/compareModel";

interface Props {
  siteName: string;
  duration: number;
  windows: WindowHit[];
  plannedDay: number;
  plannedScore: number;
  sameDateAlt: { name: string; score: number }[];
  regionAlt: { name: string; day: number; score: number }[];
  onPickDay: (day: number) => void;
}

function Row({
  left,
  right,
  hint,
}: {
  left: string;
  right: string;
  hint?: string;
}) {
  return (
    <li className="flex items-start justify-between gap-4">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-5 text-[#F1F6FF]">
          {left}
        </span>

        {hint && (
          <span className="mt-1 block text-[10px] leading-4 text-[#7F93B3]">
            {hint}
          </span>
        )}
      </span>

      <span className="shrink-0 pt-0.5 text-[12px] font-semibold tabular-nums text-[#A7A5FF]">
        {right}
      </span>
    </li>
  );
}

export default function BestWindowFinder({
  siteName,
  duration,
  windows,
  plannedDay,
  plannedScore,
  sameDateAlt,
  regionAlt,
  onPickDay,
}: Props) {
  const best = windows[0];

  if (!best) return null;

  const gain = Math.round(best.score) - Math.round(plannedScore);

  return (
    <section>
      <PanelTitle>Best window finder</PanelTitle>

      {/* Best launch window */}
      <div className="border-b border-[#1B2A44] pb-5">
        <p className="text-[11px] leading-5 text-[#7F93B3]">
          Best launch for {siteName}
        </p>

        <button
          onClick={() => onPickDay(best.day)}
          className="group mt-1.5 block text-left"
        >
          <span className="block text-[16px] font-semibold leading-6 text-[#F1F6FF] transition-colors group-hover:text-[#C7C3FF]">
            {fmtRange(best.day, duration)}
          </span>

          <span className="mt-1 block text-[11px] leading-5 text-[#A7A5FF]">
            Score {best.score.toFixed(0)} / 100 · {duration}-day mission
          </span>
        </button>

        <p className="mt-3 text-[11px] leading-[1.7] text-[#7F93B3]">
          {gain >= 1
            ? `Launching on ${fmtDay(plannedDay)} instead scores ${gain} pts lower.`
            : `Your planned date (${fmtDay(plannedDay)}) is already at or near the best window.`}
        </p>
      </div>

      {/* Other sites */}
      <div className="mt-5">
        <h3 className="mb-4 border-b border-[#1B2A44] pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9DB4D6]">
          Other sites · {fmtDay(plannedDay)}
        </h3>

        <ul className="space-y-5">
          {sameDateAlt.map((s) => (
            <Row
              key={s.name}
              left={s.name}
              right={s.score.toFixed(0)}
              hint={`${fmtDelta(s.score, plannedScore)} vs selected`}
            />
          ))}
        </ul>
      </div>

      {/* Same region */}
      {regionAlt.length > 0 && (
        <div className="mt-7">
          <h3 className="mb-4 border-b border-[#1B2A44] pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9DB4D6]">
            Same region · best date
          </h3>

          <ul className="space-y-5">
            {regionAlt.map((s) => (
              <Row
                key={s.name}
                left={s.name}
                right={s.score.toFixed(0)}
                hint={fmtRange(s.day, duration)}
              />
            ))}
          </ul>
        </div>
      )}
      {/* View Final Report */}
      <div className="mt-7 pt-4 border-t border-[#1B2A44]">
        <Link
          href={`/report`}
          className="flex items-center justify-center gap-2 rounded border border-[#A7A5FF]/40 bg-[#A7A5FF]/10 py-2.5 px-3 text-xs font-semibold text-[#F1F6FF] transition hover:bg-[#A7A5FF]/20 hover:border-[#A7A5FF]"
        >
          <FileText size={14} className="text-[#A7A5FF]" />
          <span>View Mission Report</span>
        </Link>
      </div>
    </section>
  );
}
