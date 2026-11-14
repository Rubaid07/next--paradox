import { Chip, SmallLabel } from "./Section";
import { PRIORITY_LABEL, type Priority } from "../../../lib/compareModel";
import { MISSION_DURATIONS } from "../../../lib/selection";

interface Props {
  priority: Priority;
  onPriority: (p: Priority) => void;
  duration: number;
  onDuration: (d: number) => void;
  ranking: { id: string; name: string; score: number }[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function MissionPriority({ priority, onPriority, duration, onDuration, ranking, selectedId, onSelect }: Props) {
  return (
    <section>
      <SmallLabel>Mission priority</SmallLabel>
      <div className="mb-5 flex flex-wrap gap-2">
        {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
          <Chip key={p} active={priority === p} onClick={() => onPriority(p)}>
            {PRIORITY_LABEL[p]}
          </Chip>
        ))}
      </div>

      <SmallLabel>Mission duration</SmallLabel>
      <div className="mb-6 flex gap-2">
        {MISSION_DURATIONS.map((d) => (
          <Chip key={d} active={duration === d} onClick={() => onDuration(d)}>
            {d} days
          </Chip>
        ))}
      </div>

      <SmallLabel>Site ranking</SmallLabel>

<ul className="space-y-2">
  {ranking.map((r, i) => {
    const selected = r.id === selectedId;

    return (
      <li key={r.id}>
        <button
          onClick={() => onSelect(r.id)}
          aria-pressed={selected}
          className={`group flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-all duration-200 ${
            selected
              ? "bg-[#16212e] ring-[#a7a5ff]/40"
              : "bg-transparent hover:bg-[#151B24]"
          }`}
        >
          {/* Ranking number */}
          <span className="mt-0.5 w-3 text-[10px] tabular-nums text-[#5C636D]">
            {i + 1}
          </span>

          {/* Radio indicator */}
          <span
            className={`mt-1 h-[10px] w-[10px] shrink-0 rounded-full border transition-all duration-200 ${
              selected
                ? "border-[#a7a5ff] bg-[#a7a5ff]"
                : "border-[#a7a5ff] bg-transparent"
            }`}
          />

          {/* Site name */}
          <span
            className={`min-w-0 flex-1 truncate text-[13px] font-semibold transition-colors ${
              selected
                ? "text-white"
                : "text-[#C9CDD4] group-hover:text-white"
            }`}
          >
            {r.name}
          </span>

          {/* Score */}
          <span
            className={`mt-0.5 text-[11px] font-semibold tabular-nums ${
              selected ? "text-[#a7a5ff]" : "text-[#8A9099]"
            }`}
          >
            {r.score.toFixed(0)}
          </span>
        </button>
      </li>
    );
  })}
</ul>
    </section>
  );
}