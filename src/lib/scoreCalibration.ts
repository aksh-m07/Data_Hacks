/**
 * ONNX regressor outputs often cluster (~11–14 raw → ~52–63 calibrated) for similar coastal
 * conditions — that is the model, not a bug. The headline gauge uses tenDayWildfireProbability.ts
 * to blend this with live environmental stress so the UI is not stuck in a narrow band.
 *
 * rawScore = model output before this step; debug panel shows raw unchanged.
 */
export function calibrateRiskScore(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  // raw ~3 → ~25, raw ~11 → ~53, raw ≥24.6 → 100 cap
  const stretched = 14 + raw * 3.5;
  return Math.max(0, Math.min(100, stretched));
}
