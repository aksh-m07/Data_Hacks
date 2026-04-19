import Foundation

final class AppState: ObservableObject {
    @Published var sessionId: String?

    // Set a manual session id if non-empty; return true on success
    @discardableResult
    func setManualSession(_ s: String) -> Bool {
        let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        sessionId = trimmed
        return true
    }
}
