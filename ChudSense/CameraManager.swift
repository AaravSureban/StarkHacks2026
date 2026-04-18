import AVFoundation
import Combine
import CoreGraphics
import Foundation

final class CameraManager: NSObject, ObservableObject {
    enum AuthorizationState {
        case notDetermined
        case authorized
        case denied
        case restricted
        case unknown

        var description: String {
            switch self {
            case .notDetermined:
                return "Not requested"
            case .authorized:
                return "Granted"
            case .denied:
                return "Denied"
            case .restricted:
                return "Restricted"
            case .unknown:
                return "Unknown"
            }
        }
    }

    @Published private(set) var authorizationState: AuthorizationState = .notDetermined
    @Published private(set) var cameraStatusText = "Camera not started"
    @Published private(set) var frameStatusText = "Frame pipeline idle"
    @Published private(set) var latestFrameText = "No frames received"
    @Published private(set) var isSessionRunning = false
    @Published private(set) var previewAspectRatio: CGFloat = 3.0 / 4.0

    let session = AVCaptureSession()

    private let sessionQueue = DispatchQueue(label: "chudsense.camera.session")
    private let outputQueue = DispatchQueue(label: "chudsense.camera.output")
    private let videoOutput = AVCaptureVideoDataOutput()
    private var isConfigured = false
    private var frameCount = 0

    override init() {
        super.init()
        refreshAuthorizationStatus()
    }

    func refreshAuthorizationStatus() {
        authorizationState = makeAuthorizationState(from: AVCaptureDevice.authorizationStatus(for: .video))

        switch authorizationState {
        case .authorized:
            cameraStatusText = isSessionRunning ? "Camera running" : "Ready to start"
        case .notDetermined:
            cameraStatusText = "Camera permission not requested"
        case .denied:
            cameraStatusText = "Enable camera access in Settings"
        case .restricted:
            cameraStatusText = "Camera access is restricted"
        case .unknown:
            cameraStatusText = "Camera state unavailable"
        }
    }

    func requestPermissionAndStart() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            authorizationState = .authorized
            configureAndStartSessionIfNeeded()

        case .notDetermined:
            cameraStatusText = "Requesting camera permission"

            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    self.authorizationState = granted ? .authorized : .denied
                    self.cameraStatusText = granted
                        ? "Permission granted"
                        : "Camera access denied"
                }

                if granted {
                    self.configureAndStartSessionIfNeeded()
                }
            }

        case .denied:
            authorizationState = .denied
            cameraStatusText = "Enable camera access in Settings"

        case .restricted:
            authorizationState = .restricted
            cameraStatusText = "Camera access is restricted"

        @unknown default:
            authorizationState = .unknown
            cameraStatusText = "Unable to determine camera state"
        }
    }

    func stopSession() {
        sessionQueue.async {
            guard self.session.isRunning else { return }
            self.session.stopRunning()

            DispatchQueue.main.async {
                self.isSessionRunning = false
                self.cameraStatusText = "Camera stopped"
                self.frameStatusText = "Frame pipeline idle"
            }
        }
    }

    private func configureAndStartSessionIfNeeded() {
        sessionQueue.async {
            if !self.isConfigured {
                self.configureSession()
            }

            guard self.isConfigured else {
                DispatchQueue.main.async {
                    self.cameraStatusText = "Failed to configure camera"
                }
                return
            }

            guard !self.session.isRunning else {
                DispatchQueue.main.async {
                    self.isSessionRunning = true
                    self.cameraStatusText = "Camera running"
                }
                return
            }

            self.session.startRunning()

            DispatchQueue.main.async {
                self.isSessionRunning = true
                self.cameraStatusText = "Camera running"
                self.frameStatusText = "Waiting for frames"
            }
        }
    }

    private func configureSession() {
        session.beginConfiguration()
        session.sessionPreset = .high

        defer {
            session.commitConfiguration()
        }

        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            DispatchQueue.main.async {
                self.cameraStatusText = "Back camera not available"
            }
            return
        }

        do {
            let input = try AVCaptureDeviceInput(device: camera)

            guard session.canAddInput(input) else {
                DispatchQueue.main.async {
                    self.cameraStatusText = "Could not add camera input"
                }
                return
            }

            session.addInput(input)

            let dimensions = CMVideoFormatDescriptionGetDimensions(camera.activeFormat.formatDescription)
            let portraitWidth = min(CGFloat(dimensions.width), CGFloat(dimensions.height))
            let portraitHeight = max(CGFloat(dimensions.width), CGFloat(dimensions.height))

            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
            ]
            videoOutput.setSampleBufferDelegate(self, queue: outputQueue)

            guard session.canAddOutput(videoOutput) else {
                DispatchQueue.main.async {
                    self.cameraStatusText = "Could not add video output"
                }
                return
            }

            session.addOutput(videoOutput)

            if let connection = videoOutput.connection(with: .video),
               connection.isVideoRotationAngleSupported(90) {
                connection.videoRotationAngle = 90
            }

            DispatchQueue.main.async {
                self.previewAspectRatio = portraitWidth / portraitHeight
                self.frameStatusText = "Frame pipeline ready"
                self.latestFrameText = "No frames received"
            }

            isConfigured = true
        } catch {
            DispatchQueue.main.async {
                self.cameraStatusText = "Camera setup error: \(error.localizedDescription)"
            }
        }
    }

    private func makeAuthorizationState(from status: AVAuthorizationStatus) -> AuthorizationState {
        switch status {
        case .notDetermined:
            return .notDetermined
        case .authorized:
            return .authorized
        case .denied:
            return .denied
        case .restricted:
            return .restricted
        @unknown default:
            return .unknown
        }
    }
}

extension CameraManager: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return
        }

        frameCount += 1

        let width = CVPixelBufferGetWidth(imageBuffer)
        let height = CVPixelBufferGetHeight(imageBuffer)

        if frameCount == 1 || frameCount.isMultiple(of: 15) {
            DispatchQueue.main.async {
                self.frameStatusText = "Receiving live frames"
                self.latestFrameText = "\(width) x \(height) px"
            }
        }
    }
}
