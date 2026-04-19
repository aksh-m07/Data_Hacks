/** ~100 m rounding — matches wildfire scheduling / storage keys. */
export function stableLocationKey(lat: number | null, lon: number | null): string | null {
  if (lat == null || lon == null) return null;
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}
