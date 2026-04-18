import AVFoundation
import Combine
import CoreML
import Foundation
import Vision

final class ObjectDetectionManager: ObservableObject {
    @Published private(set) var modelStatusText = "Model not loaded"
    @Published private(set) var modelDetailsText = "No Core ML model requested yet"
    @Published private(set) var loadedModelNameText = "None"
    @Published private(set) var isModelLoaded = false
    @Published private(set) var inferenceStatusText = "Inference idle"
    @Published private(set) var detectionCountText = "0"
    @Published private(set) var lastInferenceFrameText = "No inference frames yet"

    private(set) var visionModel: VNCoreMLModel?
    private var isRunningInference = false

    func loadModel() {
        modelStatusText = "Loading model"
        modelDetailsText = "Checking app bundle for configured model names"
        loadedModelNameText = "Searching"
        isModelLoaded = false
        visionModel = nil

        for candidate in AppConfig.ObjectDetection.candidateModelNames {
            if let compiledModelURL = Bundle.main.url(forResource: candidate, withExtension: "mlmodelc") {
                loadCompiledModel(at: compiledModelURL, modelName: candidate)
                return
            }
        }

        modelStatusText = "Model load failed"
        modelDetailsText = "No compiled Core ML model found in the app bundle"
        loadedModelNameText = "Missing"
        inferenceStatusText = "Inference unavailable"
    }

    func processFrame(_ snapshot: FrameProcessingSnapshot) {
        guard let visionModel else {
            DispatchQueue.main.async {
                self.inferenceStatusText = "Inference unavailable"
                self.lastInferenceFrameText = "Model not loaded"
                self.detectionCountText = "0"
            }
            return
        }

        guard !isRunningInference else {
            DispatchQueue.main.async {
                self.inferenceStatusText = "Skipping frame while inference is busy"
            }
            return
        }

        isRunningInference = true

        let request = VNCoreMLRequest(model: visionModel) { [weak self] request, error in
            guard let self else { return }

            defer {
                self.isRunningInference = false
            }

            if let error {
                DispatchQueue.main.async {
                    self.inferenceStatusText = "Inference failed"
                    self.lastInferenceFrameText = "Frame \(snapshot.frameNumber)"
                    self.modelDetailsText = error.localizedDescription
                    self.detectionCountText = "0"
                }
                return
            }

            let objectObservations = request.results as? [VNRecognizedObjectObservation] ?? []

            DispatchQueue.main.async {
                self.inferenceStatusText = "Inference active"
                self.lastInferenceFrameText = "Frame \(snapshot.frameNumber)"
                self.detectionCountText = "\(objectObservations.count)"

                if let firstObservation = objectObservations.first,
                   let topLabel = firstObservation.labels.first {
                    self.modelDetailsText = "Top detection: \(topLabel.identifier) \(String(format: "%.2f", topLabel.confidence))"
                } else {
                    self.modelDetailsText = "No detections on the latest sampled frame"
                }
            }
        }

        request.imageCropAndScaleOption = .scaleFill

        let handler = VNImageRequestHandler(
            cvPixelBuffer: snapshot.pixelBuffer,
            orientation: .right,
            options: [:]
        )

        do {
            try handler.perform([request])
        } catch {
            isRunningInference = false

            DispatchQueue.main.async {
                self.inferenceStatusText = "Inference failed"
                self.lastInferenceFrameText = "Frame \(snapshot.frameNumber)"
                self.modelDetailsText = error.localizedDescription
                self.detectionCountText = "0"
            }
        }
    }

    private func loadCompiledModel(at url: URL, modelName: String) {
        do {
            let model = try MLModel(contentsOf: url)
            let visionModel = try VNCoreMLModel(for: model)

            self.visionModel = visionModel
            isModelLoaded = true
            modelStatusText = "Model loaded"
            modelDetailsText = "Core ML model initialized successfully"
            loadedModelNameText = modelName
            inferenceStatusText = "Ready for live inference"
        } catch {
            isModelLoaded = false
            visionModel = nil
            modelStatusText = "Model load failed"
            modelDetailsText = error.localizedDescription
            loadedModelNameText = modelName
            inferenceStatusText = "Inference unavailable"
        }
    }
}
