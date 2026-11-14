"use client";

import { useId, useState } from "react";
import { legendGradient } from "../../../lib/colormap";
import type { ColorMode, HeightmapLevel, ViewSettings } from "../../../lib/types";

interface TerrainControlsProps {
  settings: ViewSettings;
  onChange: (patch: Partial<ViewSettings>) => void;
  onResetView: () => void;
  levels: HeightmapLevel[];
  elevationRange: { min: number; max: number };
  busy: boolean;
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <label htmlFor={id} className="text-ink-300">
          {props.label}
        </label>
        <span className="tabular-nums text-ink-100">{props.display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-cyan-400"
      />
    </div>
  );
}

function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-ink-300">{props.label}</div>
      <div role="group" aria-label={props.label} className="flex overflow-hidden rounded-md border border-line-strong">
        {props.options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={props.disabled}
            aria-pressed={props.value === o.value}
            onClick={() => props.onChange(o.value)}
            className={
              "flex-1 px-2 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow disabled:opacity-50 " +
              (props.value === o.value
                ? "bg-glow/15 text-glow-soft"
                : "text-ink-300 hover:bg-space-800 hover:text-ink-100")
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-xs text-ink-300">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-cyan-400"
      />
    </label>
  );
}

export default function TerrainControls({ settings, onChange, onResetView, levels, elevationRange, busy }: TerrainControlsProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="pointer-events-auto absolute left-3 top-3 w-[15.5rem] rounded-lg border border-line-strong bg-space-900/85 text-ink-100 shadow-xl backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-glow"
      >
        Terrain controls
        <span aria-hidden className="text-ink-500">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="space-y-3.5 border-t border-line px-3 pb-3 pt-3">
          <Slider
            label="Vertical exaggeration"
            value={settings.exaggeration}
            min={1}
            max={10}
            step={0.5}
            display={`${settings.exaggeration}×`}
            onChange={(v) => onChange({ exaggeration: v })}
          />
          <Slider
            label="Sun azimuth (from north)"
            value={settings.sunAzimuth}
            min={0}
            max={360}
            step={5}
            display={`${settings.sunAzimuth}°`}
            onChange={(v) => onChange({ sunAzimuth: v })}
          />
          <Slider
            label="Sun elevation"
            value={settings.sunElevation}
            min={0.5}
            max={45}
            step={0.5}
            display={`${settings.sunElevation}°`}
            onChange={(v) => onChange({ sunElevation: v })}
          />

          <Segmented<ColorMode>
            label="Surface colour"
            value={settings.colorMode}
            options={[
              { value: "elevation", label: "Elevation" },
              { value: "neutral", label: "Neutral" },
            ]}
            onChange={(v) => onChange({ colorMode: v })}
          />
          <Segmented<string>
            label="Mesh detail"
            value={settings.levelId}
            disabled={busy}
            options={levels.map((l) => ({ value: l.id, label: `${l.cellSizeM} m` }))}
            onChange={(v) => onChange({ levelId: v })}
          />

          <div className="space-y-2 pt-0.5">
            <Toggle label="Shadows" checked={settings.shadows} onChange={(v) => onChange({ shadows: v })} />
            <Toggle label="Site labels" checked={settings.showLabels} onChange={(v) => onChange({ showLabels: v })} />
          </div>

          <button
            type="button"
            onClick={onResetView}
            className="w-full rounded-md border border-line-strong px-2 py-1.5 text-xs text-ink-100 transition-colors hover:border-glow/60 hover:text-glow-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-glow"
          >
            Reset view
          </button>

          {settings.colorMode === "elevation" && (
            <div className="flex items-stretch gap-2.5 border-t border-line pt-3">
              <div
                aria-hidden
                className="w-2.5 rounded-sm"
                style={{ background: legendGradient(elevationRange.min, elevationRange.max), minHeight: "5.5rem" }}
              />
              <div className="flex flex-col justify-between text-[11px] tabular-nums text-ink-300">
                <span>{Math.round(elevationRange.max).toLocaleString("en-US")} m</span>
                <span className="text-ink-500">elevation vs. 1,737.4 km sphere</span>
                <span>{Math.round(elevationRange.min).toLocaleString("en-US")} m</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
