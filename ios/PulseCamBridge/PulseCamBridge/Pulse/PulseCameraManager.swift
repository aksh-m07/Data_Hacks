import AVFoundation
import Foundation

@MainActor
final class PulseCameraManager: NSObject, ObservableObject {
    @Published var bpm: Int?
    @Published var confidence: Double?
    @Published var statusText: String = "Initializing camera…"
    @Published var isSending: Bool = false

    let captureSession = AVCaptureSession()
    private let output = AVCaptureVideoDataOutput()
    private let queue = DispatchQueue(label: "pulse.camera.queue")
    private var isConfigured = false

    private var lastTimes: [Double] = []
    private var lastSignal: [Double] = []
    private let maxSamples = 420

    func start() {
        Task.detached {
            let granted = await self.ensurePermission()
            guard granted else {
                await MainActor.run { self.statusText = "Camera permission denied. Enable it in Settings." }
                return
            }
            await self.configureIfNeeded()
            if !self.captureSession.isRunning {
                self.captureSession.startRunning()
            }
            await MainActor.run {
                self.statusText = "Place fingertip over rear camera + flash"
            }
        }
    }

    func stop() {
        if captureSession.isRunning {
            captureSession.stopRunning()
        }
    }

    private func ensurePermission() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .video)
        default:
            return false
        }
    }

    private func configureIfNeeded() async {
        guard !isConfigured else { return }
        captureSession.beginConfiguration()
        captureSession.sessionPreset = .medium
        defer {
            captureSession.commitConfiguration()
            isConfigured = true
        }

        guard let cam = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else { return }
        do {
            let input = try AVCaptureDeviceInput(device: cam)
            if captureSession.canAddInput(input) { captureSession.addInput(input) }

            try cam.lockForConfiguration()
            if cam.hasTorch {
                try cam.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel)
            }
            cam.focusMode = .locked
            cam.unlockForConfiguration()
        } catch {
            await MainActor.run { self.statusText = "Camera unavailable" }
            return
        }

        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: Int(kCVPixelFormatType_32BGRA)]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        if captureSession.canAddOutput(output) {
            captureSession.addOutput(output)
        }
    }

    private func ingestSample(time: Double, red: Double) {
        lastTimes.append(time)
        lastSignal.append(red)
        if lastTimes.count > maxSamples {
            lastTimes.removeFirst(lastTimes.count - maxSamples)
            lastSignal.removeFirst(lastSignal.count - maxSamples)
        }
        guard lastSignal.count >= 90 else { return }

        let centered = detrend(lastSignal)
        let peaks = detectPeaks(centered)
        guard peaks.count >= 2 else { return }

        let peakTimes = peaks.compactMap { idx in
            idx < lastTimes.count ? lastTimes[idx] : nil
        }
        guard peakTimes.count >= 2 else { return }
        let intervals = zip(peakTimes.dropFirst(), peakTimes).map { $0 - $1 }.filter { $0 > 0.3 && $0 < 2.0 }
        guard intervals.count >= 2 else { return }
        let mean = intervals.reduce(0, +) / Double(intervals.count)
        let computedBpm = Int((60.0 / mean).rounded())
        guard computedBpm >= 35 && computedBpm <= 220 else { return }
        let conf = min(1.0, Double(intervals.count) / 10.0)

        Task { @MainActor in
            self.bpm = computedBpm
            self.confidence = conf
            self.statusText = conf > 0.5 ? "Stable signal" : "Collecting signal…"
        }
    }

    private func detrend(_ values: [Double]) -> [Double] {
        let mean = values.reduce(0, +) / Double(values.count)
        return values.map { $0 - mean }
    }

    private func detectPeaks(_ values: [Double]) -> [Int] {
        guard values.count >= 3 else { return [] }
        let std = sqrt(values.reduce(0) { $0 + ($1 * $1) } / Double(values.count))
        let threshold = max(std * 0.35, 0.002)
        var peaks: [Int] = []
        for i in 1..<(values.count - 1) {
            if values[i] > threshold && values[i] > values[i - 1] && values[i] > values[i + 1] {
                if let last = peaks.last, i - last < 7 { continue }
                peaks.append(i)
            }
        }
        return peaks
    }
}

extension PulseCameraManager: AVCaptureVideoDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let t = CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds

        CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }

        guard let base = CVPixelBufferGetBaseAddress(imageBuffer) else { return }
        let width = CVPixelBufferGetWidth(imageBuffer)
        let height = CVPixelBufferGetHeight(imageBuffer)
        let rowBytes = CVPixelBufferGetBytesPerRow(imageBuffer)
        let ptr = base.assumingMemoryBound(to: UInt8.self)

        let stepX = max(1, width / 40)
        let stepY = max(1, height / 40)
        var redSum = 0.0
        var n = 0.0
        for y in stride(from: 0, to: height, by: stepY) {
            for x in stride(from: 0, to: width, by: stepX) {
                let i = y * rowBytes + x * 4
                let r = Double(ptr[i + 2]) / 255.0
                redSum += r
                n += 1
            }
        }
        guard n > 0 else { return }
        let red = redSum / n

        Task { @MainActor in
            self.ingestSample(time: t, red: red)
        }
    }
}
