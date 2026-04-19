/**
 * Scripps Institution of Oceanography – AWN/HPWREN weather station parser.
 *
 * Handles AWN CSV (single-station time-series, no lat/lon in file):
 *   "Date","Simple Date","Outdoor Temperature (°F)","Feels Like (°F)",
 *   "Wind Speed (mph)",...,"Wind Direction (°)",...,"Humidity (%)",...
 *
 * Column names may show "Â°" instead of "°". Station AWN-84F3EB5450ED is hardcoded (UCSD).
 *
 * Competition requirement: AWN data is mandatory. A default CSV ships under
 * `public/scripps/`. Override with VITE_SCRIPPS_CSV_URL if needed.
 */

/** Bundled AWN export — must stay in repo for disqualification-safe builds. */
export const DEFAULT_SCRIPPS_CSV_URL = "/scripps/AWN-84F3EB5450ED-20250814-20250815.csv";

export type ScrippsReading = {
  stationId: string;
  lat: number;
  lon: number;
  tempF: number;
  humidity: number;
  windMph: number;
  windDir: number;
  distanceKm: number;
};

const AWN_LAT = 32.88;
const AWN_LON = -117.24;
const AWN_STATION_ID = "AWN-84F3EB5450ED";

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

/** RFC4180-ish: split one CSV line into fields (handles quoted commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      out.push(cur.trim());
      cur = "";
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  out.push(cur.trim());
  return out;
}

function normalizeHeader(h: string): string {
  return h
    .replace(/["']/g, "")
    .replace(/Â/g, "")
    .replace(/°/g, "deg")
    .replace(/%/g, "pct")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function findCol(headers: string[], ...candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.findIndex((h) => h.includes(c));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseAwnCSV(csv: string): Omit<ScrippsReading, "distanceKm"> | null {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (lines.length < 2) return null;

  const raw = splitCsvLine(lines[0]!).map(normalizeHeader);

  const tempFIdx = findCol(
    raw,
    "outdoor_temperature_degf",
    "outdoor_temperature",
    "temperature_degf",
    "temp_degf",
    "temp_f",
  );
  const feelsIdx = findCol(raw, "feels_like_degf", "feels_like");
  const humIdx = findCol(raw, "humidity", "relative_humidity", "rh");
  const wspeedIdx = findCol(raw, "wind_speed_mph", "wind_speed");
  const wdirIdx = findCol(raw, "wind_direction_degdeg", "wind_direction_deg", "wind_direction", "wind_dir");

  const useTempIdx = tempFIdx !== -1 ? tempFIdx : feelsIdx;
  if (useTempIdx === -1 || humIdx === -1) return null;

  for (let i = lines.length - 1; i >= 1; i--) {
    const parts = splitCsvLine(lines[i]!).map((p) => p.replace(/^"|"$/g, "").trim());
    if (parts.length <= Math.max(useTempIdx, humIdx)) continue;

    const tempF = parseFloat(parts[useTempIdx] ?? "");
    const humidity = parseFloat(parts[humIdx] ?? "");
    if (Number.isNaN(tempF) || Number.isNaN(humidity)) continue;

    const windMph = wspeedIdx !== -1 ? parseFloat(parts[wspeedIdx] ?? "") || 0 : 0;
    const windDir = wdirIdx !== -1 ? parseFloat(parts[wdirIdx] ?? "") || 0 : 0;

    return {
      stationId: AWN_STATION_ID,
      lat: AWN_LAT,
      lon: AWN_LON,
      tempF,
      humidity,
      windMph: Number.isNaN(windMph) ? 0 : windMph,
      windDir: Number.isNaN(windDir) ? 0 : windDir,
    };
  }
  return null;
}

let _cache: { url: string; data: string; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Loads Scripps/UCSD AWN station data (required for the challenge track).
 * Throws if the CSV cannot be fetched or parsed — callers should surface the error.
 */
export async function fetchScrippsNearest(
  userLat: number,
  userLon: number,
): Promise<ScrippsReading> {
  const envUrl = import.meta.env.VITE_SCRIPPS_CSV_URL as string | undefined;
  const key =
    typeof envUrl === "string" && envUrl.trim().length > 0
      ? envUrl.trim()
      : DEFAULT_SCRIPPS_CSV_URL;

  let csv: string;
  try {
    const now = Date.now();
    if (_cache && _cache.url === key && now - _cache.ts < CACHE_TTL_MS) {
      csv = _cache.data;
    } else {
      let fetchUrl = key;
      if (fetchUrl.startsWith("/")) {
        const base = import.meta.env.BASE_URL ?? "/";
        fetchUrl = base === "/" ? fetchUrl : `${base.replace(/\/$/, "")}${fetchUrl}`;
      }
      const driveMatch = fetchUrl.match(/\/file\/d\/([^/]+)/);
      if (driveMatch) {
        fetchUrl = `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
      } else if (fetchUrl.includes("drive.google.com/open?id=")) {
        const id = fetchUrl.split("id=")[1]?.split("&")[0];
        if (id) fetchUrl = `https://drive.google.com/uc?export=download&id=${id}`;
      }

      const r = await fetch(fetchUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      csv = await r.text();
      _cache = { url: key, data: csv, ts: now };
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Scripps AWN CSV fetch failed (${key}): ${detail}`);
  }

  const reading = parseAwnCSV(csv);
  if (!reading) {
    throw new Error(
      "Scripps AWN CSV has no valid rows (need outdoor temperature + humidity columns).",
    );
  }

  return {
    ...reading,
    distanceKm: haversineKm(userLat, userLon, reading.lat, reading.lon),
  };
}
