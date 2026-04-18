import AVFoundation
import Combine
import Foundation

struct FrameProcessingSnapshot {
    let frameNumber: Int
    let timestamp: Date
    let dimensionsText: String
    let pixelBuffer: CVPixelBuffer
}

protocol FrameProcessing {
    func processFrame(_ snapshot: FrameProcessingSnapshot)
}

final class FrameProcessor: ObservableObject, FrameProcessing {
    @Published private(set) var pipelineStatusText = "Processor idle"
    @Published private(set) var lastProcessedFrameText = "No processed frames"
    @Published private(set) var lastProcessedTimestampText = "No timestamps yet"
    @Published private(set) var placeholderCallbackText = "Placeholder callback not triggered"

    let objectDetectionManager: ObjectDetectionManager

    private let timestampFormatter: DateFormatter

    init(objectDetectionManager: ObjectDetectionManager = ObjectDetectionManager()) {
        self.objectDetectionManager = objectDetectionManager

        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .medium
        formatter.locale = Locale(identifier: "en_US_POSIX")
        self.timestampFormatter = formatter
    }

    func processFrame(_ snapshot: FrameProcessingSnapshot) {
        let timestampText = timestampFormatter.string(from: snapshot.timestamp)

        DispatchQueue.main.async {
            self.pipelineStatusText = "Sampled frame received"
            self.lastProcessedFrameText = "Frame \(snapshot.frameNumber) at \(snapshot.dimensionsText)"
            self.lastProcessedTimestampText = timestampText
            self.placeholderCallbackText = "Forwarded frame \(snapshot.frameNumber) to detector"
        }

        objectDetectionManager.processFrame(snapshot)
    }
}
