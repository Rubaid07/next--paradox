"use client";

import { useEffect, useMemo, useState } from "react";

import SummaryGauges from "./planner/SummaryGauges";
import SiteDateHeatmap from "./planner/SiteDateHeatmap";
import BestWindowFinder from "./planner/BestWindowFinder";
import MissionPriority from "./planner/MissionPriority";
import ScienceEngineeringCompare from "./planner/ScienceEngineeringCompare";
import {
  AUTONOMY_LIMIT_H,
  BATTERY_HOURS,
  GEN_TO_LOAD,
  GRID_COLS,
  analyseDelay,
  evaluate,
  fmtDay,
  gridDay,
  loadSiteSeries,
  neighbours,
  rankCmp,
  scanWindows,
  scoreOf,
  teamRanking,
  topWindows,
  type HeatMetric,
  type Priority,
  type SeriesSet,
} from "../../lib/compareModel";
import { useGridStart } from "../../lib/useGridStart";
import { getStoredPlan, getStoredSiteId, setStoredPlan, setStoredSiteId } from "../../lib/selection";

export default function MissionComparison() {
  const [series, setSeries] = useState<SeriesSet | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [savedPlan] = useState(() => getStoredPlan());
  const [priority, setPriority] = useState<Priority>(savedPlan.priority);
  const [duration, setDuration] = useState(savedPlan.duration);
  const [delay, setDelay] = useState(savedPlan.delay);
  const [selectedId, setSelectedId] = useState("");
  const [metric, setMetric] = useState<HeatMetric>("score");
  const [sciW, setSciW] = useState(savedPlan.sciW);
  const [engW, setEngW] = useState(savedPlan.engW);

  // Heatmap starts today (UTC) and rolls forward every day; past dates drop off.
  const gridStart = useGridStart();
  // A launch day the user picked. Without a pick (or once it is in the past) the planned launch is
  // the first heatmap day.
  const [pickedDay, setPickedDay] = useState<number | null>(savedPlan.pickedDay);
  const plannedDay = Math.max(pickedDay ?? gridStart, gridStart);

  useEffect(() => {
    loadSiteSeries()
      .then((s) => {
        setSeries(s);
        const saved = getStoredSiteId();
        if (saved && s.sites.some((site) => site.id === saved)) setSelectedId(saved);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    if (selectedId) setStoredSiteId(selectedId);
  }, [selectedId]);

  // Publish every comparison input for the Report page.
  useEffect(() => {
    if (!selectedId) return;
    setStoredPlan({ siteId: selectedId, duration, priority, pickedDay, delay, sciW, engW });
  }, [selectedId, duration, priority, pickedDay, delay, sciW, engW]);

  const effectiveDay = plannedDay + delay;
  const sites = useMemo(() => series?.sites ?? [], [series]);
  const selIdx = Math.max(0, sites.findIndex((s) => s.id === selectedId));
  const selSite = sites[selIdx];

  const grid = useMemo(
    () => sites.map((s) => Array.from({ length: GRID_COLS }, (_, c) => evaluate(s, gridDay(c, gridStart), duration))),
    [sites, duration, gridStart],
  );

  const atEffective = useMemo(
    () => sites.map((s) => ({ site: s, m: evaluate(s, effectiveDay, duration) })),
    [sites, effectiveDay, duration],
  );

  const ranking = useMemo(
    () =>
      atEffective
        .map(({ site, m }) => ({ id: site.id, name: site.name, score: scoreOf(m, priority), risk: m.risk }))
        .sort(rankCmp),
    [atEffective, priority],
  );

  // scanWindows starts at today, so these must recompute when the day rolls over.
  const windows = useMemo(
    () => (selSite ? topWindows(scanWindows(selSite, duration, priority, gridStart), 3, Math.max(4, duration)) : []),
    [selSite, duration, priority, gridStart],
  );

  const regionAlt = useMemo(() => {
    if (!selSite) return [];
    return neighbours(selSite, sites)
      .map((s) => {
        const best = topWindows(scanWindows(s, duration, priority, gridStart), 1)[0];
        return { name: s.name, day: best.day, score: best.score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [sites, selSite, duration, priority, gridStart]);

  const delayAnalysis = useMemo(
    () => (sites.length ? analyseDelay(sites, plannedDay, duration, priority) : null),
    [sites, plannedDay, duration, priority],
  );

  const team = useMemo(() => (atEffective.length ? teamRanking(atEffective, sciW, engW) : null), [atEffective, sciW, engW]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 p-8 text-center text-sm text-[#E8EAED]">
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 backdrop-blur-md">
          <p className="font-medium text-red-400">Could not load <code>/data/site_series.json</code>.</p>
          <p className="mt-1 text-xs text-gray-400">Put the file in <code>public/data/</code>.</p>
          <span className="mt-3 block text-xs text-[#7F93B3]">{error}</span>
        </div>
      </main>
    );
  }
  if (!series || !delayAnalysis || !team || !selSite || !atEffective.length) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-sm text-[#7F93B3]">
        <div className="flex items-center gap-3 animate-pulse">
          <div className="h-4 w-4 rounded-full bg-blue-500/50 animate-ping"></div>
          <span>Loading mission data…</span>
        </div>
      </main>
    );
  }

  const selNow = atEffective[selIdx].m;
  const selScoreNow = scoreOf(selNow, priority);

  const sameDateAlt = atEffective
    .filter((x) => x.site.id !== selSite.id)
    .map((x) => ({ name: x.site.name, score: scoreOf(x.m, priority) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const metricsById = Object.fromEntries(atEffective.map(({ site, m }) => [site.id, m]));
  const scoresById = Object.fromEntries(atEffective.map(({ site, m }) => [site.id, scoreOf(m, priority)]));

  return (
    <main className="min-h-screen bg-[#030712] text-[#E8EAED] selection:bg-blue-500 selection:text-white">
      <div className="mx-auto max-w-[1680px] px-4 pb-20 pt-8 sm:px-6 lg:px-8">
        
        {/* Header Section */}
        <header className="relative mb-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-4 py-1.5 mb-3 backdrop-blur-md">
            <span className="h-2 w-2 rounded-full bg-blue-400 animate-pulse"></span>
            <span className="text-[11px] font-bold tracking-[0.25em] text-blue-400 uppercase">Lunar Mission Control</span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl text-white">MISSION COMPARISON</h1>
          <p className="mt-2 text-xs sm:text-sm text-gray-400 max-w-2xl mx-auto">
            Computed per site: DE421 Sun/Earth + libration · 400 m LOLA DEM horizon mask · DSN visibility · hourly, 2026-11-10 → 2028-12-31
          </p>
        </header>

        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px] lg:gap-8">
          
          {/* Left Sidebar: Priority & Settings */}
          <aside className="order-2 xl:order-1 rounded-2xl border border-gray-800/60 bg-gray-900/40 p-4 backdrop-blur-xl shadow-lg">
            <MissionPriority
              priority={priority}
              onPriority={setPriority}
              duration={duration}
              onDuration={setDuration}
              ranking={ranking}
              selectedId={selSite.id}
              onSelect={setSelectedId}
            />
          </aside>

          {/* Central Workspace: Gauges & Heatmap */}
          <section className="order-1 flex min-w-0 flex-col gap-6 xl:order-2">
            <div className="rounded-2xl border border-gray-800/60 bg-gray-900/40 p-5 backdrop-blur-xl shadow-lg">
              <SummaryGauges score={selScoreNow} sun={selNow.sun} commHours={selNow.commHours} risk={selNow.risk} />
            </div>
            
            <div className="rounded-2xl border border-gray-800/60 bg-gray-900/40 p-5 backdrop-blur-xl shadow-lg">
              <SiteDateHeatmap
                sites={sites}
                grid={grid}
                metric={metric}
                onMetric={setMetric}
                priority={priority}
                selectedId={selSite.id}
                gridStart={gridStart}
                plannedDay={plannedDay}
                effectiveDay={effectiveDay}
                onPick={(id, day) => {
                  setSelectedId(id);
                  setPickedDay(day);
                  setDelay(0);
                }}
              />
            </div>
          </section>

          {/* Right Sidebar: Window Finder */}
          <aside className="order-3 rounded-2xl border border-gray-800/60 bg-gray-900/40 p-4 backdrop-blur-xl shadow-lg">
            <BestWindowFinder
              siteName={selSite.name}
              duration={duration}
              windows={windows}
              plannedDay={effectiveDay}
              plannedScore={selScoreNow}
              sameDateAlt={sameDateAlt}
              regionAlt={regionAlt}
              onPickDay={(d) => {
                setPickedDay(d);
                setDelay(0);
              }}
            />
          </aside>
        </div>

        {/* Bottom Section: Science & Engineering Comparison */}
        <div className="mt-8 rounded-2xl border border-gray-800/60 bg-gray-900/40 p-6 backdrop-blur-xl shadow-lg">
          <ScienceEngineeringCompare
            rows={team.rows}
            metrics={metricsById}
            scores={scoresById}
            agreement={team.agreement}
            price={team.price}
            sites={sites}
            priority={priority}
            overallTop={ranking[0].name}
            sciW={sciW}
            engW={engW}
            onSci={setSciW}
            onEng={setEngW}
            dateLabel={fmtDay(effectiveDay)}
            duration={duration}
          />
        </div>

        {/* Footer Info */}
        <footer className="mt-10 rounded-xl border border-gray-800/40 bg-gray-950/40 p-4 text-center text-[11px] leading-relaxed text-gray-500">
          <p>
            Model assumptions: {series.meta.mast_m} m mast · battery {BATTERY_HOURS} h, array = {GEN_TO_LOAD}× load · DSN min. elevation {series.meta.dsn_min_elev_deg}° · continuity = powered and Earth contact within {AUTONOMY_LIMIT_H} h.
            {sites.filter((s) => s.analysisNote.startsWith("highest")).map((s) => ` ${s.name} is evaluated at the rim crest (${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°), not the crater centre.`)}
            {" "}DEM is 400 m resolution; slope and relief are coarse-scale values.
          </p>
        </footer>

      </div>
    </main>
  );
}