"use client";

import type { ReactNode } from "react";

/**
 * Sidebar building blocks in the "mission dashboard" card style:
 * spaced uppercase titles, status pills, ring gauges, stat tiles and aligned data rows.
 */

export type Tone = "neutral" | "good" | "warn" | "bad";

const PILL: Record<Tone, string> = {
  neutral: "border-[#3A4A66] text-[#D5DEEE]",
  good: "border-[#A7A5FF]/50 text-[#A7A5FF]",
  warn: "border-white/40 text-white",
  bad: "border-white/30 text-white/80",
};

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-wide " +
        PILL[tone]
      }
    >
      {children}
    </span>
  );
}

export function Card({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#1E2A3E] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[#8393AD]">
          {title}
        </h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

/** Circular gauge, 0..1. */
export function Ring({
  value,
  label,
  caption,
  size = 96,
}: {
  value: number;
  label: string;
  caption: string;
  size?: number;
}) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#2B3547"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#A7A5FF"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[22px] font-bold leading-none tabular-nums text-white">
          {label}
        </span>
        <span className="mt-1 text-[9px] font-medium uppercase tracking-[0.12em] text-[#6E7F9E]">
          {caption}
        </span>
      </div>
    </div>
  );
}

export function Tile({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-[#1E2A3E] px-2 py-3.5 text-center">
      <div className="truncate text-[17px] font-bold tabular-nums text-white">
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[#5F7399]">
        {label}
      </div>
    </div>
  );
}

export function StatRow({
  label,
  value,
  dot,
}: {
  label: string;
  value: ReactNode;
  dot?: string;
}) {
  return (
    <div className="flex items-center gap-3 text-[13px]">
      {dot && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: dot }}
        />
      )}
      <span className="text-[#9FB0CC]">{label}</span>
      <span className="ml-auto font-medium tabular-nums text-white">
        {value}
      </span>
    </div>
  );
}

/** Thin progress bar with an optional marker (both 0..1). */
export function Bar({ value, marker }: { value?: number; marker?: number }) {
  const clamp = (n: number) => Math.min(1, Math.max(0, n));

  return (
    <div className="relative h-1.5 w-full rounded-full bg-[#1B2434]">
      {value !== undefined && (
        <div
          className="h-full rounded-full bg-[#A7A5FF]"
          style={{ width: `${clamp(value) * 100}%` }}
        />
      )}

      {marker !== undefined && (
        <span
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0A0F1A] bg-[#C7C3FF]"
          style={{ left: `${clamp(marker) * 100}%` }}
        />
      )}
    </div>
  );
}

export function Divider() {
  return <div className="my-4 border-t border-[#1E2A3E]" />;
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-[13px] text-[#9FB0CC]">
      {label}

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors " +
          (checked
            ? "border-[#A7A5FF]/60 bg-[#A7A5FF]/25"
            : "border-[#34425C] bg-[#111927]")
        }
      >
        <span
          className={
            "absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all " +
            (checked ? "left-[18px] bg-[#A7A5FF]" : "left-0.5 bg-[#7F93B3]")
          }
        />
      </button>
    </label>
  );
}

export function Seg<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#6E7F9E]">
        {label}
      </div>
      <div role="group" aria-label={label} className="flex gap-1.5">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={
              "flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors " +
              (value === o.value
                ? "border-[#A7A5FF]/60 bg-[#A7A5FF]/8 text-white"
                : "border-[#1E2A3E] text-[#8FA3C2] hover:border-[#A7A5FF]/40 hover:text-white")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RangeRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between text-[11px] font-medium uppercase tracking-[0.14em] text-[#6E7F9E]">
        {props.label}
        <span className="text-[13px] font-semibold normal-case tracking-normal tabular-nums text-white">
          {props.display}
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-[#A7A5FF]"
      />
    </label>
  );
}
