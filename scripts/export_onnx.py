#!/usr/bin/env python3
"""
Train XGBRegressor on real wildfire + weather data, export ONNX for the browser.

Fetches:
- NOAA Storm Events (CA Wildfire rows) + Nominatim geocoding for zone centroids
- CNRA CAL FIRE / NIFC perimeter GeoJSON (exact polygon centroids)
- Open-Meteo Archive + Air Quality APIs for historical conditions at each point
- Scripps SIO AWN CSV: SCRIPPS_CSV_PATH (local file or directory) or SCRIPPS_CSV_URL

See scripts/real_data.py for details. Feature order matches src/lib/features.ts.
"""

from __future__ import annotations

import json
import os
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

import numpy as np
from xgboost import XGBRegressor

try:
    from onnxmltools.convert import convert_xgboost
    from skl2onnx.common.data_types import FloatTensorType
except ImportError:
    print("Install: pip install -r scripts/requirements.txt", file=sys.stderr)
    raise

from real_data import BuildConfig, build_xy
from scripps_data import load_scripps_csv, scripps_to_training_rows


def main() -> None:
    max_noaa = int(os.environ.get("MAX_NOAA_GEOCODE", "80"))
    neg = int(os.environ.get("NEG_SAMPLES", "2200"))
    seed = int(os.environ.get("TRAIN_SEED", "42"))

    repo_root = os.path.abspath(os.path.join(_SCRIPT_DIR, ".."))
    default_scripps_dir = os.path.join(repo_root, "public", "scripps")

    scripps_source = os.environ.get("SCRIPPS_CSV_PATH", "").strip() or os.environ.get(
        "SCRIPPS_CSV_URL", ""
    ).strip()
    if not scripps_source and os.path.isdir(default_scripps_dir):
        scripps_source = default_scripps_dir

    print("Building training set from NOAA + CNRA + Open-Meteo (this may take several minutes)...")
    X, y = build_xy(BuildConfig(max_noaa_geocode=max_noaa, neg_samples=neg, seed=seed))
    print(f"  Base samples: {X.shape[0]}")

    sources = [
        "NOAA NCEI Storm Events (California Wildfire)",
        "CNRA GIS CAL FIRE / NIFC perimeters",
        "Open-Meteo Historical Weather + Air Quality",
        "OpenStreetMap Nominatim (geocoding)",
    ]

    # Scripps AWN is required for this track (same CSVs as the browser bundle under public/scripps/).
    if not scripps_source:
        print(
            "FATAL: Scripps AWN data required. Add CSVs under public/scripps/ or set "
            "SCRIPPS_CSV_PATH / SCRIPPS_CSV_URL.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Loading Scripps SIO AWN data (required) from {scripps_source} ...")
    scripps_df = load_scripps_csv(scripps_source)
    if scripps_df.empty:
        print(
            "FATAL: Scripps AWN CSV loaded 0 rows. Check file format and paths.",
            file=sys.stderr,
        )
        sys.exit(1)

    X_s, y_s = scripps_to_training_rows(scripps_df)
    if X_s.shape[0] == 0:
        print("FATAL: Scripps AWN produced 0 training samples.", file=sys.stderr)
        sys.exit(1)

    X = np.concatenate([X, X_s], axis=0)
    y = np.concatenate([y, y_s], axis=0)
    scripps_n = int(X_s.shape[0])
    sources.append(f"Scripps SIO AWN station readings ({scripps_n} samples)")
    print(f"  + {scripps_n} Scripps AWN samples added (required).")

    print(f"Total training samples: {X.shape[0]}, features: {X.shape[1]}")

    model = XGBRegressor(
        n_estimators=120,
        max_depth=6,
        learning_rate=0.06,
        subsample=0.85,
        colsample_bytree=0.85,
        random_state=seed,
        n_jobs=-1,
    )
    model.fit(X, y)

    out_dir = os.path.join(os.path.dirname(__file__), "..", "public", "models")
    os.makedirs(out_dir, exist_ok=True)

    onnx_model = convert_xgboost(
        model,
        initial_types=[("float_input", FloatTensorType([None, 11]))],
        target_opset=12,
    )
    path_onnx = os.path.join(out_dir, "wildfire_risk.onnx")
    with open(path_onnx, "wb") as f:
        f.write(onnx_model.SerializeToString())

    imp_path = os.path.join(out_dir, "feature_importances.json")
    with open(imp_path, "w") as f:
        json.dump([float(x) for x in model.feature_importances_.tolist()], f)

    meta_path = os.path.join(out_dir, "training_meta.json")
    with open(meta_path, "w") as f:
        json.dump(
            {
                "n_samples": int(X.shape[0]),
                "scripps_stations": scripps_n,
                "sources": sources,
                "max_noaa_geocode": max_noaa,
                "neg_samples": neg,
            },
            f,
            indent=2,
        )

    print(f"Wrote {path_onnx}, {imp_path}, {meta_path}")


if __name__ == "__main__":
    main()
