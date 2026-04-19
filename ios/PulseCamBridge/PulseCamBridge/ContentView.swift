import SwiftUI
import UIKit

struct ContentView: View {
    @EnvironmentObject private var appState: AppState
    @StateObject private var camera = PulseCameraManager()
    @State private var sendState: String = ""
    @State private var manualSession: String = ""
    @State private var manualBpm: String = ""
    @State private var isPinging = false
    @State private var isFetchingLatest = false

    var body: some View {
        GeometryReader { geo in
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.09, green: 0.13, blue: 0.26),
                        Color(red: 0.22, green: 0.12, blue: 0.12)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 14) {
                        header
                        sessionCard
                        cameraCard(height: min(max(geo.size.height * 0.42, 300), 430))
                        statsCard
                    }
                    .frame(minHeight: geo.size.height - 24, alignment: .top)
                    .padding(.horizontal, 14)
                    .padding(.top, 12)
                    .padding(.bottom, 120)
                }
            }
            .safeAreaInset(edge: .bottom) {
                bottomActionBar
            }
            .task {
                camera.start()
            }
            .onDisappear {
                camera.stop()
            }
            .onAppear {
                if manualSession.isEmpty, let s = UIPasteboard.general.string {
                    let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
                    if trimmed.count > 10 { manualSession = trimmed }
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.white.opacity(0.16))
                Image(systemName: "heart.text.square.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 2) {
                Text("PulseCamBridge")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.white)
                Text(appState.sessionId == nil ? "Connect session to sync with website" : "Session connected")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.82))
            }
            Spacer()
        }
    }

    private var sessionCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Session")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.78))

            TextField("Paste full session code", text: $manualSession)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.footnote.monospaced())
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color.white.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .foregroundStyle(.white)

            HStack(spacing: 8) {
                Button("Paste") {
                    if let s = UIPasteboard.general.string, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        manualSession = s
                        appState.setManualSession(s)
                    }
                }
                .buttonStyle(.bordered)

                Button(isPinging ? "Checking..." : "Check") {
                    Task { await pingBridge() }
                }
                .buttonStyle(.borderedProminent)
                .disabled((appState.sessionId ?? "").isEmpty || isPinging)

                Button(isFetchingLatest ? "Loading..." : "Latest") {
                    Task { await loadLatestSession() }
                }
                .buttonStyle(.bordered)
                .disabled(isFetchingLatest)
            }
            .tint(.white)

            if let session = appState.sessionId {
                Text(session)
                    .font(.caption.monospaced())
                    .foregroundStyle(.white.opacity(0.85))
                    .textSelection(.enabled)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            Text("Flow: Paste -> Use -> Check -> Measure -> Send")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.75))
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func cameraCard(height: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            CameraPreview(session: camera.captureSession)
                .frame(height: height)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))

            Text("Cover rear camera + flash with fingertip")
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(.black.opacity(0.58), in: Capsule())
                .foregroundStyle(.white)
                .padding(12)
        }
    }

    private var statsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Estimated BPM")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.78))
                    Text(camera.bpm.map { "\($0)" } ?? "—")
                        .font(.system(size: 42, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                }
                Spacer()
                Text(camera.statusText)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.white.opacity(0.85))
                    .multilineTextAlignment(.trailing)
            }

            HStack(spacing: 8) {
                TextField("Manual BPM fallback", text: $manualBpm)
                    .keyboardType(.numberPad)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.footnote.monospaced())
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(Color.white.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .foregroundStyle(.white)
                Button("Demo 72") {
                    camera.bpm = 72
                    sendState = "Demo BPM set to 72."
                }
                .buttonStyle(.bordered)
            }

            if !sendState.isEmpty {
                Text(sendState)
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.95))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var bottomActionBar: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Session")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.76))
                Text(appState.sessionId == nil ? "Not set" : "Linked")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.white)
            }
            Spacer()
            Button("Use Latest") {
                Task { await loadLatestSession() }
            }
            .buttonStyle(.bordered)
            Button("Send BPM to Website") {
                Task { await send() }
            }
            .buttonStyle(.borderedProminent)
            .tint(.orange)
            .disabled(appState.sessionId == nil || camera.bpm == nil || camera.isSending)
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 10)
        .background(.regularMaterial)
    }

    private func pingBridge() async {
        let session = manualSession.trimmingCharacters(in: .whitespacesAndNewlines)
        guard appState.setManualSession(session) else {
            sendState = "Paste full session code, then tap Check."
            return
        }
        isPinging = true
        defer { isPinging = false }
        do {
            try await BridgeAPI.pingHealth()
            try await BridgeAPI.pingSession(session)
            sendState = "Bridge connected and session is valid."
        } catch {
            sendState = "Bridge check failed: \(error.localizedDescription)"
        }
    }

    private func loadLatestSession() async {
        isFetchingLatest = true
        defer { isFetchingLatest = false }
        do {
            try await BridgeAPI.pingHealth()
            let session = try await BridgeAPI.latestSessionId()
            manualSession = session
            _ = appState.setManualSession(session)
            sendState = "Loaded latest website session."
        } catch {
            sendState = "Could not load latest session: \(error.localizedDescription)"
        }
    }

    private func send() async {
        guard let session = appState.sessionId, let bpm = camera.bpm else { return }
        camera.isSending = true
        defer { camera.isSending = false }
        do {
            try await BridgeAPI.sendPulseResult(sessionId: session, bpm: bpm, confidence: camera.confidence)
            sendState = "Sent BPM \(bpm) to Survivor dashboard."
        } catch {
            sendState = "Send failed: \(error.localizedDescription)"
        }
    }
}
