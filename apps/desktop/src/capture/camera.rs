// Webcam capture for the floating camera bubble.
//
// The camera preview is handled via getUserMedia in the WebView (CameraBubble.tsx).
// The bubble window is a floating, always-on-top Tauri window with transparent background.
// Since SCStream captures the full display, the bubble is naturally included in the recording.
//
// Future: If we need to composite the webcam at a fixed position in the video
// (independent of on-screen bubble position), we can add AVFoundation capture here
// and composite via Metal/Core Image in the encoding pipeline.
