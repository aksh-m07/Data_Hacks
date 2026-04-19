"""
Build training matrices from real sources (must match src/lib/features.ts normalization).

Sources:
- NOAA Storm Events: California Wildfire rows (federal incident records)
- CNRA GIS: CAL FIRE / NIFC perimeter GeoJSON (state open data, public download)
- Open-Meteo Archive + Air Quality APIs: historical weather and AQI (no key)
- OpenStreetMap Nominatim: geocode CZ_NAME -> lat/lon when points missing (rate-limited)

Negative (background) samples: random locations/dates in CA with low severity labels
derived from real weather only (no synthetic feature vectors).
"""

from __future__ import annotations

import io
import json
import math
import os
import random
import ssl
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

import certifi
import numpy as np
import pandas as pd
import requests

# California bounding box (continental)
CA_WEST, CA_SOUTH, CA_EAST, CA_NORTH = -124.5, 32.5, -114.0, 42.0
REF_FIRE_LAT, REF_FIRE_LON = 39.76, -121.82

NOAA_STORM_URL = (
    "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
    "StormEvents_details-ftp_v1.0_d2020_c20260323.csv.gz"
)
CNRA_GEOJSON_URL = (
    "https://gis.data.cnra.ca.gov/api/download/v1/items/"
    "025fb2ea05f14890b2b11573341b5b18/geojson?layers=0"
)

SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": "GroundZeroTraining/1.0 (hackathon; contact: local)",
        "Accept": "application/json",
    }
)


def _ssl_ctx() -> ssl.SSLContext:
    return ssl.create_default_context(cafile=certifi.where())


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def heat_index_f(temp_f: float, rh: float) -> float:
    if temp_f < 80:
        return temp_f
    t, r = temp_f, rh
    hi = (
        -42.379
        + 2.04901523 * t
        + 10.14333127 * r
        - 0.22475541 * t * r
        - 6.83783e-3 * t * t
        - 5.481717e-2 * r * r
        + 1.22874e-3 * t * t * r
        + 8.5282e-4 * t * r * r
        - 1.99e-6 * t * t * r * r
    )
    return round(hi * 10) / 10


def dryness(month: int, rh: float) -> float:
    fire_season = 6 <= month <= 11
    base = 0.55 if fire_season else 0.25
    return min(1.0, base + (1 - rh / 100.0) * 0.45)


def to_model_row(
    temp_f: float,
    rh: float,
    wind_mph: float,
    wind_deg: float,
    aqi: float,
    hour: int,
    month: int,
    dist_km: float,
) -> np.ndarray:
    hi = heat_index_f(temp_f, rh)
    return np.array(
        [
            temp_f / 120.0,
            rh / 100.0,
            hi / 130.0,
            wind_mph / 60.0,
            math.sin(math.radians(wind_deg)),
            math.cos(math.radians(wind_deg)),
            aqi / 500.0,
            dryness(month, rh),
            hour / 24.0,
            (month - 1) / 11.0,
            min(1.0, dist_km / 800.0),
        ],
        dtype=np.float32,
    )


def fetch_open_meteo_archive(
    lat: float, lon: float, day: str, hour_pick: int
) -> dict[str, float] | None:
    """day = YYYY-MM-DD. Returns hourly slice."""
    u = (
        "https://archive-api.open-meteo.com/v1/archive?"
        f"latitude={lat}&longitude={lon}"
        f"&start_date={day}&end_date={day}"
        "&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m"
        "&temperature_unit=fahrenheit&wind_speed_unit=mph"
    )
    try:
        r = SESSION.get(u, timeout=60)
        r.raise_for_status()
        j = r.json()
        h = j["hourly"]
        times = h["time"]
        idx = min(max(hour_pick, 0), len(times) - 1)
        return {
            "temp_f": float(h["temperature_2m"][idx]),
            "rh": float(h["relative_humidity_2m"][idx]),
            "wind_mph": float(h["wind_speed_10m"][idx]),
            "wind_deg": float(h["wind_direction_10m"][idx]),
        }
    except Exception:
        return None


def fetch_open_meteo_aqi(lat: float, lon: float, day: str, hour_pick: int) -> float:
    u = (
        "https://air-quality-api.open-meteo.com/v1/air-quality?"
        f"latitude={lat}&longitude={lon}"
        f"&hourly=us_aqi&start_date={day}&end_date={day}"
    )
    try:
        r = SESSION.get(u, timeout=60)
        r.raise_for_status()
        j = r.json()
        h = j.get("hourly") or {}
        arr = h.get("us_aqi") or [50.0]
        idx = min(max(hour_pick, 0), len(arr) - 1)
        return float(arr[idx])
    except Exception:
        return 50.0


def load_noaa_ca_wildfires() -> pd.DataFrame:
    with urllib.request.urlopen(NOAA_STORM_URL, context=_ssl_ctx(), timeout=300) as resp:
        raw = resp.read()
    df = pd.read_csv(io.BytesIO(raw), compression="gzip", low_memory=False)
    ca = df[(df["STATE"] == "CALIFORNIA") & (df["EVENT_TYPE"] == "Wildfire")].copy()
    return ca


def load_cnra_points() -> list[dict[str, Any]]:
    r = SESSION.get(CNRA_GEOJSON_URL, timeout=120)
    r.raise_for_status()
    gj = r.json()
    out: list[dict[str, Any]] = []
    for ft in gj.get("features", []):
        geom = ft.get("geometry")
        props = ft.get("properties") or {}
        if not geom or geom.get("type") != "MultiPolygon":
            continue
        coords = geom["coordinates"][0][0]
        if not coords:
            continue
        lon = sum(c[0] for c in coords) / len(coords)
        lat = sum(c[1] for c in coords) / len(coords)
        acres = float(props.get("area_acres") or 0)
        fdd = props.get("FireDiscoveryDate") or props.get("CreationDate") or props.get(
            "poly_DateCurrent"
        )
        out.append({"lat": lat, "lon": lon, "acres": acres, "date_str": fdd})
    return out


def parse_flexible_date(s: str | float | None) -> tuple[str, int] | None:
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return None
    st = str(s).strip()
    if not st:
        return None
    dt = pd.to_datetime(st, utc=True, errors="coerce")
    if pd.isna(dt):
        return None
    return dt.strftime("%Y-%m-%d"), int(dt.hour)


def geocode_nominatim(
    query: str, cache: dict[str, tuple[float, float] | None]
) -> tuple[float, float] | None:
    q = query.strip()
    if not q:
        return None
    if q in cache:
        return cache[q]
    params = urllib.parse.urlencode(
        {"q": q + ", California, USA", "format": "json", "limit": 1}
    )
    url = f"https://nominatim.openstreetmap.org/search?{params}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "GroundZeroTraining/1.0 (educational; rate-limited)",
        },
    )
    try:
        with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=30) as resp:
            data = json.loads(resp.read().decode())
        time.sleep(1.1)  # Nominatim usage policy
        if not data:
            cache[q] = None
            return None
        lat = float(data[0]["lat"])
        lon = float(data[0]["lon"])
        cache[q] = (lat, lon)
        return lat, lon
    except Exception:
        cache[q] = None
        return None


def severity_from_acres(acres: float) -> float:
    acres = max(0.0, acres)
    return float(np.clip(100.0 * np.log1p(acres) / np.log1p(500_000.0), 0.0, 100.0))


def background_severity_from_weather(row: np.ndarray, rng: np.random.RandomState) -> float:
    """Low–mid severity label from normalized features (real weather), for negatives."""
    t, rh, hi_n, wspd, _, _, aqi_n, dry, _, _, _ = [float(x) for x in row]
    noise = rng.randn() * 2.5
    return float(
        np.clip(
            22 * t
            + 16 * wspd
            + 14 * aqi_n
            + 12 * dry
            + 10 * (1 - rh)
            + 8 * hi_n
            + noise,
            5,
            58,
        )
    )


@dataclass
class BuildConfig:
    max_noaa_geocode: int = 120
    neg_samples: int = 2500
    seed: int = 42


def build_xy(cfg: BuildConfig) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.RandomState(cfg.seed)
    X_list: list[np.ndarray] = []
    y_list: list[float] = []

    geo_cache: dict[str, tuple[float, float] | None] = {}

    # --- CNRA perimeter-derived samples (exact coordinates) ---
    for pt in load_cnra_points():
        parsed = parse_flexible_date(pt["date_str"])
        if not parsed:
            day, hour = "2020-08-15", 18
        else:
            day, hour = parsed
        wx = fetch_open_meteo_archive(pt["lat"], pt["lon"], day, hour)
        if wx is None:
            continue
        aqi = fetch_open_meteo_aqi(pt["lat"], pt["lon"], day, hour)
        dist_km = haversine_km(pt["lat"], pt["lon"], REF_FIRE_LAT, REF_FIRE_LON)
        row = to_model_row(
            wx["temp_f"],
            wx["rh"],
            wx["wind_mph"],
            wx["wind_deg"],
            aqi,
            hour,
            int(day[5:7]),
            dist_km,
        )
        X_list.append(row)
        y_list.append(severity_from_acres(pt["acres"]))

    # --- NOAA wildfires: geocode zone name, real incident dates ---
    noaa = load_noaa_ca_wildfires()
    count = 0
    for _, r in noaa.iterrows():
        if count >= cfg.max_noaa_geocode:
            break
        parsed = parse_flexible_date(r.get("BEGIN_DATE_TIME"))
        if not parsed:
            continue
        day, hour = parsed
        cz = str(r.get("CZ_NAME") or "").strip()
        if not cz:
            continue
        g = geocode_nominatim(cz, geo_cache)
        if g is None:
            continue
        lat, lon = g
        wx = fetch_open_meteo_archive(lat, lon, day, hour)
        if wx is None:
            continue
        aqi = fetch_open_meteo_aqi(lat, lon, day, hour)
        dist_km = haversine_km(lat, lon, REF_FIRE_LAT, REF_FIRE_LON)
        row = to_model_row(
            wx["temp_f"],
            wx["rh"],
            wx["wind_mph"],
            wx["wind_deg"],
            aqi,
            hour,
            int(day[5:7]),
            dist_km,
        )
        X_list.append(row)
        mag = pd.to_numeric(r.get("MAGNITUDE"), errors="coerce")
        acres = float(mag) if pd.notna(mag) and mag > 0 else 500.0
        y_list.append(severity_from_acres(acres))
        count += 1
        time.sleep(0.15)

    # --- Negative / background samples: random CA points + summer-fall dates ---
    neg_added = 0
    neg_attempts = 0
    max_attempts = max(cfg.neg_samples * 8, cfg.neg_samples + 500)
    while neg_added < cfg.neg_samples and neg_attempts < max_attempts:
        neg_attempts += 1
        lat = rng.uniform(CA_SOUTH, CA_NORTH)
        lon = rng.uniform(CA_WEST, CA_EAST)
        month = int(rng.randint(6, 11))
        dayn = int(rng.randint(1, 28))
        year = int(rng.choice([2018, 2019, 2020, 2021, 2022, 2023]))
        day = f"{year}-{month:02d}-{dayn:02d}"
        hour = int(rng.randint(10, 20))
        wx = fetch_open_meteo_archive(lat, lon, day, hour)
        if wx is None:
            time.sleep(0.02)
            continue
        aqi = fetch_open_meteo_aqi(lat, lon, day, hour)
        dist_km = haversine_km(lat, lon, REF_FIRE_LAT, REF_FIRE_LON)
        row = to_model_row(
            wx["temp_f"],
            wx["rh"],
            wx["wind_mph"],
            wx["wind_deg"],
            aqi,
            hour,
            month,
            dist_km,
        )
        X_list.append(row)
        y_list.append(background_severity_from_weather(row, rng))
        neg_added += 1
        time.sleep(0.05)

    if len(X_list) < 30:
        raise RuntimeError(
            f"Too few training rows ({len(X_list)}). Check network / API limits."
        )

    X = np.stack(X_list, axis=0).astype(np.float32)
    y = np.array(y_list, dtype=np.float32)
    return X, y
