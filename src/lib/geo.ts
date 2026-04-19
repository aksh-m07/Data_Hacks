export function destinationPoint(
  lat: number,
  lon: number,
  distanceKm: number,
  bearingDeg: number,
): [number, number] {
  const R = 6371;
  const brng = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const δ = distanceKm / R;
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const sinφ2 =
    sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(brng);
  const φ2 = Math.asin(sinφ2);
  const y = Math.sin(brng) * sinδ * cosφ1;
  const x = cosδ - sinφ1 * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);
  return [(φ2 * 180) / Math.PI, ((λ2 * 180) / Math.PI + 540) % 360 - 180];
}

export function sectorRing(
  lat: number,
  lon: number,
  radiusKm: number,
  centerBearing: number,
  halfWidthDeg: number,
  segments = 24,
): [number, number][] {
  const pts: [number, number][] = [[lat, lon]];
  const start = centerBearing - halfWidthDeg;
  const end = centerBearing + halfWidthDeg;
  for (let i = 0; i <= segments; i++) {
    const brng = start + ((end - start) * i) / segments;
    pts.push(destinationPoint(lat, lon, radiusKm, brng));
  }
  return pts;
}
