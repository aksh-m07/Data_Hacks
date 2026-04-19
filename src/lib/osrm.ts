/** OSRM public demo server — real routing; not for production abuse. */

export type RouteResult = {
  coords: [number, number][];
  distanceM: number;
  durationS: number;
};

export async function fetchEvacRoute(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): Promise<RouteResult | null> {
  const u = `https://router.project-osrm.org/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?overview=full&geometries=geojson`;
  const r = await fetch(u);
  if (!r.ok) return null;
  const j = (await r.json()) as {
    routes: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] } }>;
  };
  const route = j.routes?.[0];
  if (!route) return null;
  return {
    coords: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]),
    distanceM: route.distance,
    durationS: route.duration,
  };
}

/** Meteorological wind direction → cardinal (wind FROM). */
export function windFromCardinal(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(deg / 45) % 8;
  return dirs[idx];
}

/** Downwind = direction fire spreads (toward). */
export function downwindBearingCardinal(windFromDeg: number): string {
  const spread = (windFromDeg + 180) % 360;
  return windFromCardinal(spread);
}
