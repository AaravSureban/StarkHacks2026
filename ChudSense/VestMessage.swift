import Foundation
import SwiftUI

enum VestCommand: String, CaseIterable {
    case left = "Left"
    case slightLeft = "Slight Left"
    case forward = "Forward"
    case slightRight = "Slight Right"
    case right = "Right"
    case danger = "Danger"
    case stop = "Stop"

    static let manualControlCommands: [VestCommand] = [
        .left,
        .slightLeft,
        .forward,
        .slightRight,
        .right,
        .danger,
        .stop
    ]

    var displayColor: Color {
        switch self {
        case .left:
            return .blue
        case .slightLeft:
            return .cyan
        case .forward:
            return .orange
        case .slightRight:
            return .mint
        case .right:
            return .green
        case .danger:
            return .red
        case .stop:
            return .gray
        }
    }

    var directionValue: String {
        switch self {
        case .left:
            return "left"
        case .slightLeft:
            return "slight_left"
        case .forward:
            return "forward"
        case .slightRight:
            return "slight_right"
        case .right:
            return "right"
        case .danger, .stop:
            return "none"
        }
    }

    var alertValue: String {
        switch self {
        case .danger:
            return "danger"
        case .stop:
            return "stop"
        default:
            return "none"
        }
    }

    var intensityValue: Double {
        switch self {
        case .left, .right:
            return 0.7
        case .slightLeft, .slightRight:
            return 0.5
        case .forward:
            return 0.6
        case .danger:
            return 1.0
        case .stop:
            return 0.0
        }
    }

    var patternValue: String {
        switch self {
        case .danger:
            return "rapid"
        case .stop:
            return "none"
        default:
            return "steady"
        }
    }

    var priorityValue: Int {
        switch self {
        case .danger:
            return 3
        case .stop:
            return 0
        default:
            return 1
        }
    }
}

struct VestMessage: Codable {
    let mode: String
    let direction: String
    let alert: String
    let intensity: Double
    let pattern: String
    let priority: Int
}

func makeMessage(for command: VestCommand) -> VestMessage {
    VestMessage(
        mode: "manual",
        direction: command.directionValue,
        alert: command.alertValue,
        intensity: command.intensityValue,
        pattern: command.patternValue,
        priority: command.priorityValue
    )
}

func makePrettyJSONString(from message: VestMessage) -> String {
    do {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted]
        let jsonData = try encoder.encode(message)
        return String(data: jsonData, encoding: .utf8) ?? "Failed to convert JSON data to text"
    } catch {
        return "Failed to encode message: \(error)"
    }
}
