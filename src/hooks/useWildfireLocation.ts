import { useState } from "react";
import { useGeolocation } from "./useGeolocation";

export type ManualPlace = {
  lat: number;
  lon: number;
  label: string;
};

/**
 * GPS by default, or a user-picked place (geocode). Coordinates drive weather + risk + map.
 */
export function useWildfireLocation() {
  const geo = useGeolocation();
  const [manual, setManual] = useState<ManualPlace | null>(null);

  const lat = manual?.lat ?? geo.lat;
  const lon = manual?.lon ?? geo.lon;

  const placeLabel = manual
    ? manual.label
    : geo.lat != null && geo.lon != null
      ? "Current location (GPS)"
      : null;

  function setManualPlace(m: ManualPlace) {
    setManual(m);
  }

  function clearManualUseGps() {
    setManual(null);
  }

  return {
    lat,
    lon,
    placeLabel,
    isManual: manual != null,
    setManualPlace,
    clearManualUseGps,
    geoErr: geo.err,
    gpsPending: !manual && geo.lat == null,
  };
}
