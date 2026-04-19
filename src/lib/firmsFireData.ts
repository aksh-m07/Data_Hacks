/**
 * NASA FIRMS (Fire Information for Resource Management System)
 * Public CSV — no API key required.
 * https://firms.modaps.eosdis.nasa.gov/data/active_fire/
 *
 * Fetches the 7-day VIIRS (Suomi NPP) active fire CSV for the contiguous US,
 * filters to California, and returns the nearest hotspot to the user.
 *
 * Used to replace the static Camp Fire reference point in features.ts with
 * real near-real-time fire data.
 */

const FIRMS_URL =
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_USA_contiguous_and_Hawaii_7d.csv";

// California bounding box (generous — includes border counties)
const CA_BBOX = { minLat: 32.0, maxLat: 42.5, minLon: -125.0, maxLon: -113.5 };

export type FireHotspot = {
  lat: number;
  lon: number;
  frp: number; // Fire Radiative Power (MW) — intensity proxy
  acqDate: string;
  confidence: string;
  distanceKm: number;
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function parseFireCSV(csv: string, userLat: number, userLon: number): FireHotspot[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const latIdx = headers.indexOf("latitude");
  const lonIdx = headers.indexOf("longitude");
  const frpIdx = headers.indexOf("frp");
  const dateIdx = headers.indexOf("acq_date");
  const confIdx = headers.indexOf("confidence");

  if (latIdx === -1 || lonIdx === -1) return [];

  const hotspots: FireHotspot[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(",");
    const lat = parseFloat(parts[latIdx] ?? "");
    const lon = parseFloat(parts[lonIdx] ?? "");
    if (isNaN(lat) || isNaN(lon)) continue;
    if (
      lat < CA_BBOX.minLat ||
      lat > CA_BBOX.maxLat ||
      lon < CA_BBOX.minLon ||
      lon > CA_BBOX.maxLon
    )
      continue;

    hotspots.push({
      lat,
      lon,
      frp: frpIdx !== -1 ? parseFloat(parts[frpIdx] ?? "0") || 0 : 0,
      acqDate: dateIdx !== -1 ? (parts[dateIdx]?.trim() ?? "") : "",
      confidence: confIdx !== -1 ? (parts[confIdx]?.trim() ?? "") : "",
      distanceKm: haversineKm(userLat, userLon, lat, lon),
    });
  }
  return hotspots;
}

type Cache = { ts: number; hotspots: FireHotspot[] };
let _cache: Cache | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30-minute cache — CSV refreshes every ~3h

export async function fetchNearestCalFire(
  userLat: number,
  userLon: number,
): Promise<{ nearest: FireHotspot | null; totalInState: number }> {
  try {
    const now = Date.now();
    let hotspots: FireHotspot[];

    if (_cache && now - _cache.ts < CACHE_TTL_MS) {
      hotspots = _cache.hotspots.map((h) => ({
        ...h,
        distanceKm: haversineKm(userLat, userLon, h.lat, h.lon),
      }));
    } else {
      const r = await fetch(FIRMS_URL, { signal: AbortSignal.timeout(12_000) });
      if (!r.ok) throw new Error(`FIRMS ${r.status}`);
      const csv = await r.text();
      hotspots = parseFireCSV(csv, userLat, userLon);
      _cache = { ts: now, hotspots };
    }

    if (hotspots.length === 0) {
      return { nearest: null, totalInState: 0 };
    }

    hotspots.sort((a, b) => a.distanceKm - b.distanceKm);
    return { nearest: hotspots[0] ?? null, totalInState: hotspots.length };
  } catch {
    return { nearest: null, totalInState: 0 };
  }
}
