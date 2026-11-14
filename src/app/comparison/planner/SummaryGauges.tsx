const R = 42;
const C = 2 * Math.PI * R;
const ARC = C * 0.75;

function Gauge({ label, value, unit, percent }: { label: string; value: string; unit: string; percent: number }) {
  const p = Math.max(0, Math.min(1, percent));
  return (
    <div className="flex flex-col items-center px-3 pt-3">
      <p className="mb-1 text-[10px] uppercase tracking-[0.18em]">{label}</p>
      <div className="relative w-full max-w-[100px]">
        <svg viewBox="0 0 100 100" className="w-full">
          <circle cx="50" cy="50" r={R} fill="none" stroke="#232830" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${ARC} ${C}`} transform="rotate(135 50 50)" />
          <circle cx="50" cy="50" r={R} fill="none" stroke="#a7a5ff" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${ARC * p} ${C}`} transform="rotate(135 50 50)" style={{ transition: "stroke-dasharray 500ms ease" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold tabular-nums text-[#E8EAED]">{value}</span>
          <span className="text-[10px] text-[#5C636D]">{unit}</span>
        </div>
      </div>
    </div>
  );
}

interface Props {
  score: number;
  sun: number;
  commHours: number;
  risk: number;
}

export default function SummaryGauges({ score, sun, commHours, risk }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Gauge label="Overall Score" value={score.toFixed(0)} unit="/ 100" percent={score / 100} />
      <Gauge label="Sun Exposure" value={sun.toFixed(0)} unit="%" percent={sun / 100} />
      <Gauge label="Comm Window" value={commHours.toFixed(1)} unit="h / day" percent={commHours / 24} />
      <Gauge label="Mission Risk" value={risk.toFixed(0)} unit="/ 100" percent={risk / 100} />
    </div>
  );
}