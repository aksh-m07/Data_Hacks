/** Real-time AQI / PM2.5: AirNow if key set, else Open-Meteo (no key). */

export type AirQualityLive = {
  aqi: number;
  pm25: number;
  category: string;
  source: "airnow" | "open-meteo";
};

function aqiCategory(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

async function fetchOpenMeteoAQI(
  lat: number,
  lon: number,
): Promise<AirQualityLive> {
  const u = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lon));
  u.searchParams.set("current", "us_aqi,pm2_5");
  u.searchParams.set("timezone", "auto");
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`Open-Meteo AQ ${r.status}`);
  const j = (await r.json()) as {
    current: { us_aqi: number; pm2_5: number };
  };
  const aqi = Math.round(j.current.us_aqi);
  return {
    aqi,
    pm25: j.current.pm2_5,
    category: aqiCategory(aqi),
    source: "open-meteo",
  };
}

async function fetchAirNow(lat: number, lon: number, key: string) {
  const u = new URL(
    "https://www.airnowapi.org/aq/observation/latLong/current/",
  );
  u.searchParams.set("format", "application/json");
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lon));
  u.searchParams.set("API_KEY", key);
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`AirNow ${r.status}`);
  const arr = (await r.json()) as Array<{
    AQI: number;
    ParameterName: string;
    Category?: { Name: string };
  }>;
  const pm = arr.find((x) => x.ParameterName === "PM2.5") ?? arr[0];
  const aqi = pm?.AQI ?? 0;
  return {
    aqi,
    pm25: 0,
    category: pm?.Category?.Name ?? aqiCategory(aqi),
    source: "airnow" as const,
  };
}

export async function fetchAirQuality(
  lat: number,
  lon: number,
): Promise<AirQualityLive> {
  const key = import.meta.env.VITE_AIRNOW_API_KEY;
  if (key) {
    try {
      return await fetchAirNow(lat, lon, key);
    } catch {
      return fetchOpenMeteoAQI(lat, lon);
    }
  }
  return fetchOpenMeteoAQI(lat, lon);
}
