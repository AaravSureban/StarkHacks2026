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
        "Milestone 1.3 initialized.",
        "Camera module: live preview and sampled frame pipeline ready.",
        "Detection module: pending.",
        "BLE module: pending."
    ]

    var debugSummary: String {
        debugLines.joined(separator: "\n")
    }
}
