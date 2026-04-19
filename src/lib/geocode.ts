/** Open-Meteo geocoding — no API key, global place search. */

export type GeocodeHit = {
  name: string;
  label: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
};

type OmResult = {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
};

export async function searchPlaces(query: string): Promise<GeocodeHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const u = new URL("https://geocoding-api.open-meteo.com/v1/search");
  u.searchParams.set("name", q);
  u.searchParams.set("count", "10");
  u.searchParams.set("language", "en");
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`Geocoding failed (${r.status})`);
  const j = (await r.json()) as { results?: OmResult[] };
  const rows = j.results ?? [];
  return rows.map((row) => {
    const parts = [row.name, row.admin1, row.country].filter(Boolean);
    return {
      name: row.name,
      label: parts.join(", "),
      latitude: row.latitude,
      longitude: row.longitude,
      country: row.country,
      admin1: row.admin1,
    };
  });
}

/** Browser-friendly reverse geocode (coordinates → place name). No API key. */
export async function reverseGeocodePlaceName(lat: number, lon: number): Promise<string | null> {
  try {
    const u = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
    u.searchParams.set("latitude", String(lat));
    u.searchParams.set("longitude", String(lon));
    u.searchParams.set("localityLanguage", "en");
    const r = await fetch(u.toString());
    if (!r.ok) return null;
    const j = (await r.json()) as {
      locality?: string;
      city?: string;
      principalSubdivision?: string;
      countryName?: string;
    };
    const place = j.locality?.trim() || j.city?.trim();
    const parts = [place, j.principalSubdivision, j.countryName].filter(
      (x): x is string => typeof x === "string" && x.trim().length > 0,
    );
    if (parts.length === 0) return null;
    const deduped: string[] = [];
    for (const p of parts) {
      if (!deduped.some((d) => d.toLowerCase() === p.toLowerCase())) deduped.push(p);
    }
    return deduped.join(", ");
  } catch {
    return null;
  }
}
