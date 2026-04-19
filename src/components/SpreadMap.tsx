import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polygon, Polyline, Marker, useMap } from "react-leaflet";
import { destinationPoint, sectorRing, haversineKm } from "../lib/geo";
import { fetchEvacRoute } from "../lib/osrm";
import { createLandmarkMapIcon } from "./LandmarkGlyph";

type Props = {
  lat: number;
  lon: number;
  windFromDeg: number;
};

/** `MapContainer` only uses initial center — keep view in sync when GPS or search updates coords. */
function MapViewSync({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const prev = useRef<[number, number] | null>(null);

  useEffect(() => {
    const next: [number, number] = [lat, lon];
    const p = prev.current;
    if (!p) {
      map.setView(next, map.getZoom(), { animate: false });
      prev.current = next;
      return;
    }
    const distKm = haversineKm(p[0], p[1], lat, lon);
    if (distKm > 1.5) {
      map.flyTo(next, map.getZoom(), { duration: 1.1 });
    } else if (distKm > 0.08) {
      map.panTo(next, { animate: false });
    }
    prev.current = next;
  }, [lat, lon, map]);

  return null;
}

export function SpreadMap({ lat, lon, windFromDeg }: Props) {
  const spread = (windFromDeg + 180) % 360;
  const cone = useMemo(
    () => sectorRing(lat, lon, 12, spread, 28),
    [lat, lon, spread],
  );

  const evacEnd = useMemo(
    () => destinationPoint(lat, lon, 6, windFromDeg),
    [lat, lon, windFromDeg],
  );

  const [route, setRoute] = useState<[number, number][] | null>(null);

  const landmarkIcon = useMemo(() => createLandmarkMapIcon(), []);

  useEffect(() => {
    let cancelled = false;
    fetchEvacRoute(lat, lon, evacEnd[0], evacEnd[1]).then((r) => {
      if (!cancelled && r) setRoute(r.coords);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lon, evacEnd]);

  return (
    <div className="map-box">
      <MapContainer
        center={[lat, lon]}
        zoom={11}
        className="leaflet-map"
        scrollWheelZoom
      >
        <MapViewSync lat={lat} lon={lon} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[lat, lon]} icon={landmarkIcon} />
        <Polygon positions={cone} pathOptions={{ color: "#ea580c", fillOpacity: 0.25 }} />
        {route && route.length > 1 ? (
          <Polyline positions={route} pathOptions={{ color: "#22c55e", weight: 5 }} />
        ) : (
          <Polyline
            positions={[
              [lat, lon],
              [evacEnd[0], evacEnd[1]],
            ]}
            pathOptions={{ color: "#22c55e", weight: 4, dashArray: "8 6" }}
          />
        )}
      </MapContainer>
      <p className="map-caption">
        Orange cone: predicted spread toward {Math.round(spread)}° (downwind). Green:
        suggested route away from spread (OSRM when available).
      </p>
    </div>
  );
}
