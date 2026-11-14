import type { ReactNode } from "react";

export function PanelTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center justify-between border-b border-[#1B2A44] pb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9DB4D6]">
      <span>{children}</span>
      {right}
    </h2>
  );
}

export function SmallLabel({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#8A9099]">{children}</p>;
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded border px-2.5 py-1 text-[11px] font-semibold transition ${
        active
          ? "border-[#a7a5ff] bg-[#a7a5ff]/10 text-[#E8EAED]"
          : "border-[#1B2A44] text-[#7F93B3] hover:border-[#34445e] hover:text-[#E8EAED]"
      }`}
    >
      {children}
    </button>
  );
}