use screencapturekit::prelude::*;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct PermissionStatus {
    pub screen_recording: bool,
    pub microphone: bool,
    pub camera: bool,
}

/// Check current permission status for screen recording, microphone, and camera.
/// Screen recording is verified by attempting to list shareable content.
/// Microphone and camera permissions are verified at capture time.
pub fn check() -> PermissionStatus {
    let screen_recording = SCShareableContent::get().is_ok();

    PermissionStatus {
        screen_recording,
        microphone: true, // Verified when capture starts
        camera: true,     // Verified when webcam capture starts (Phase 1 Week 3)
    }
}
