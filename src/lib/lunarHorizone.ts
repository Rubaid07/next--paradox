/**
 * JPL Horizons lunar-site observer ephemeris.
 *
 * IMPORTANT: Run this on the server (e.g. from a Next.js Route Handler),
 * not directly in the browser.
 */

export type LunarSite = {
  longitude: number; // East longitude, degrees
  latitude: number;  // North positive, South negative, degrees
  altitudeKm?: number; // Height above lunar reference ellipsoid, km
};

export type BodyPositionRequest = {
  site: LunarSite;
  startTime: string; // e.g. "2026-11-12 00:00"
  stopTime: string;  // e.g. "2026-11-12 06:00"
  stepSize?: string; // Horizons STEP_SIZE, e.g. "5m". Defaults to "1m".
};

export type HorizonsBody = "sun" | "earth";

const HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api";

async function getBodyEphemeris(
  body: HorizonsBody,
  request: BodyPositionRequest,
): Promise<string> {
  const { site, startTime, stopTime, stepSize = "1m" } = request;

  const params = new URLSearchParams({
    format: "json",
    COMMAND: body === "sun" ? "'10'" : "'399'",
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@301'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${site.longitude},${site.latitude},${site.altitudeKm ?? 0}'`,
    START_TIME: `'${startTime}'`,
    STOP_TIME: `'${stopTime}'`,
    STEP_SIZE: `'${stepSize}'`,
    QUANTITIES: "'4'",
    ANG_FORMAT: "'DEG'",
    APPARENT: "'AIRLESS'",
    TIME_DIGITS: "'SECONDS'",
  });

  const response = await fetch(`${HORIZONS_API}?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Horizons API request failed: HTTP ${response.status}`);
  }

  const data: { result?: string; error?: string } = await response.json();

  if (data.error) {
    throw new Error(`Horizons API error: ${data.error}`);
  }

  if (!data.result) {
    throw new Error("Horizons API returned no ephemeris result.");
  }

  return data.result;
}

/**
 * Returns raw Horizons observer-table text for the Sun and Earth.
 * The table contains one record per minute (STEP_SIZE = 1m).
 * Parse the $$SOE ... $$EOE section to read the ephemeris rows.
 */
export async function getSunAndEarthPositions(
  request: BodyPositionRequest,
): Promise<{ sun: string; earth: string }> {
  const [sun, earth] = await Promise.all([
    getBodyEphemeris("sun", request),
    getBodyEphemeris("earth", request),
  ]);

  return { sun, earth };
}