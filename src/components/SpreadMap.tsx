import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker } from "react-leaflet";
import L from "leaflet";
import { destinationPoint, sectorRing } from "../lib/geo";
import { fetchEvacRoute } from "../lib/osrm";
import { useState } from "react";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

type Props = {
  lat: number;
  lon: number;
  windFromDeg: number;
};

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
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <CircleMarker
          center={[lat, lon]}
          radius={8}
          pathOptions={{ color: "#f97316", fillColor: "#fb923c", fillOpacity: 0.9 }}
        />
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
