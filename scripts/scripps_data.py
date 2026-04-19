"""
Scripps Institution of Oceanography – AWN/HPWREN data loader.

AWN CSV (no lat/lon columns): Outdoor Temperature (°F), Humidity (%),
Wind Speed (mph), Wind Direction (°), etc. Station AWN-84F3EB5450ED is
hardcoded at UCSD (32.88°N, 117.24°W).

Training / export:
  SCRIPPS_CSV_PATH — local file or directory of *.csv (preferred for checked-in data)
  SCRIPPS_CSV_URL  — http(s) URL or Google Drive file link (same as browser)

Examples:
  SCRIPPS_CSV_PATH=public/scripps npm run export-model
  SCRIPPS_CSV_PATH=public/scripps/AWN-84F3EB5450ED-20250814-20250815.csv npm run export-model
"""

from __future__ import annotations

import io
import math
import os
import re
from typing import Any

import numpy as np
import pandas as pd
import requests

AWN_LAT = 32.88
AWN_LON = -117.24
AWN_STATION_ID = "AWN-84F3EB5450ED"

REF_FIRE_LAT, REF_FIRE_LON = 39.76, -121.82


def _normalize(col: str) -> str:
    col = col.replace("Â", "").replace("°", "deg").replace("%", "pct")
    col = col.lower()
    col = re.sub(r"[^a-z0-9]+", "_", col)
    return col.strip("_")


def _find(headers: list[str], *candidates: str) -> int:
    for c in candidates:
        try:
            return headers.index(c)
        except ValueError:
            pass
    for c in candidates:
        for i, h in enumerate(headers):
            if c in h:
                return i
    return -1


def heat_index_f(temp_f: float, rh: float) -> float:
    if temp_f < 80:
        return temp_f
    t, r = temp_f, rh
    return round(
        (-42.379 + 2.04901523 * t + 10.14333127 * r - 0.22475541 * t * r
         - 6.83783e-3 * t * t - 5.481717e-2 * r * r + 1.22874e-3 * t * t * r
         + 8.5282e-4 * t * r * r - 1.99e-6 * t * t * r * r) * 10
    ) / 10


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
         + math.cos(p1) * math.cos(p2)
         * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def _google_drive_direct(url: str) -> str:
    if "/file/d/" in url:
        fid = url.split("/file/d/")[1].split("/")[0]
        return f"https://drive.google.com/uc?export=download&id={fid}"
    if "drive.google.com/open?id=" in url:
        fid = url.split("id=")[1].split("&")[0]
        return f"https://drive.google.com/uc?export=download&id={fid}"
    return url


def _read_csv_bytes(raw: bytes) -> pd.DataFrame | None:
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return pd.read_csv(io.BytesIO(raw), encoding=enc, low_memory=False)
        except Exception:
            continue
    return None


def _parse_awwn_dataframe(df_raw: pd.DataFrame) -> pd.DataFrame:
    if df_raw is None or df_raw.empty:
        return pd.DataFrame()

    norm_headers = [_normalize(c) for c in df_raw.columns]
    df_raw.columns = norm_headers  # type: ignore[assignment]

    temp_f_i = _find(norm_headers,
                     "outdoor_temperature_degf", "temperature_degf",
                     "temp_degf", "temp_f", "outdoor_temperature")
    feels_i = _find(norm_headers, "feels_like_degf", "feels_like")
    hum_i = _find(norm_headers, "humidity_pct", "humidity", "rh", "relative_humidity")
    wspd_i = _find(norm_headers, "wind_speed_mph", "wind_speed", "wspd_mph")
    wdir_i = _find(norm_headers, "wind_direction_degdeg", "wind_direction_deg",
                   "wind_direction", "wind_dir", "wdir")
    dt_i = _find(norm_headers, "date", "simple_date", "datetime", "timestamp")

    use_temp_i = temp_f_i if temp_f_i != -1 else feels_i

    if use_temp_i == -1 or hum_i == -1:
        print(f"[scripps] Required columns not found. Normalized headers: {norm_headers}")
        return pd.DataFrame()

    dist_km = haversine_km(AWN_LAT, AWN_LON, REF_FIRE_LAT, REF_FIRE_LON)

    rows: list[dict[str, Any]] = []
    for _, row in df_raw.iterrows():
        try:
            temp_f = float(row.iloc[use_temp_i])
            humidity = float(row.iloc[hum_i])
        except (ValueError, TypeError):
            continue
        if math.isnan(temp_f) or math.isnan(humidity):
            continue

        wind_mph = 0.0
        if wspd_i != -1:
            try:
                wind_mph = float(row.iloc[wspd_i])
                if math.isnan(wind_mph):
                    wind_mph = 0.0
            except (ValueError, TypeError):
                pass

        wind_dir = 0.0
        if wdir_i != -1:
            try:
                wind_dir = float(row.iloc[wdir_i])
                if math.isnan(wind_dir):
                    wind_dir = 0.0
            except (ValueError, TypeError):
                pass

        dt_str = str(row.iloc[dt_i]) if dt_i != -1 else ""

        rows.append({
            "lat": AWN_LAT,
            "lon": AWN_LON,
            "temp_f": temp_f,
            "humidity": humidity,
            "wind_mph": wind_mph,
            "wind_dir": wind_dir,
            "station_id": AWN_STATION_ID,
            "dt_str": dt_str,
            "dist_km": dist_km,
        })

    if not rows:
        print("[scripps] No valid rows found.")
        return pd.DataFrame()

    df = pd.DataFrame(rows)

    if dt_i != -1:
        try:
            df["_dt"] = pd.to_datetime(df["dt_str"], errors="coerce")
            df = df[df["_dt"].notna()].copy()
            df = df.sort_values("_dt").reset_index(drop=True)
            df = df.drop(columns=["_dt"], errors="ignore")
        except Exception:
            pass

    return df


def _load_from_http(url: str) -> pd.DataFrame:
    url = _google_drive_direct(url.strip())
    try:
        resp = requests.get(
            url, timeout=60,
            headers={"User-Agent": "GroundZeroTraining/1.0"},
        )
        resp.raise_for_status()
        raw = resp.content
    except Exception as e:
        print(f"[scripps] Download failed: {e}")
        return pd.DataFrame()

    df_raw = _read_csv_bytes(raw)
    if df_raw is None:
        print("[scripps] Could not parse CSV.")
        return pd.DataFrame()
    return _parse_awwn_dataframe(df_raw)


def _load_from_local_path(path: str) -> pd.DataFrame:
    path = os.path.abspath(os.path.expanduser(path.strip()))
    if os.path.isdir(path):
        frames: list[pd.DataFrame] = []
        for name in sorted(os.listdir(path)):
            if not name.lower().endswith(".csv"):
                continue
            fp = os.path.join(path, name)
            try:
                with open(fp, "rb") as f:
                    raw = f.read()
            except OSError as e:
                print(f"[scripps] Skip {fp}: {e}")
                continue
            df_raw = _read_csv_bytes(raw)
            if df_raw is None:
                print(f"[scripps] Could not parse {fp}")
                continue
            part = _parse_awwn_dataframe(df_raw)
            if not part.empty:
                frames.append(part)
                print(f"[scripps]   + {len(part)} rows from {name}")
        if not frames:
            return pd.DataFrame()
        out = pd.concat(frames, ignore_index=True)
        if "dt_str" in out.columns:
            try:
                out["_dt"] = pd.to_datetime(out["dt_str"], errors="coerce")
                out = out[out["_dt"].notna()].copy()
                out = out.sort_values("_dt").reset_index(drop=True)
                out = out.drop(columns=["_dt"], errors="ignore")
            except Exception:
                pass
        return out

    if os.path.isfile(path):
        with open(path, "rb") as f:
            raw = f.read()
        df_raw = _read_csv_bytes(raw)
        if df_raw is None:
            print("[scripps] Could not parse CSV.")
            return pd.DataFrame()
        return _parse_awwn_dataframe(df_raw)

    print(f"[scripps] Path not found: {path}")
    return pd.DataFrame()


def load_scripps_csv(source: str | None = None) -> pd.DataFrame:
    """
    Load AWN CSV from URL or local path.

    ``source`` or env ``SCRIPPS_CSV_PATH`` (file/dir) or ``SCRIPPS_CSV_URL``.
    """
    src = (source or "").strip() or os.environ.get("SCRIPPS_CSV_PATH", "").strip()
    src = src or os.environ.get("SCRIPPS_CSV_URL", "").strip()
    if not src:
        return pd.DataFrame()

    if src.startswith("http://") or src.startswith("https://"):
        df = _load_from_http(src)
    else:
        df = _load_from_local_path(src)

    if not df.empty:
        print(f"[scripps] Loaded {len(df)} rows from AWN station {AWN_STATION_ID}")
    return df


def scripps_to_training_rows(
    scripps_df: pd.DataFrame,
) -> tuple[np.ndarray, np.ndarray]:
    if scripps_df.empty:
        return np.empty((0, 11), dtype=np.float32), np.empty(0, dtype=np.float32)

    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)

    X_rows, y_rows = [], []
    for _, row in scripps_df.iterrows():
        temp_f = float(row["temp_f"])
        rh = max(5.0, min(99.0, float(row["humidity"])))
        wind_mph = float(row.get("wind_mph", 0) or 0)
        wind_dir = float(row.get("wind_dir", 0) or 0)
        dist_km = float(row.get("dist_km", haversine_km(AWN_LAT, AWN_LON, REF_FIRE_LAT, REF_FIRE_LON)))

        month = now.month
        hour = now.hour
        try:
            dt = pd.to_datetime(row.get("dt_str", ""), errors="coerce")
            if pd.notna(dt):
                month = int(dt.month)
                hour = int(dt.hour)
        except Exception:
            pass

        hi = heat_index_f(temp_f, rh)
        aqi = 50.0
        fire_season = 6 <= month <= 11
        dryness = min(1.0, (0.55 if fire_season else 0.25) + (1 - rh / 100) * 0.45)

        x = np.array([
            temp_f / 120.0,
            rh / 100.0,
            hi / 130.0,
            wind_mph / 60.0,
            math.sin(math.radians(wind_dir)),
            math.cos(math.radians(wind_dir)),
            aqi / 500.0,
            dryness,
            hour / 24.0,
            (month - 1) / 11.0,
            min(1.0, dist_km / 800.0),
        ], dtype=np.float32)

        hi_norm = max(0.0, (hi - 80.0) / 50.0)
        rh_norm = max(0.0, (40.0 - rh) / 40.0)
        wind_norm = min(1.0, wind_mph / 30.0)
        season_bonus = 18.0 if fire_season else 0.0
        score = min(100.0, 34 * hi_norm + 28 * rh_norm + 18 * wind_norm + season_bonus + 8)

        X_rows.append(x)
        y_rows.append(float(score))

    if not X_rows:
        return np.empty((0, 11), dtype=np.float32), np.empty(0, dtype=np.float32)

    return np.stack(X_rows).astype(np.float32), np.array(y_rows, dtype=np.float32)
