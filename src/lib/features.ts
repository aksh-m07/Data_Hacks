import { heatIndexF } from "./heatIndex";
import { fetchOpenMeteoCurrent } from "./openMeteo";
import { fetchAirQuality } from "./airQuality";
import { fetchScrippsNearest } from "./scripps";
import { fetchNearestCalFire } from "./firmsFireData";

export type RawFeatures = {
  tempF: number;
  humidity: number;
  heatIndex: number;
  windMph: number;
  windDirDeg: number;
  aqi: number;
  vegetationDryness: number;
  soilMoisture: number; // m³/m³ from Open-Meteo
  hour: number;
  month: number;
  distanceToRecentFireKm: number;
};

/** Fallback reference: Camp Fire area centroid — used when no FIRMS hotspot found nearby. */
const FALLBACK_FIRE = { lat: 39.76, lon: -121.82, distKm: 500 };

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

function drynessFromSeasonAndHumidity(month: number, humidity: number, soilMoisture: number): number {
  const fireSeason = month >= 6 && month <= 11;
  const base = fireSeason ? 0.55 : 0.25;
  const humidityFactor = (1 - humidity / 100) * 0.35;
  // Dry soil (< 0.1 m³/m³) adds significantly to fuel dryness
  const soilFactor = Math.max(0, (0.25 - soilMoisture) / 0.25) * 0.2;
  return Math.min(1, base + humidityFactor + soilFactor);
}

/** UCSD AWN snapshot — always fetched (challenge dataset); may differ from local model inputs. */
export type ScrippsRef = {
  stationId: string;
  tempF: number;
  humidity: number;
  windMph: number;
  windDir: number;
  distanceKm: number;
};

export type FeaturesMeta = {
  aqSource: string;
  /** Short label for what drives the headline metrics + ONNX inputs. */
  wxSource: string;
  /** Scripps AWN readings (mandatory load); shown separately from local model weather. */
  scrippsRef: ScrippsRef;
  firmsHotspots: number;
  nearestFireKm: number | null;
};

export async function gatherLiveFeatures(
  lat: number,
  lon: number,
): Promise<{ raw: RawFeatures; meta: FeaturesMeta }> {
  const [wx, aq, scripps, firms] = await Promise.all([
    fetchOpenMeteoCurrent(lat, lon),
    fetchAirQuality(lat, lon),
    fetchScrippsNearest(lat, lon),
    fetchNearestCalFire(lat, lon),
  ]);

  const now = new Date();
  const hour = now.getHours();
  const month = now.getMonth() + 1;

  // ONNX risk score uses local Open-Meteo at (lat, lon) so the value changes with place & time.
  // Scripps AWN is still loaded every time (mandatory challenge dataset) — see meta.scrippsRef.
  const tempF = wx.tempF;
  const rh = Math.max(5, Math.min(99, wx.relativeHumidity));
  const hi = heatIndexF(tempF, rh);
  const soilMoisture = Math.max(0, Math.min(0.5, wx.soilMoisture));

  // FIRMS: use nearest real fire if ≤ 800km, else fallback reference
  const distFire =
    firms.nearest !== null
      ? firms.nearest.distanceKm
      : haversineKm(lat, lon, FALLBACK_FIRE.lat, FALLBACK_FIRE.lon);

  const raw: RawFeatures = {
    tempF,
    humidity: rh,
    heatIndex: hi,
    windMph: wx.windMph,
    windDirDeg: wx.windDirDeg,
    aqi: aq.aqi,
    vegetationDryness: drynessFromSeasonAndHumidity(month, rh, soilMoisture),
    soilMoisture,
    hour,
    month,
    distanceToRecentFireKm: distFire,
  };

  return {
    raw,
    meta: {
      aqSource: aq.source,
      wxSource: "Local weather (Open-Meteo) — drives risk score",
      scrippsRef: {
        stationId: scripps.stationId,
        tempF: scripps.tempF,
        humidity: scripps.humidity,
        windMph: scripps.windMph,
        windDir: scripps.windDir,
        distanceKm: scripps.distanceKm,
      },
      firmsHotspots: firms.totalInState,
      nearestFireKm: firms.nearest ? Math.round(firms.nearest.distanceKm) : null,
    },
  };
}

/**
 * 11-feature normalized vector — must match `scripts/export_onnx.py` training pipeline.
 * soilMoisture is used in vegetationDryness computation but not passed as a separate feature
 * to preserve compatibility with the existing 11-feature ONNX model.
 */
export function toModelInput(r: RawFeatures): Float32Array {
  return new Float32Array([
    r.tempF / 120,
    r.humidity / 100,
    r.heatIndex / 130,
    r.windMph / 60,
    Math.sin((r.windDirDeg * Math.PI) / 180),
    Math.cos((r.windDirDeg * Math.PI) / 180),
    r.aqi / 500,
    r.vegetationDryness,
    r.hour / 24,
    (r.month - 1) / 11,
    Math.min(1, r.distanceToRecentFireKm / 800),
  ]);
}

export function riskClass(score: number): "LOW" | "MODERATE" | "HIGH" | "CRITICAL" {
  if (score < 30) return "LOW";
  if (score < 60) return "MODERATE";
  if (score < 80) return "HIGH";
  return "CRITICAL";
}

export function topContributions(
  importances: number[],
  labels: string[],
): { label: string; pct: number }[] {
  const pairs = importances.map((v, i) => ({ v, l: labels[i] }));
  pairs.sort((a, b) => b.v - a.v);
  const top = pairs.slice(0, 3);
  const sum = top.reduce((s, x) => s + x.v, 0) || 1;
  return top.map((x) => ({ label: x.l, pct: Math.round((x.v / sum) * 100) }));
}

export const FEATURE_LABELS = [
  "Temperature",
  "Humidity",
  "Heat index",
  "Wind speed",
  "Wind dir (sin)",
  "Wind dir (cos)",
  "AQI",
  "Vegetation dryness",
  "Hour",
  "Month",
  "Fire distance",
];

