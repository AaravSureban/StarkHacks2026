import SwiftUI

struct ContentView: View {
    @ObservedObject var coordinator: AppCoordinator
    @StateObject private var cameraManager = CameraManager()
    @StateObject private var objectDetectionManager = ObjectDetectionManager()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: AppConfig.Layout.sectionSpacing) {
                    headerCard
                    modelCard
                    cameraCard
                    debugPanelCard
                }
                .padding(AppConfig.Layout.screenPadding)
            }
            .background(AppConfig.Colors.screenBackground.ignoresSafeArea())
            .navigationTitle(AppConfig.Copy.appTitle)
            .onAppear {
                cameraManager.refreshAuthorizationStatus()
                objectDetectionManager.loadModel()
            }
        }
    }

    private var headerCard: some View {
        infoCard {
            VStack(alignment: .leading, spacing: 12) {
                Text(AppConfig.Copy.homeTitle)
                    .font(.title2)
                    .fontWeight(.bold)

                Text(AppConfig.Copy.homeSubtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                HStack {
                    Text("Current Mode")
                        .font(.headline)

                    Spacer()

                    Text(coordinator.currentMode.displayName)
                        .font(.headline)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(AppConfig.Colors.modeBadgeBackground)
                        .clipShape(Capsule())
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var cameraCard: some View {
        infoCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("Camera Feed")
                    .font(.headline)

                statusRow(label: "Permission", value: cameraManager.authorizationState.description)
                statusRow(label: "Camera Status", value: cameraManager.cameraStatusText)
                statusRow(label: "Frame Status", value: cameraManager.frameStatusText)
                statusRow(label: "Latest Frame", value: cameraManager.latestFrameText)
                statusRow(label: "Sampled Frames", value: cameraManager.sampledFrameCountText)
                statusRow(label: "Processor Status", value: cameraManager.frameProcessor.pipelineStatusText)

                ZStack {
                    if cameraManager.isSessionRunning {
                        CameraPreviewView(session: cameraManager.session)
                    } else {
                        RoundedRectangle(cornerRadius: AppConfig.Layout.cardCornerRadius)
                            .fill(AppConfig.Colors.cameraPlaceholderBackground)

                        VStack(spacing: 10) {
                            Image(systemName: "camera.viewfinder")
                                .font(.system(size: 36, weight: .semibold))
                                .foregroundStyle(AppConfig.Colors.cameraPlaceholderTint)

                            Text(AppConfig.Copy.cameraPlaceholderTitle)
                                .font(.headline)

                            Text(AppConfig.Copy.cameraPlaceholderBody)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                        .padding()
                    }
                }
                .frame(height: AppConfig.Layout.cameraPlaceholderHeight)
                .clipShape(RoundedRectangle(cornerRadius: AppConfig.Layout.cardCornerRadius))

                HStack(spacing: AppConfig.Layout.cameraControlSpacing) {
                    Button("Start Camera") {
                        cameraManager.requestPermissionAndStart()
                    }
                    .buttonStyle(
                        CameraActionButtonStyle(backgroundColor: AppConfig.Colors.primaryButtonBackground)
                    )

                    Button("Stop Camera") {
                        cameraManager.stopSession()
                    }
                    .buttonStyle(
                        CameraActionButtonStyle(backgroundColor: AppConfig.Colors.secondaryButtonBackground)
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var modelCard: some View {
        infoCard {
            VStack(alignment: .leading, spacing: 12) {
                Text(AppConfig.Copy.modelCardTitle)
                    .font(.headline)

                statusRow(label: "Load Status", value: objectDetectionManager.modelStatusText)
                statusRow(label: "Loaded Model", value: objectDetectionManager.loadedModelNameText)
                statusRow(label: "Details", value: objectDetectionManager.modelDetailsText)

                Button(AppConfig.Copy.modelRetryButtonTitle) {
                    objectDetectionManager.loadModel()
                }
                .buttonStyle(
                    CameraActionButtonStyle(backgroundColor: AppConfig.Colors.primaryButtonBackground)
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var debugPanelCard: some View {
        infoCard {
            VStack(alignment: .leading, spacing: 12) {
                Text("Debug Output")
                    .font(.headline)

                TextEditor(text: .constant(debugText))
                    .font(.system(.body, design: .monospaced))
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(minHeight: AppConfig.Layout.debugPanelHeight)
                    .background(AppConfig.Colors.debugPanelBackground)
                    .clipShape(
                        RoundedRectangle(cornerRadius: AppConfig.Layout.cardCornerRadius)
                    )
                    .disabled(true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var debugText: String {
        [
            coordinator.debugSummary,
            "",
            "camera.permission=\(cameraManager.authorizationState.description)",
            "camera.status=\(cameraManager.cameraStatusText)",
            "camera.frames=\(cameraManager.frameStatusText)",
            "camera.sampledFrames=\(cameraManager.sampledFrameCountText)",
            "detector.status=\(objectDetectionManager.modelStatusText)",
            "detector.model=\(objectDetectionManager.loadedModelNameText)",
            "detector.details=\(objectDetectionManager.modelDetailsText)",
            "processor.lastFrame=\(cameraManager.frameProcessor.lastProcessedFrameText)",
            "processor.lastTimestamp=\(cameraManager.frameProcessor.lastProcessedTimestampText)",
            "processor.callback=\(cameraManager.frameProcessor.placeholderCallbackText)"
        ].joined(separator: "\n")
    }

    private func statusRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.subheadline.weight(.semibold))

            Spacer()

            Text(value)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
    }

    private func infoCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .padding(AppConfig.Layout.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppConfig.Colors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: AppConfig.Layout.cardCornerRadius))
    }
}

private struct CameraActionButtonStyle: ButtonStyle {
    let backgroundColor: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(backgroundColor.opacity(configuration.isPressed ? 0.75 : 1))
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: AppConfig.Layout.cardCornerRadius))
    }
}

#Preview {
    ContentView(coordinator: AppCoordinator())
}
