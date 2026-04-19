/**
 * Current map / dashboard location (GPS or searched place) for smoke-alarm overlay.
 * Updated by whichever dashboard is mounted (Wildfire or Survivor).
 */
export type LiveMapSnapshot = {
  lat: number | null;
  lon: number | null;
  /** Geocode label or "Current location (GPS)" */
  label: string | null;
};

let live: LiveMapSnapshot = { lat: null, lon: null, label: null };

export function setLiveMapLocation(lat: number | null, lon: number | null, label: string | null): void {
  live = { lat, lon, label };
}

export function getLiveMapLocation(): LiveMapSnapshot {
  return { ...live };
}
