import { useEffect, useState } from "react";

export function useGeolocation() {
  const [lat, setLat] = useState<number | null>(null);
  const [lon, setLon] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setErr("Geolocation not supported");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setLat(p.coords.latitude);
        setLon(p.coords.longitude);
        setErr(null);
      },
      (e) => setErr(e.message),
      { enableHighAccuracy: true, maximumAge: 60_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return { lat, lon, err };
}
