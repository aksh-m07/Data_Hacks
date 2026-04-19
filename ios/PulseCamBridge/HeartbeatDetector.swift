import Foundation
import AVFoundation
import CoreMedia
import CoreVideo
import Accelerate

final class HeartbeatDetector: NSObject, ObservableObject {
    @Published var bpm: Int?
    @Published var confidence: Double = 0
    @Published var status: String = "Ready"
    @Published var isMeasuring: Bool = false

    let session = AVCaptureSession()
    private let output = AVCaptureVideoDataOutput()
    private let queue = DispatchQueue(label: "heartbeat.detector.queue", qos: .userInitiated)
    private var configured = false
    
    // Processing state - accessed only on queue
    private var times: [Double] = []
    private var signal: [Double] = []
    private let maxSamples = 600
    private let minWindowSamples = 150
    private var lastUpdateTime: Double = 0

    func start() {
        DispatchQueue.main.async {
            self.status = "Requesting camera…"
            self.bpm = nil
            self.confidence = 0
        }
        
        // Reset state
        queue.async { [weak self] in
            self?.times.removeAll()
            self?.signal.removeAll()
            self?.lastUpdateTime = 0
        }
        
        Task {
            let granted = await ensurePermission()
            guard granted else {
                await MainActor.run {
                    self.status = "Camera permission denied"
                }
                return
            }
            
            await configureIfNeeded()
            
            queue.async { [weak self] in
                guard let self = self else { return }
                if !self.session.isRunning {
                    self.session.startRunning()
                }
            }
            
            await enableTorchIfPossible()
            
            await MainActor.run {
                self.isMeasuring = true
                self.status = "Place finger on camera & flash"
            }
        }
    }

    func stop() {
        queue.async { [weak self] in
            guard let self = self else { return }
            
            // Turn off torch
            if let cam = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
               cam.hasTorch {
                try? cam.lockForConfiguration()
                cam.torchMode = .off
                cam.unlockForConfiguration()
            }
            
            if self.session.isRunning {
                self.session.stopRunning()
            }
            
            DispatchQueue.main.async {
                self.isMeasuring = false
                self.status = "Stopped"
                self.bpm = nil
                self.confidence = 0
            }
        }
    }

    private func ensurePermission() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .video)
        default: return false
        }
    }

    private func configureIfNeeded() async {
        guard !configured else { return }
        
        session.beginConfiguration()
        session.sessionPreset = .low  // Lower resolution for faster processing
        
        guard let cam = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            session.commitConfiguration()
            await MainActor.run { self.status = "Camera not available" }
            return
        }
        
        do {
            let input = try AVCaptureDeviceInput(device: cam)
            if session.canAddInput(input) {
                session.addInput(input)
            }
            
            // Configure camera settings
            try cam.lockForConfiguration()
            
            // Enable torch at high level
            if cam.hasTorch {
                try cam.setTorchModeOn(level: 1.0)  // Max brightness
            }
            
            // Lock focus and exposure for stability
            if cam.isFocusModeSupported(.locked) {
                cam.focusMode = .locked
            }
            if cam.isExposureModeSupported(.locked) {
                cam.exposureMode = .locked
            }
            
            // Set frame rate to 30 fps
            cam.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 30)
            cam.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 30)
            
            cam.unlockForConfiguration()
        } catch {
            await MainActor.run { self.status = "Camera setup failed: \(error.localizedDescription)" }
            session.commitConfiguration()
            return
        }
        
        // Configure video output
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA)
        ]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        
        if session.canAddOutput(output) {
            session.addOutput(output)
        }
        
        session.commitConfiguration()
        configured = true
    }

    private func enableTorchIfPossible() async {
        guard let cam = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              cam.hasTorch else { return }
        do {
            try cam.lockForConfiguration()
            try cam.setTorchModeOn(level: 1.0)  // Max brightness
            cam.unlockForConfiguration()
        } catch {
            print("Failed to enable torch: \(error)")
        }
    }
    
    // MARK: - Signal Processing (called on queue)
    
    private func processSample(time: Double, red: Double) {
        // This runs on the queue, so it's thread-safe
        times.append(time)
        signal.append(red)
        
        if times.count > maxSamples {
            times.removeFirst(times.count - maxSamples)
            signal.removeFirst(signal.count - maxSamples)
        }
        
        // Only process every 0.5 seconds to avoid UI spam
        if time - lastUpdateTime < 0.5 {
            return
        }
        lastUpdateTime = time
        
        guard signal.count >= minWindowSamples else {
            DispatchQueue.main.async {
                self.status = "Collecting data… (\(self.signal.count)/\(self.minWindowSamples))"
            }
            return
        }
        
        // Perform signal processing
        let detrended = detrend(signal)
        let filtered = bandpassFilter(detrended)
        let smoothed = movingAverage(filtered, window: 5)
        let peaks = detectPeaks(smoothed)
        
        guard peaks.count >= 3 else {
            DispatchQueue.main.async {
                self.status = "Analyzing… (found \(peaks.count) peaks)"
            }
            return
        }
        
        // Calculate heart rate from peak intervals
        let peakTimes = peaks.map { times[$0] }
        var intervals: [Double] = []
        for i in 1..<peakTimes.count {
            let interval = peakTimes[i] - peakTimes[i-1]
            // Filter out unrealistic intervals (20-200 BPM range)
            if interval > 0.3 && interval < 3.0 {
                intervals.append(interval)
            }
        }
        
        guard intervals.count >= 2 else {
            DispatchQueue.main.async {
                self.status = "Need more valid peaks"
            }
            return
        }
        
        // Calculate average interval and BPM
        let avgInterval = intervals.reduce(0, +) / Double(intervals.count)
        let calculatedBPM = 60.0 / avgInterval
        
        // Validate BPM range
        guard calculatedBPM >= 40 && calculatedBPM <= 200 else {
            DispatchQueue.main.async {
                self.status = "Invalid reading, keep finger steady"
            }
            return
        }
        
        // Calculate confidence based on consistency of intervals
        let variance = intervals.map { pow($0 - avgInterval, 2) }.reduce(0, +) / Double(intervals.count)
        let stdDev = sqrt(variance)
        let coefficientOfVariation = stdDev / avgInterval
        let confidence = max(0, min(1.0, 1.0 - (coefficientOfVariation * 3)))
        
        // Update UI on main thread
        DispatchQueue.main.async {
            self.bpm = Int(calculatedBPM.rounded())
            self.confidence = confidence
            
            if confidence > 0.7 {
                self.status = "✓ Stable reading"
            } else if confidence > 0.4 {
                self.status = "Hold steady…"
            } else {
                self.status = "Keep finger still"
            }
        }
    }

    private func detrend(_ values: [Double]) -> [Double] {
        guard !values.isEmpty else { return [] }
        let mean = values.reduce(0, +) / Double(values.count)
        return values.map { $0 - mean }
    }
    
    private func bandpassFilter(_ values: [Double]) -> [Double] {
        // Simple high-pass filter to remove DC component and slow drift
        // Then low-pass to remove high frequency noise
        let highPassed = highpass(values, alpha: 0.95)
        return lowpass(highPassed, alpha: 0.2)
    }
    
    private func highpass(_ values: [Double], alpha: Double) -> [Double] {
        guard values.count > 1 else { return values }
        var result = Array(repeating: 0.0, count: values.count)
        result[0] = values[0]
        for i in 1..<values.count {
            result[i] = alpha * (result[i-1] + values[i] - values[i-1])
        }
        return result
    }
    
    private func lowpass(_ values: [Double], alpha: Double) -> [Double] {
        guard values.count > 1 else { return values }
        var result = Array(repeating: 0.0, count: values.count)
        result[0] = values[0]
        for i in 1..<values.count {
            result[i] = alpha * values[i] + (1 - alpha) * result[i-1]
        }
        return result
    }

    private func movingAverage(_ values: [Double], window: Int) -> [Double] {
        guard window > 1, values.count >= window else { return values }
        var result = values
        var sum = values.prefix(window).reduce(0, +)
        result[window - 1] = sum / Double(window)
        for i in window..<values.count {
            sum += values[i] - values[i - window]
            result[i] = sum / Double(window)
        }
        return result
    }

    private func detectPeaks(_ values: [Double]) -> [Int] {
        guard values.count >= 5 else { return [] }
        
        // Calculate adaptive threshold based on signal statistics
        let mean = values.reduce(0, +) / Double(values.count)
        let variance = values.map { pow($0 - mean, 2) }.reduce(0, +) / Double(values.count)
        let stdDev = sqrt(variance)
        let threshold = mean + stdDev * 0.5
        
        var peaks: [Int] = []
        let minPeakDistance = 15  // Minimum 15 samples between peaks (~0.5s at 30fps)
        
        for i in 2..<(values.count - 2) {
            // Check if this is a local maximum
            let isLocalMax = values[i] > values[i-1] &&
                           values[i] > values[i-2] &&
                           values[i] > values[i+1] &&
                           values[i] > values[i+2] &&
                           values[i] > threshold
            
            if isLocalMax {
                // Check minimum distance from last peak
                if let lastPeak = peaks.last {
                    if i - lastPeak >= minPeakDistance {
                        peaks.append(i)
                    }
                } else {
                    peaks.append(i)
                }
            }
        }
        
        return peaks
    }
}

// MARK: - Video Capture Delegate

extension HeartbeatDetector: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        // This is already called on our queue
        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        
        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds
        
        CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }
        
        guard let baseAddress = CVPixelBufferGetBaseAddress(imageBuffer) else { return }
        
        let width = CVPixelBufferGetWidth(imageBuffer)
        let height = CVPixelBufferGetHeight(imageBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(imageBuffer)
        let buffer = baseAddress.assumingMemoryBound(to: UInt8.self)
        
        // Sample pixels from the center region
        let centerX = width / 2
        let centerY = height / 2
        let sampleRadius = min(width, height) / 6
        
        var redSum: Double = 0
        var greenSum: Double = 0
        var blueSum: Double = 0
        var sampleCount = 0
        
        // Sample in a grid pattern in the center
        for y in stride(from: centerY - sampleRadius, to: centerY + sampleRadius, by: 10) {
            guard y >= 0 && y < height else { continue }
            for x in stride(from: centerX - sampleRadius, to: centerX + sampleRadius, by: 10) {
                guard x >= 0 && x < width else { continue }
                
                let pixelIndex = y * bytesPerRow + x * 4
                
                // BGRA format
                let blue = Double(buffer[pixelIndex]) / 255.0
                let green = Double(buffer[pixelIndex + 1]) / 255.0
                let red = Double(buffer[pixelIndex + 2]) / 255.0
                
                redSum += red
                greenSum += green
                blueSum += blue
                sampleCount += 1
            }
        }
        
        guard sampleCount > 0 else { return }
        
        let avgRed = redSum / Double(sampleCount)
        let avgGreen = greenSum / Double(sampleCount)
        let avgBlue = blueSum / Double(sampleCount)
        
        // Check if finger is covering the camera (should be bright due to torch)
        let brightness = (avgRed + avgGreen + avgBlue) / 3.0
        
        if brightness < 0.15 {
            DispatchQueue.main.async {
                self.status = "⚠️ Cover camera & flash with fingertip"
            }
            return
        }
        
        if brightness > 0.95 {
            DispatchQueue.main.async {
                self.status = "⚠️ Press finger more gently"
            }
            return
        }
        
        // Use red channel for PPG signal (most sensitive to blood volume changes)
        processSample(time: timestamp, red: avgRed)
    }
}
