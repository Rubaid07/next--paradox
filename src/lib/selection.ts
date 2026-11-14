/**
 * Remembers which landing site is selected so the Comparison page (`/`) and the Overview page
 * (`/overview`) stay in sync. Every access is wrapped because storage can be blocked or throw
 * (private windows, blocked site data) and the app must still work without it.
 */
const KEY = "lunar:selectedSiteId";

export function getStoredSiteId(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setStoredSiteId(id: string): void {
  try {
    window.localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

/** `?site=<id>` from the current URL (client only). */
export function getSiteIdFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("site");
  } catch {
    return null;
  }
}

export function overviewHref(id: string | null): string {
  return id ? `/overview?site=${encodeURIComponent(id)}` : "/overview";
}

// ───────────── shared planner selection (Comparison → Report and Overview) ─────────────
// Comparison owns the mission inputs; Report reads the full plan and Overview follows its duration.

export type PlanPriority = "power" | "comms" | "balance";
export const MISSION_DURATIONS = [3, 7, 14] as const;

export function isMissionDuration(value: number): value is (typeof MISSION_DURATIONS)[number] {
  return MISSION_DURATIONS.some((duration) => duration === value);
}

export interface PlanSelection {
  siteId: string;
  duration: number;
  priority: PlanPriority;
  /** launch day the user picked on the heatmap / best-window list (days since data start), or null */
  pickedDay: number | null;
  /** extra delay in days applied on top of the planned launch */
  delay: number;
  /** science / engineering weights used by the team comparison */
  sciW: number;
  engW: number;
}

export const PLAN_KEY = "lunar:planSelection";

export const DEFAULT_PLAN: PlanSelection = {
  siteId: "",
  duration: 7,
  priority: "balance",
  pickedDay: null,
  delay: 0,
  sciW: 70,
  engW: 60,
};

export function getStoredPlan(): PlanSelection {
  try {
    const raw = window.localStorage.getItem(PLAN_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<PlanSelection>) : {};
    return { ...DEFAULT_PLAN, ...p, siteId: p.siteId || getStoredSiteId() || "" };
  } catch {
    return { ...DEFAULT_PLAN, siteId: getStoredSiteId() ?? "" };
  }
}

export function setStoredPlan(plan: PlanSelection): void {
  try {
    window.localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  } catch {
    /* ignore */
  }
}