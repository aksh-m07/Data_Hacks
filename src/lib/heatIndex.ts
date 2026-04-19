/** Heat index (°F) from temperature (°F) and relative humidity (%). NOAA approximation. */
export function heatIndexF(tempF: number, rh: number): number {
  if (tempF < 80) return tempF;
  const T = tempF;
  const R = rh;
  const HI =
    -42.379 +
    2.04901523 * T +
    10.14333127 * R -
    0.22475541 * T * R -
    6.83783e-3 * T * T -
    5.481717e-2 * R * R +
    1.22874e-3 * T * T * R +
    8.5282e-4 * T * R * R -
    1.99e-6 * T * T * R * R;
  return Math.round(HI * 10) / 10;
}
