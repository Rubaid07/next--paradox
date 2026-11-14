/** Plain constants shared by client UI and the 3D scene (no three.js import, safe for SSR). */
export const HOME_TARGET: [number, number, number] = [0, 0, 0];
/** Looking from the south edge of the map towards the pole, map-north (longitude 0) pointing away. */
export const HOME_DIRECTION: [number, number, number] = [0, 0.62, 0.78];
export const HOME_DISTANCE = 780;

export const MARKER_COLORS = {
  candidate_landing_site: "#22d3ee",
  feature_center: "#4f8cff",
  selected: "#ffffff",
} as const;
