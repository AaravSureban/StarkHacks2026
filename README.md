# ChudSense

ChudSense is a wearable assistive navigation system being built incrementally.
The project is split so the iPhone handles perception and planning first, while
the ESP32 handles execution and safety once the command pipeline is stable.

## Repository Structure

- `ios-app/` contains the future iPhone application modules and app-specific docs.
- `esp32-firmware/` contains the future ESP32 firmware project.
- `docs/` contains architecture and implementation notes.
- `protocol/` contains the shared command contract used across iPhone and ESP32.
- `tests/` contains manual and automated validation artifacts.
- `ChudSense/` contains the current Xcode project being migrated into this
  milestone-based structure.

## Current Milestone

Phase 0 focuses on repository structure and the initial shared command protocol.
No BLE, ESP32 firmware, or hardware control is implemented in this milestone.

## iOS App Structure

The active Xcode app in `ChudSense/` is being revised to follow an incremental
iPhone-first architecture:

- `AppCoordinator` owns app-level shell state and will later coordinate camera,
  perception, and transport modules.
- `AppConfig` centralizes UI constants and shared copy.
- `ContentView` stays focused on presentation and reads state from the
  coordinator.

## Camera Preview Module

The current camera milestone provides a live back-camera preview and a clean
capture-session wrapper:

- `CameraManager` owns permissions, session configuration, and frame reception.
- `CameraPreviewView` displays the live `AVCaptureSession` inside SwiftUI.
- The frame delegate is active, but no Vision or Core ML inference runs yet.
