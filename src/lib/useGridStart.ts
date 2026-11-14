"use client";

import { useEffect, useState } from "react";
import { gridStartDay } from "./compareModel";

const DAY_MS = 86_400_000;

/**
 * First heatmap day (days since 2026-11-10) = today in UTC. Re-renders the caller at UTC midnight
 * and when the tab becomes visible again, so a tab left open still rolls forward.
 */
export function useGridStart(): number {
  const [start, setStart] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = () => setStart(gridStartDay(Date.now()));

    const schedule = () => {
      const now = Date.now();
      const nextMidnight = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, nextMidnight - now + 1000);
    };

    refresh(); // sync once after hydration
    schedule();
    document.addEventListener("visibilitychange", refresh);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return start;
}