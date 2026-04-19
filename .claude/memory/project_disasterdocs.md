---
name: DisasterDocs project state
description: DataHacks 2026 project — two-dashboard wildfire + helper app, current implementation status
type: project
---

Two-dashboard PWA for DataHacks 2026 (DS3 UCSD). Vite + React + TypeScript.

**Why:** Competition submission covering UI/UX, ML/AI, and Scripps Challenge ($1,500) tracks.

**How to apply:** Check this before starting any session to know what's built vs. missing.

## Architecture
- `src/lib/` — services: groq.ts, airQuality.ts, openMeteo.ts, osrm.ts, scripps.ts, features.ts, riskInference.ts
- `src/hooks/` — useWildfireRisk, useWildfireLocation, useGeolocation, useWebcamStream, usePersonDetection, useRppg, useBreathing (NEW), useFalseColorOverlay, usePersonOverlayCanvas, useSpeechRecognition, useCountdown
- `src/components/` — WildfireDashboard, HelperDashboard, ModeSelect, RiskGauge, SpreadMap, SmokeAlarmListener, SharedWildfirePopup
- `public/models/` — wildfire_risk.onnx (ONNX model), feature_importances.json, training_meta.json
- `scripts/export_onnx.py` + `real_data.py` — retrain XGBoost from NOAA + CNRA + Open-Meteo

## Keys in .env
- VITE_GROQ_API_KEY = set
- VITE_AIRNOW_API_KEY = NOT set (falls back to Open-Meteo)
- VITE_SCRIPPS_CSV_URL = NOT set yet (set when Scripps dataset URL provided)

## What's built
- Full wildfire dashboard: ONNX risk score, spread map (Leaflet), evacuation route (OSRM), Groq voice briefing, risk history chart, smoke alarm listener, location search (Open-Meteo geocoding)
- Full helper dashboard: COCO-SSD person detection (green dot overlay), false-color thermal sim, rPPG heartbeat, breathing bars (useBreathing hook), tappable Groq first-aid checklist, Call 911, share location
- Scripps CSV integration: src/lib/scripps.ts — fetches VITE_SCRIPPS_CSV_URL, finds nearest station by Haversine, used as primary temp/humidity source in features.ts

## Model retraining
Run: `MAX_NOAA_GEOCODE=50 NEG_SAMPLES=400 npm run export-model`
Requires: `brew install libomp` + `pip install packaging`
Current model: 437 samples (NOAA + CNRA + Open-Meteo). Feature importances: Hour (33%), Vegetation dryness (21%), Heat index (9%), Month (10%), Temperature (8%).

## Data sources confirmed (from shared URLs)
- Google Drive has Scripps/UCSD heat map data in AWN subfolder — need to share CSV URL or make files public for `VITE_SCRIPPS_CSV_URL`
- NASA FIRMS public CSV integrated (no key needed): VIIRS 7-day California hotspots
- Open-Meteo soil moisture: `soil_moisture_0_to_1cm` from forecast API (0.214 m³/m³ confirmed working)
- NSIDC SMAP soil moisture — requires NASA Earthdata login, not implemented
- MODIS NDVI — requires Earthdata login, not implemented

## Missing / future
- Actual Scripps AWN CSV URL — user needs to share from Google Drive
- WebXR LiDAR depth sensing (fallback = COCO-SSD green dot currently)
- UI/UX design update (user said designs coming later)
- NSIDC/MODIS datasets need NASA Earthdata token
