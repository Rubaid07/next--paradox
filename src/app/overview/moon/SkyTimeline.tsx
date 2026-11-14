
"use client";

import { Pause, Play, Radio, SkipBack, SkipForward } from "lucide-react";
import {
  compass,
  formatUtc,
  sampleBody,
  type EphemerisData,
} from "../../../lib/ephemeris";
import { SPEEDS, type SkyEphemeris } from "./useSkyEphemeris";

function Readout({
  name,
  color,
  az,
  el,
}: {
  name: string;
  color: string;
  az: number;
  el: number;
}) {
  const up = el >= 0;

  return (
    <div className="rounded-lg border border-[#526783]/60 bg-[#080F1C]/85 px-3 py-2 backdrop-blur-md">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-white">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: color }}
        />

        {name}

        <span
          className={
            "ml-auto text-[9px] font-medium " +
            (up ? "text-[#A7A5FF]" : "text-[#7F93B3]")
          }
        >
          {up ? "above horizon" : "below horizon"}
        </span>
      </div>

      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 text-[11px] tabular-nums">
        <dt className="text-[#7F93B3]">Azimuth</dt>
        <dd className="text-right text-white">
          {az.toFixed(3)}° {compass(az)}
        </dd>

        <dt className="text-[#7F93B3]">Elevation</dt>
        <dd className="text-right text-white">
          {el.toFixed(3)}°
        </dd>
      </dl>
    </div>
  );
}

/** Real-time Az/El of the Sun and Earth at time `t` (UTC ms). Overlay it on the 3D view. */
export function SkyReadouts({
  eph,
  t,
}: {
  eph: EphemerisData;
  t: number;
}) {
  const sun = sampleBody(eph, "sun", t);
  const earth = sampleBody(eph, "earth", t);

  return (
    <div className="space-y-2">
      <Readout
        name="Sun"
        color="#C7C3FF"
        az={sun.az}
        el={sun.el}
      />

      <Readout
        name="Earth"
        color="#FFFFFF"
        az={earth.az}
        el={earth.el}
      />
    </div>
  );
}

/** Play / Pause, ±1 h, speed, and the scrub slider. */
export function SkyTimeline({ sky }: { sky: SkyEphemeris }) {
  const { eph, endMs, t, playing } = sky;
  const ready = !!eph;

  const btn =
    "rounded-lg border border-[#26354C] bg-[#080F1C] p-2 text-[#A9BBD5] transition-colors hover:border-[#A7A5FF]/50 hover:text-[#C7C3FF] disabled:opacity-40";

  return (
    <div className="space-y-3 rounded-lg border border-[#202D42] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!ready}
          onClick={() => sky.jump(-3_600_000)}
          aria-label="Back 1 hour"
          className={btn}
        >
          <SkipBack size={16} />
        </button>

        <button
          type="button"
          disabled={!ready}
          onClick={sky.togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="flex items-center gap-2 rounded-lg border border-[#A7A5FF]/50 bg-[#A7A5FF]/8 px-4 py-2 text-xs font-semibold text-[#C7C3FF] transition-colors hover:bg-[#A7A5FF]/[0.18] disabled:opacity-40"
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
          {playing ? "Pause" : "Play"}
        </button>

        <button
          type="button"
          disabled={!ready}
          onClick={() => sky.jump(3_600_000)}
          aria-label="Forward 1 hour"
          className={btn}
        >
          <SkipForward size={16} />
        </button>

        <select
          aria-label="Playback speed"
          value={sky.speed}
          onChange={(e) => sky.setSpeed(Number(e.target.value))}
          className="rounded-lg border border-[#26354C] bg-[#080F1C] px-2 py-2 text-xs text-white focus:border-[#A7A5FF] focus:outline-none"
        >
          {SPEEDS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        {sky.live && playing ? (
          <span className="flex items-center gap-1.5 rounded-lg border border-[#A7A5FF]/50 bg-[#A7A5FF]/8 px-2.5 py-2 text-[11px] font-semibold text-[#C7C3FF]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#A7A5FF]" />
            LIVE
          </span>
        ) : (
          <button
            type="button"
            disabled={!ready}
            onClick={sky.goLive}
            className="flex items-center gap-1.5 rounded-lg border border-[#26354C] bg-[#080F1C] px-2.5 py-2 text-[11px] font-semibold text-[#A9BBD5] transition-colors hover:border-[#A7A5FF]/50 hover:text-[#C7C3FF] disabled:opacity-40"
          >
            <Radio size={14} />
            Go live
          </button>
        )}

        <time
          className="ml-auto text-sm font-semibold tabular-nums text-white"
          dateTime={ready ? new Date(t).toISOString() : undefined}
        >
          {ready
            ? formatUtc(t)
            : sky.status === "loading"
              ? "Fetching Horizons…"
              : "—"}
        </time>
      </div>

      <input
        type="range"
        aria-label="Timeline"
        disabled={!ready}
        min={0}
        max={ready ? (endMs - eph.startMs) / 1000 : 1}
        step={1}
        value={ready ? Math.round((t - eph.startMs) / 1000) : 0}
        onChange={(e) =>
          eph && sky.scrub(eph.startMs + Number(e.target.value) * 1000)
        }
        className="h-1 w-full cursor-pointer accent-[#A7A5FF] disabled:opacity-40"
      />

      <div className="flex justify-between text-[10px] tabular-nums text-[#7F93B3]">
        <span>{ready ? formatUtc(eph.startMs) : ""}</span>
        <span>Space = play / pause</span>
        <span>{ready ? formatUtc(endMs) : ""}</span>
      </div>

      {sky.status === "error" && (
        <p
          role="alert"
          className="rounded-lg border border-white/30 bg-white/[0.04] p-2 text-[11px] leading-relaxed text-white/80"
        >
          Could not load ephemeris: {sky.error}
        </p>
      )}
    </div>
  );
}