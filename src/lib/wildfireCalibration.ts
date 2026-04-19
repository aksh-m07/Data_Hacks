/**
 * Geographic region where the ONNX wildfire model was trained (Western US wildfire context).
 * Outside this box, scores are not calibrated — UI shows "OUT OF RANGE".
 *
 * Approximate bbox: Pacific to eastern Rockies, southern US border to ~49°N.
 */
export function isWildfireModelInRange(lat: number, lon: number): boolean {
  return lat >= 31.0 && lat <= 49.5 && lon >= -125.0 && lon <= -102.0;
}
