/**
 * ONNX regressor outputs are often single digits for mild coastal weather (e.g. San Diego),
 * which would otherwise show as ~12/100 after a weak stretch. Map monotonically to a clearer
 * 0–100 risk index — not a literal “probability %” of fire.
 *
 * rawScore = model output before this step; debug panel shows raw unchanged.
 */
export function calibrateRiskScore(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  // raw ~3 → ~25, raw ~11 → ~53, raw ≥24.6 → 100 cap
  const stretched = 14 + raw * 3.5;
  return Math.max(0, Math.min(100, stretched));
}
