import Foundation

final class AppState: ObservableObject {
    @Published var sessionId: String?

    func handle(url: URL) {
        guard url.scheme == "disasterdocs-pulse" else { return }
        guard url.host == "measure" else { return }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems,
              let session = queryItems.first(where: { $0.name == "session" })?.value,
              !session.isEmpty else {
            return
        }
        sessionId = session
    }

    @discardableResult
    func setManualSession(_ raw: String) -> Bool {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        sessionId = trimmed
        return true
    }
}
