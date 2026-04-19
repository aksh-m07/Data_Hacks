import { useEffect, useState } from "react";
import { reverseGeocodePlaceName } from "../lib/geocode";

type Props = {
  lat: number | null;
  lon: number | null;
  /** From GPS or a searched place (Wildfire / Survivor location hook). */
  placeLabel?: string | null;
  /** Browser geolocation error message when GPS fails or is denied. */
  geoErr?: string | null;
};

/**
 * Shows a human-readable place from reverse geocoding (coordinates → name),
 * with coordinates as secondary detail. Used when smoke alarm fires.
 * Props must come from the live location hook so updates after GPS/search are reflected.
 */
export function AlarmLocationPanel({ lat, lon, placeLabel, geoErr }: Props) {
  const [headline, setHeadline] = useState<string>("Looking up location…");
  const [coordsLine, setCoordsLine] = useState<string | null>(null);

  useEffect(() => {
    if (lat == null || lon == null) {
      setHeadline("Location not available");
      setCoordsLine(null);
      return;
    }

    setCoordsLine(`${lat.toFixed(5)}°, ${lon.toFixed(5)}°`);
    let cancelled = false;

    (async () => {
      const resolved = await reverseGeocodePlaceName(lat, lon);
      if (cancelled) return;
      if (resolved) {
        setHeadline(resolved);
      } else if (placeLabel) {
        setHeadline(placeLabel);
      } else {
        setHeadline("Location (coordinates below)");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lat, lon, placeLabel]);

  return (
    <div className="alarm-toast-location">
      <p className="alarm-toast-place">{headline}</p>
      {coordsLine ? (
        <p className="alarm-toast-coords">
          <span className="alarm-toast-coords-label">Coordinates</span>
          {coordsLine}
        </p>
      ) : (
        <p className="alarm-toast-coords alarm-toast-coords--muted">
          {geoErr
            ? `Location blocked: ${geoErr} Use Search under Location on Wildfire station to set a place.`
            : "Allow location when the browser asks, or use Search under Location on this page to pick a city or region."}
        </p>
      )}
    </div>
  );
}
