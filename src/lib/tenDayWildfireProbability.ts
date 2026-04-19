import type { RawFeatures } from "./features";

export type TenDayEstimateInput = {
  /** ONNX calibrated index 0–100 (same pipeline as before). */
  calibratedScore: number;
  raw: RawFeatures;
  nearestFireKm: number | null;
  /** Count of CA FIRMS hotspots in window (regional activity). */
  firmsHotspots: number;
};

/**
 * Heuristic 0–100% shown as “wildfire in the next ~10 days” in the UI.
 * Blends the risk model index with dryness, wind, smoke, distance to hotspots,
 * regional fire counts, and season. Not a certified forecast — demo / decision-support only.
 */
export function estimateTenDayWildfireProbabilityPercent(input: TenDayEstimateInput): number {
  const { calibratedScore, raw, nearestFireKm, firmsHotspots } = input;

  // Model index — damped so a saturated ONNX score alone rarely dominates the whole gauge
  const indexPart = Math.min(44, Math.pow(Math.max(0, calibratedScore) / 100, 0.82) * 50);

  const dryPart = raw.vegetationDryness * 20;
  const windPart = Math.min(14, (raw.windMph / 45) * 14);
  const smokePart = Math.min(9, (raw.aqi / 250) * 9);

  let fireProximityPart = 0;
  if (nearestFireKm != null && nearestFireKm < 240) {
    fireProximityPart = (1 - nearestFireKm / 240) * 26;
  }
  const regionalActivity = Math.min(11, Math.log1p(Math.max(0, firmsHotspots)) * 2.4);

  const m = raw.month;
  const seasonPrior = m >= 6 && m <= 10 ? 9 : m === 5 || m === 11 ? 6 : 4;

  const sum =
    indexPart + dryPart + windPart + smokePart + fireProximityPart + regionalActivity + seasonPrior;
  return Math.round(Math.max(0, Math.min(94, sum)));
}
