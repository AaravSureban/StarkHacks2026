import Combine
import CoreML
import Foundation
import Vision

final class ObjectDetectionManager: ObservableObject {
    @Published private(set) var modelStatusText = "Model not loaded"
    @Published private(set) var modelDetailsText = "No Core ML model requested yet"
    @Published private(set) var loadedModelNameText = "None"
    @Published private(set) var isModelLoaded = false

    private(set) var visionModel: VNCoreMLModel?

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
        } catch {
            isModelLoaded = false
            visionModel = nil
            modelStatusText = "Model load failed"
            modelDetailsText = error.localizedDescription
            loadedModelNameText = modelName
        }
    }
}
