import Foundation
import SwiftUI

enum VestCommand: String, CaseIterable {
    case left = "Left"
    case frontLeft = "Front Left"
    case front = "Front"
    case frontRight = "Front Right"
    case right = "Right"
    case backRight = "Back Right"
    case back = "Back"
    case backLeft = "Back Left"
    case danger = "Danger"
    case stop = "Stop"

    static let manualControlCommands: [VestCommand] = [
        .left,
        .frontLeft,
        .front,
        .frontRight,
        .right,
        .backRight,
        .back,
        .backLeft,
        .danger,
        .stop
    ]

    var displayColor: Color {
        switch self {
        case .left:
            return .blue
        case .frontLeft:
            return .cyan
        case .front:
            return .orange
        case .frontRight:
            return .mint
        case .right:
            return .green
        case .backRight:
            return .teal
        case .back:
            return .purple
        case .backLeft:
            return .indigo
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
        case .frontLeft:
            return "front_left"
        case .front:
            return "front"
        case .frontRight:
            return "front_right"
        case .right:
            return "right"
        case .backRight:
            return "back_right"
        case .back:
            return "back"
        case .backLeft:
            return "back_left"
        case .danger, .stop:
            return "none"
        }
    }

    var intensityValue: Int {
        switch self {
        case .left, .right:
            return 180
        case .frontLeft, .frontRight, .backLeft, .backRight:
            return 140
        case .front, .back:
            return 160
        case .danger:
            return 255
        case .stop:
            return 0
        }
    }

    var patternValue: String {
        switch self {
        case .danger:
            return "fast_pulse"
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

enum NavigationUrgency: String {
    case stop
    case low
    case medium
    case high

    var pattern: String {
        switch self {
        case .stop:
            return "fast_pulse"
        case .low:
            return "steady"
        case .medium:
            return "slow_pulse"
        case .high:
            return "fast_pulse"
        }
    }

    var intensity: Int {
        switch self {
        case .stop:
            return 255
        case .low:
            return 120
        case .medium:
            return 180
        case .high:
            return 240
        }
    }

    var priority: Int {
        switch self {
        case .stop:
            return 3
        case .low, .medium, .high:
            return 2
        }
    }
}

struct VestMessage: Codable {
    let mode: String
    let direction: String
    let intensity: Int
    let pattern: String
    let priority: Int
    let ttlMs: Int
    let confidence: Double
    let distance: Double?
    let seq: Int
}

func makeMessage(for command: VestCommand, seq: Int = 0) -> VestMessage {
    VestMessage(
        mode: "manual",
        direction: command.directionValue,
        intensity: command.intensityValue,
        pattern: command.patternValue,
        priority: command.priorityValue,
        ttlMs: 300,
        confidence: 1.0,
        distance: nil,
        seq: seq
    )
}

func makeObjectNavigationMessage(
    direction: DirectionEstimator.Direction,
    urgency: NavigationUrgency,
    confidence: Float,
    distanceMeters: Float?,
    seq: Int
) -> VestMessage {
    VestMessage(
        mode: "object_nav",
        direction: urgency == .stop ? "none" : direction.rawValue,
        intensity: urgency.intensity,
        pattern: urgency.pattern,
        priority: urgency.priority,
        ttlMs: AppConfig.Decision.commandTTLMilliseconds,
        confidence: Double(confidence),
        distance: distanceMeters.map(Double.init),
        seq: seq
    )
}

func makeFindAndGoSearchMessage(
    direction: DirectionEstimator.Direction,
    seq: Int
) -> VestMessage {
    VestMessage(
        mode: "find_search",
        direction: direction.rawValue,
        intensity: 110,
        pattern: "slow_pulse",
        priority: 1,
        ttlMs: AppConfig.Decision.commandTTLMilliseconds,
        confidence: 0.0,
        distance: nil,
        seq: seq
    )
}

func makeGPSNavigationMessage(
    direction: DirectionEstimator.Direction,
    distanceMeters: Double?,
    seq: Int
) -> VestMessage {
    VestMessage(
        mode: "gps",
        direction: direction.rawValue,
        intensity: AppConfig.GPS.commandIntensity,
        pattern: "slow_pulse",
        priority: AppConfig.GPS.commandPriority,
        ttlMs: AppConfig.Decision.commandTTLMilliseconds,
        confidence: 1.0,
        distance: distanceMeters,
        seq: seq
    )
}

func makeAwarenessMessage(
    direction: DirectionEstimator.Direction,
    urgency: NavigationUrgency,
    confidence: Float,
    distanceMeters: Float?,
    seq: Int
) -> VestMessage {
    VestMessage(
        mode: "awareness",
        direction: urgency == .stop ? "none" : direction.rawValue,
        intensity: urgency.intensity,
        pattern: urgency.pattern,
        priority: urgency.priority,
        ttlMs: AppConfig.Decision.commandTTLMilliseconds,
        confidence: Double(confidence),
        distance: distanceMeters.map(Double.init),
        seq: seq
    )
}

func makePrettyJSONString(from message: VestMessage) -> String {
    do {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let jsonData = try encoder.encode(message)
        return String(data: jsonData, encoding: .utf8) ?? "Failed to convert JSON data to text"
    } catch {
        return "Failed to encode message: \(error)"
    }
}
