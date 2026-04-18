import SwiftUI

enum AppConfig {
    enum Layout {
        static let screenPadding: CGFloat = 20
        static let sectionSpacing: CGFloat = 16
        static let cardPadding: CGFloat = 16
        static let cardCornerRadius: CGFloat = 18
        static let cameraPlaceholderHeight: CGFloat = 260
        static let debugPanelHeight: CGFloat = 180
        static let cameraControlSpacing: CGFloat = 10
    }

    enum Camera {
        static let sampleEveryNFrames = 15
    }

    enum ObjectDetection {
        static let candidateModelNames = [
            "YOLO11SmallDetector",
            "YOLOv8n",
            "YOLOv8s",
            "YOLOv5s",
            "ObjectDetector"
        ]
    }

    enum Colors {
        static let screenBackground = Color(.systemGroupedBackground)
        static let cardBackground = Color(.secondarySystemGroupedBackground)
        static let modeBadgeBackground = Color.blue.opacity(0.14)
        static let cameraPlaceholderBackground = Color.black.opacity(0.92)
        static let cameraPlaceholderTint = Color.green.opacity(0.85)
        static let debugPanelBackground = Color(.systemGray6)
        static let primaryButtonBackground = Color.blue
        static let secondaryButtonBackground = Color(.systemGray4)
    }

    enum Copy {
        static let appTitle = "ChudSense"
        static let homeTitle = "iPhone Compute Shell"
        static let homeSubtitle = "Foundation UI for camera, perception, and BLE modules."
        static let cameraPlaceholderTitle = "Live Camera Preview"
        static let cameraPlaceholderBody = "This milestone brings up preview plus a sampled frame-processing skeleton."
        static let modelCardTitle = "Object Detection Model"
        static let modelRetryButtonTitle = "Retry Model Load"
        static let inferenceCardTitle = "Live Inference"
    }
}
