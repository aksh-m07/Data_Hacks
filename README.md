# Data_Hacks

## iPhone Pulse Bridge (new)

This repo now includes an optional pulse-bridge flow so Survivor can request a pulse reading from an iPhone camera app and sync BPM back into the dashboard.

### 1) Run web app

```bash
npm run dev
```

### 2) Run pulse bridge API (separate terminal)

```bash
npm run pulse-bridge
```

Default bridge URL is `http://localhost:8787`.

Optional env:

```bash
VITE_PULSE_BRIDGE_URL=http://localhost:8787
```

### 3) Use in Survivor dashboard

- Open Survivor tab
- Click `Measure Pulse on iPhone`
- On desktop it opens a bridge page/new tab; on iPhone it tries deep-linking to the iOS app
- Once measurement is submitted, BPM streams back live to Survivor via SSE

### 4) iOS app scaffold

iPhone app scaffold is in:

- `ios/PulseCamBridge`

It supports deep links like:

- `disasterdocs-pulse://measure?session=<session_id>`

and posts BPM to:

- `POST /api/pulse/sessions/:sessionId/result`
