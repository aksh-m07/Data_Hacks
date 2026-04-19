import SwiftUI

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var detector = HeartbeatDetector()
    @State private var sessionInput: String = ""
    @State private var showingSessionPrompt = false
    @State private var showDebugInfo = false
    
    var body: some View {
        NavigationStack {
            ZStack {
                // Background gradient
                LinearGradient(
                    colors: [.red.opacity(0.3), .pink.opacity(0.2)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
                
                VStack(spacing: 30) {
                    // Session Info
                    sessionSection
                    
                    Spacer()
                    
                    // Heart Rate Display
                    heartRateDisplay
                    
                    // Status
                    statusSection
                    
                    Spacer()
                    
                    // Camera Preview (small, for user to see coverage)
                    if detector.isMeasuring {
                        cameraPreviewSection
                    }
                    
                    Spacer()
                    
                    // Controls
                    controlButtons
                    
                    // Instructions
                    instructionsSection
                }
                .padding()
            }
            .navigationTitle("PulseCam Bridge")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showDebugInfo.toggle()
                    } label: {
                        Image(systemName: showDebugInfo ? "info.circle.fill" : "info.circle")
                    }
                }
            }
            .alert("Set Session ID", isPresented: $showingSessionPrompt) {
                TextField("Session ID", text: $sessionInput)
                    .textInputAutocapitalization(.never)
                Button("Cancel", role: .cancel) { }
                Button("Set") {
                    appState.setManualSession(sessionInput)
                    sessionInput = ""
                }
            } message: {
                Text("Enter a session identifier for this measurement")
            }
            .sheet(isPresented: $showDebugInfo) {
                debugSheet
            }
        }
    }
    
    private var sessionSection: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Session:")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                
                if let sessionId = appState.sessionId {
                    Text(sessionId)
                        .font(.subheadline.monospaced())
                        .foregroundStyle(.primary)
                } else {
                    Text("Not set")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                
                Spacer()
                
                Button {
                    showingSessionPrompt = true
                } label: {
                    Image(systemName: "pencil.circle.fill")
                        .foregroundStyle(.blue)
                }
            }
            .padding()
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }
    
    private var heartRateDisplay: some View {
        VStack(spacing: 16) {
            // BPM Display
            if let bpm = detector.bpm {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(bpm)")
                        .font(.system(size: 72, weight: .bold, design: .rounded))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.red, .pink],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text("BPM")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(.secondary)
                        
                        Image(systemName: "heart.fill")
                            .font(.title2)
                            .foregroundStyle(.red)
                            .symbolEffect(.pulse, options: .repeating)
                    }
                }
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "heart.text.square")
                        .font(.system(size: 60))
                        .foregroundStyle(.secondary)
                    
                    Text("--")
                        .font(.system(size: 72, weight: .bold, design: .rounded))
                        .foregroundStyle(.secondary)
                }
            }
            
            // Confidence Indicator
            if detector.isMeasuring {
                VStack(spacing: 8) {
                    Text("Signal Quality")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(.quaternary)
                            
                            RoundedRectangle(cornerRadius: 4)
                                .fill(
                                    LinearGradient(
                                        colors: confidenceColors,
                                        startPoint: .leading,
                                        endPoint: .trailing
                                    )
                                )
                                .frame(width: geo.size.width * detector.confidence)
                        }
                    }
                    .frame(height: 8)
                }
                .padding(.horizontal, 40)
            }
        }
    }
    
    private var confidenceColors: [Color] {
        if detector.confidence < 0.3 {
            return [.red.opacity(0.6), .orange.opacity(0.6)]
        } else if detector.confidence < 0.6 {
            return [.orange, .yellow]
        } else {
            return [.green, .mint]
        }
    }
    
    private var statusSection: some View {
        Text(detector.status)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal)
    }
    
    private var cameraPreviewSection: some View {
        VStack(spacing: 8) {
            Text("Camera View")
                .font(.caption2)
                .foregroundStyle(.secondary)
            
            CameraPreview(session: detector.session)
                .frame(width: 120, height: 120)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(.white.opacity(0.3), lineWidth: 2)
                )
        }
    }
    
    private var controlButtons: some View {
        HStack(spacing: 20) {
            Button {
                if detector.isMeasuring {
                    detector.stop()
                } else {
                    detector.start()
                }
            } label: {
                Label(
                    detector.isMeasuring ? "Stop" : "Start",
                    systemImage: detector.isMeasuring ? "stop.circle.fill" : "play.circle.fill"
                )
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding()
                .background(detector.isMeasuring ? Color.red : Color.green)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(.horizontal)
    }
    
    private var instructionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Instructions:")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            
            VStack(alignment: .leading, spacing: 8) {
                instructionRow(icon: "hand.point.up.left.fill", text: "Place your fingertip over the rear camera")
                instructionRow(icon: "flashlight.on.fill", text: "Cover both camera and flash completely")
                instructionRow(icon: "figure.stand", text: "Stay still for 10-15 seconds")
                instructionRow(icon: "checkmark.circle.fill", text: "Wait for stable reading")
            }
        }
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
    
    private func instructionRow(icon: String, text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.caption)
                .foregroundStyle(.blue)
                .frame(width: 20)
            
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
    
    private var debugSheet: some View {
        NavigationStack {
            List {
                Section("System Info") {
                    LabeledContent("Camera Running", value: detector.session.isRunning ? "Yes" : "No")
                    LabeledContent("Measuring", value: detector.isMeasuring ? "Yes" : "No")
                    LabeledContent("Status", value: detector.status)
                }
                
                Section("Current Reading") {
                    if let bpm = detector.bpm {
                        LabeledContent("BPM", value: "\(bpm)")
                        LabeledContent("Confidence", value: String(format: "%.1f%%", detector.confidence * 100))
                    } else {
                        Text("No reading yet")
                            .foregroundStyle(.secondary)
                    }
                }
                
                Section("Tips") {
                    Text("• Flash should be ON when measuring")
                    Text("• Completely cover camera AND flash")
                    Text("• Press gently, don't squeeze")
                    Text("• Hold very still for 10-15 seconds")
                    Text("• Works best in a dark room")
                }
            }
            .navigationTitle("Debug Info")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        showDebugInfo = false
                    }
                }
            }
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AppState())
}
