# PulseCamBridge (iOS)

Native iPhone app scaffold for finger-on-rear-camera pulse measurement (PPG), then syncing BPM back to the web Survivor dashboard.

## What it does

- Handles deep links like `groundzero-pulse://measure?session=<session_id>`
- Uses rear camera + torch for PPG sampling
- Estimates BPM on-device
- Posts result to the pulse bridge API:
  - `POST http://localhost:8787/api/pulse/sessions/<session_id>/result`

## Generate Xcode project

This folder uses XcodeGen.

1. Install XcodeGen (`brew install xcodegen`)
2. Run:
   ```bash
   cd ios/PulseCamBridge
   xcodegen generate
   ```
3. Open `PulseCamBridge.xcodeproj` in Xcode
4. Set your development team/signing
5. Run on a real iPhone (camera/torch required)

## App transport / backend URL

`localhost` on iPhone points to the phone itself. For local testing:
- Run pulse bridge on your laptop
- Use your laptop LAN IP in `BridgeAPI.baseURL` (for example `http://192.168.1.20:8787`)

## Notes

- This is a practical starter, not medical-grade software.
- For production you should add:
  - Better filtering/calibration
  - Session auth/signing
  - HTTPS + cert pinning
  - Error telemetry
