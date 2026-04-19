import type { RawFeatures } from "./features";

export type TenDayEstimateInput = {
  /** ONNX calibrated index 0–100 (see scoreCalibration.ts). */
  calibratedScore: number;
  /** Raw regressor output — when stuck ~11–14 the model has little spread; we lean on live weather. */
  rawOnnxScore?: number;
  raw: RawFeatures;
  nearestFireKm: number | null;
  /** Count of CA FIRMS hotspots in window (regional activity). */
  firmsHotspots: number;
};

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Live environmental / fuel stress on a 0–~96 scale (not the ONNX path).
 * Strong sensitivity to heat, low RH, fuels, wind, smoke, and distance to detected heat.
 */
export function computeEnvironmentalWildfireIndex(
  raw: RawFeatures,
  nearestFireKm: number | null,
  firmsHotspots: number,
): number {
  const tempStress = clamp01((raw.tempF - 48) / 62) * 30;
  const rhStress = clamp01((100 - raw.humidity) / 85) * 22;
  const fuel = raw.vegetationDryness * 24;
  const wind = Math.min(17, (raw.windMph / 48) * 17);
  const smoke = Math.min(13, (raw.aqi / 220) * 13);

  let prox = 0;
  if (nearestFireKm != null && nearestFireKm < 280) {
    prox = (1 - nearestFireKm / 280) * 28;
  }

  const regional = Math.min(12, Math.log1p(Math.max(0, firmsHotspots)) * 2.5);

  const m = raw.month;
  const season = m >= 6 && m <= 10 ? 10 : m === 5 || m === 11 ? 7 : 4;

  const sum = tempStress + rhStress + fuel + wind + smoke + prox + regional + season;
  return Math.min(96, sum);
}

/** Higher weight when ONNX output is outside the usual saturated band (training often clusters ~11–14). */
function onnxBlendWeight(rawOnnxScore: number | undefined): number {
  if (rawOnnxScore == null || !Number.isFinite(rawOnnxScore)) return 0.32;
  if (rawOnnxScore >= 10.5 && rawOnnxScore <= 14.5) return 0.18;
  return 0.38;
}

/**
 * Heuristic 0–100% shown as “wildfire in the next ~10 days” in the UI.
 * Blends ONNX with a live environmental index so the gauge is not stuck ~58–62 when the
 * regressor output barely moves (common for mild coastal inputs on the shipped model).
 */
export function estimateTenDayWildfireProbabilityPercent(input: TenDayEstimateInput): number {
  const { calibratedScore, rawOnnxScore, raw, nearestFireKm, firmsHotspots } = input;
  const env = computeEnvironmentalWildfireIndex(raw, nearestFireKm, firmsHotspots);
  const w = onnxBlendWeight(rawOnnxScore);
  const blended = w * calibratedScore + (1 - w) * env;
  return Math.round(Math.max(0, Math.min(94, blended)));
}
