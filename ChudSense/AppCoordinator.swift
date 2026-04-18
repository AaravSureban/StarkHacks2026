import Combine
import Foundation

final class AppCoordinator: ObservableObject {
    enum Mode: String {
        case idle

        var displayName: String {
            rawValue.capitalized
        }
    }

    @Published private(set) var currentMode: Mode = .idle
    @Published private(set) var debugLines: [String] = [
        "Milestone 1.1 initialized.",
        "Camera module: pending.",
        "Detection module: pending.",
        "BLE module: pending."
    ]

    var debugSummary: String {
        debugLines.joined(separator: "\n")
    }
}
