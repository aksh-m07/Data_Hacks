# GroundZero

A browser-based wildfire intelligence and survivor-support app. **Wildfire station** shows location-aware risk (ONNX + environmental features), maps, air quality, and Groq-generated briefings. **Survivor** focuses on on-device vision, vitals-style cues, wildfire protocol guidance (optional Nia + Groq), distress signaling, and smoke-tone listening. Alerts can be broadcast between open tabs on the same origin.

## Stack

- **Frontend:** React 19, TypeScript, Vite 6
- **ML / vision:** ONNX Runtime Web (wildfire risk model), TensorFlow.js (COCO-SSD, pose/face landmarks for Survivor tooling)
- **Maps / routing:** Leaflet, OpenStreetMap tiles, OSRM (evacuation-style routes)
- **Data:** Open-Meteo, NASA FIRMS (public), optional EPA AirNow, optional Scripps AWN CSV
- **LLM:** Groq (OpenAI-compatible API) for briefings and protocol text; optional Nia API for protocol retrieval

## Prerequisites

- **Node.js** 18+ (includes `fetch` for local tooling)
- **Python 3** + `pip` — only if you regenerate the ONNX model (`npm run export-model`)

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Use the header to switch between **Wildfire station** and **Survivor**.

Production build:

```bash
npm run build
npm run preview
```

## Environment variables

Create a `.env` in the project root (Vite reads `VITE_*` at dev/build time):

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_GROQ_API_KEY` | Recommended | Groq API key for wildfire briefings and survivor protocol generation |
| `VITE_NIA_API_KEY` | Optional | Nia search before Groq in the wildfire protocol panel |
| `VITE_SCRIPPS_CSV_URL` | Optional | URL or path to Scripps AWN CSV (defaults can use `public/scripps/` via app config) |

Never commit real API keys. Keep `.env` out of version control.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run pulse-bridge` | Small Node HTTP server (`server/pulseBridgeServer.mjs`) for optional pulse session + SSE (used with `VITE_PULSE_BRIDGE_URL`) |
| `npm run export-model` | Python pipeline: train/export wildfire ONNX into `public/models/` |

## Repository layout

```
src/
  components/     # Dashboards, map, smoke listener, shared alert UI, etc.
  hooks/          # Wildfire risk, location, webcam, speech, breathing, …
  lib/            # Features, ONNX inference, geocode, OSRM, Groq, sharing, …
public/
  models/         # wildfire_risk.onnx and training metadata (from export-model)
server/
  pulseBridgeServer.mjs   # Optional local pulse API
scripts/
  export_onnx.py, …       # Model export / data helpers
```

## Wildfire model

The headline risk uses an exported **ONNX** model plus calibration and a heuristic **~10-day** probability blend. To regenerate assets:

```bash
npm run export-model
```

Details of features and training live in `scripts/` and `public/models/training_meta.json` after export.

## Pulse bridge (optional)

The pulse bridge is a **local** helper server, not required for the main dashboards. If you run `npm run pulse-bridge`, configure `VITE_PULSE_BRIDGE_URL` to match. The repo no longer includes a native mobile app; sessions are intended for web or manual workflows.

## License

No license file is included in this repository; treat usage as private unless you add terms.
