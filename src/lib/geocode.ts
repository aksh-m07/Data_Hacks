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
