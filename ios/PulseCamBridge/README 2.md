# PulseCam Bridge - Real Heart Rate Detector

A functional heart rate monitoring app using photoplethysmography (PPG) via the iPhone camera and flash.

## ✅ Fixed Issues

1. **Created ContentView.swift** - The missing UI is now implemented with:
   - Real-time BPM display
   - Signal quality indicator
   - Session ID management
   - Debug info panel
   - Instructions for proper usage

2. **Rewrote HeartbeatDetector.swift** - Fixed concurrency and threading issues:
   - Removed `@MainActor` annotation that was blocking delegate callbacks
   - Fixed thread safety with proper DispatchQueue usage
   - Improved signal processing pipeline
   - Added better peak detection with adaptive thresholding
   - Enhanced confidence calculation based on signal variance
   - Real-time feedback for finger placement

3. **Updated CameraPreview.swift** - Fixed deprecated API usage

## 🚨 REQUIRED: Info.plist Configuration

**The app WILL NOT WORK without this!** Add the following to your `Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>Camera access is required to measure your heart rate using photoplethysmography.</string>
```

Or in Xcode:
1. Select your project target
2. Go to "Info" tab
3. Add a new row: **Privacy - Camera Usage Description**
4. Set value: "Camera access is required to measure your heart rate using photoplethysmography."

## 📱 How to Use

1. **Start Measurement**: Tap the green "Start" button
2. **Position Finger**: 
   - Place your fingertip over the REAR camera
   - Make sure to completely cover BOTH the camera lens AND the flash LED
   - The flash should turn on automatically
3. **Hold Still**: Keep very still for 10-15 seconds
4. **Wait for Reading**: 
   - Status will show progress: "Collecting data… (X/150)"
   - Once enough data is collected, it will start analyzing
   - Confidence bar will turn green when stable
   - BPM will display when a valid reading is obtained

## 🔬 How It Works (Real PPG Algorithm)

### Photoplethysmography Process:
1. **Light Source**: Flash LED illuminates your fingertip
2. **Blood Volume Detection**: With each heartbeat, blood volume in capillaries changes
3. **Light Absorption**: Camera captures how much red light passes through/reflects
4. **Signal Processing**:
   - Samples red channel from video frames (30 fps)
   - Removes DC component (detrending)
   - Applies bandpass filter (0.5-4 Hz for 30-240 BPM range)
   - Smooths signal with moving average
   - Detects peaks with adaptive thresholding
   - Calculates intervals between peaks
   - Computes BPM: 60 / average interval

### Quality Controls:
- ✅ Validates brightness (finger must cover camera/flash properly)
- ✅ Minimum 150 samples (~5 seconds) before first calculation
- ✅ Requires at least 3 detected peaks
- ✅ Filters unrealistic intervals (< 0.3s or > 3.0s)
- ✅ BPM range validation (40-200 BPM)
- ✅ Confidence scoring based on signal variance
- ✅ Real-time feedback for positioning issues

## 🎯 Technical Details

### Camera Configuration:
- Preset: Low resolution (faster processing)
- Frame rate: 30 fps
- Torch: Maximum brightness (1.0)
- Focus: Locked
- Exposure: Locked
- Pixel format: BGRA

### Signal Processing:
- **Detrending**: Removes baseline drift
- **High-pass filter**: Eliminates slow variations (α=0.95)
- **Low-pass filter**: Removes high-frequency noise (α=0.2)
- **Moving average**: 5-sample window smoothing
- **Peak detection**: Adaptive threshold based on signal std dev
- **Min peak distance**: 15 samples (~0.5s at 30fps)

### Performance:
- Processing: Background queue (QoS: userInitiated)
- UI updates: Main thread only
- Sample window: 600 samples max (~20 seconds)
- Update throttle: 0.5 seconds between UI updates

## 🐛 Debug Features

Tap the **ⓘ** button in the navigation bar to see:
- Camera running status
- Measurement status
- Current BPM and confidence
- Usage tips

## 💡 Tips for Best Results

1. **Environment**: Works best in a dark/dim room
2. **Finger Position**: Complete coverage is critical
3. **Pressure**: Press gently, don't squeeze hard
4. **Stability**: Rest your hand on a table if needed
5. **Duration**: Wait at least 10-15 seconds
6. **Retry**: If no reading after 20 seconds, stop and restart

## 🔧 Troubleshooting

### "Camera permission denied"
- Go to Settings → PulseCam Bridge → Enable Camera

### Flash doesn't turn on
- Make sure Low Power Mode is OFF
- Check that your device has a flash
- Try restarting the app

### No BPM reading after 30 seconds
- Check finger is covering BOTH camera AND flash
- Make sure flash is on (should see light)
- Try adjusting finger pressure (lighter or firmer)
- Ensure you're holding completely still
- Check debug info panel for status

### BPM seems wrong
- Wait for confidence bar to turn green (>70%)
- Readings below 60% confidence may be inaccurate
- Compare with a known good measurement
- Try measuring again with better finger placement

### "Too bright" or "Cover camera" messages
- Adjust finger position
- Check you're covering the flash LED
- Try different finger pressure

## 📊 Session Tracking

Use the Session ID feature to track multiple measurements:
1. Tap the pencil icon next to "Session"
2. Enter a session identifier
3. All measurements during this session can be tracked

## 🏗 Architecture

```
PulseCamBridgeApp.swift    - App entry point
├── AppState.swift          - Session management
└── ContentView.swift       - Main UI
    ├── HeartbeatDetector   - PPG algorithm & camera
    └── CameraPreview       - Live camera view
```

## 🔐 Privacy

- All processing happens on-device
- No data is sent to servers
- Camera access is only for heart rate measurement
- No images or videos are saved

---

**This is a REAL heart rate detector using actual photoplethysmography algorithms, not fake/random data!**
