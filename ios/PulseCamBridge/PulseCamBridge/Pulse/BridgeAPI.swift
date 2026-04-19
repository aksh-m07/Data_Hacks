import Foundation

enum BridgeAPI {
    // Replace with your laptop LAN IP for on-device testing.
    static let baseURL = URL(string: "http://100.115.48.62:8787")!

    static func sendPulseResult(sessionId: String, bpm: Int, confidence: Double?) async throws {
        let u = baseURL
            .appendingPathComponent("api")
            .appendingPathComponent("pulse")
            .appendingPathComponent("sessions")
            .appendingPathComponent(sessionId)
            .appendingPathComponent("result")
        var req = URLRequest(url: u)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: Any] = [
            "bpm": bpm,
            "source": "iphone-camera-ppg",
            "confidence": confidence as Any
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (_, resp) = try await URLSession.shared.data(for: req)
        guard let h = resp as? HTTPURLResponse, (200..<300).contains(h.statusCode) else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(domain: "BridgeAPI", code: 1, userInfo: [NSLocalizedDescriptionKey: "Server rejected pulse result (HTTP \(code))"])
        }
    }

    static func pingSession(_ sessionId: String) async throws {
        let u = baseURL
            .appendingPathComponent("api")
            .appendingPathComponent("pulse")
            .appendingPathComponent("sessions")
            .appendingPathComponent(sessionId)
        let (_, resp) = try await URLSession.shared.data(from: u)
        guard let h = resp as? HTTPURLResponse, (200..<300).contains(h.statusCode) else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(domain: "BridgeAPI", code: 2, userInfo: [NSLocalizedDescriptionKey: "Bridge/session check failed (HTTP \(code))"])
        }
    }

    static func pingHealth() async throws {
        let u = baseURL
            .appendingPathComponent("api")
            .appendingPathComponent("pulse")
            .appendingPathComponent("health")
        let (_, resp) = try await URLSession.shared.data(from: u)
        guard let h = resp as? HTTPURLResponse, (200..<300).contains(h.statusCode) else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(domain: "BridgeAPI", code: 3, userInfo: [NSLocalizedDescriptionKey: "Bridge unavailable (HTTP \(code))"])
        }
    }

    static func latestSessionId() async throws -> String {
        let u = baseURL
            .appendingPathComponent("api")
            .appendingPathComponent("pulse")
            .appendingPathComponent("sessions")
            .appendingPathComponent("latest")
        let (data, resp) = try await URLSession.shared.data(from: u)
        guard let h = resp as? HTTPURLResponse, (200..<300).contains(h.statusCode) else {
            let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(domain: "BridgeAPI", code: 4, userInfo: [NSLocalizedDescriptionKey: "No latest session found (HTTP \(code)). Click Measure on website first."])
        }
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let session = json?["sessionId"] as? String, !session.isEmpty else {
            throw NSError(domain: "BridgeAPI", code: 5, userInfo: [NSLocalizedDescriptionKey: "Latest session response malformed"])
        }
        return session
    }
}
