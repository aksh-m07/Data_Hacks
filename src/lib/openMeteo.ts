/** Current weather + soil moisture — Open-Meteo, no API key. */

export type OpenMeteoCurrent = {
  tempF: number;
  relativeHumidity: number;
  windMph: number;
  windDirDeg: number;
  soilMoisture: number; // m³/m³, top 1cm layer
};

export async function fetchOpenMeteoCurrent(
  lat: number,
  lon: number,
): Promise<OpenMeteoCurrent> {
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lon));
  u.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,soil_moisture_0_to_1cm",
  );
  u.searchParams.set("temperature_unit", "fahrenheit");
  u.searchParams.set("wind_speed_unit", "mph");
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
  const j = (await r.json()) as {
    current: {
      temperature_2m: number;
      relative_humidity_2m: number;
      wind_speed_10m: number;
      wind_direction_10m: number;
      soil_moisture_0_to_1cm: number;
    };
  };
  const c = j.current;
  return {
    tempF: c.temperature_2m,
    relativeHumidity: c.relative_humidity_2m,
    windMph: c.wind_speed_10m,
    windDirDeg: c.wind_direction_10m,
    soilMoisture: c.soil_moisture_0_to_1cm ?? 0.2,
  };
}
