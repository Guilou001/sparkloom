use std::path::PathBuf;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::capture::{self, CaptureEngine, CaptureStatusInfo, StartResult, StopResult};
use crate::capture::permissions::PermissionStatus;
use crate::capture::screen::DisplayInfo;
use crate::encoding;
use crate::upload::r2_client::{ApiClient, CreateVideoRequest};
use crate::upload::manager::UploadManager;

// --- App status ---

#[derive(Serialize)]
pub struct AppStatus {
    pub version: String,
    pub recording_available: bool,
    pub ollama_available: bool,
    pub ffmpeg_available: bool,
}

#[tauri::command]
pub async fn get_app_status() -> Result<AppStatus, String> {
    let ollama_available = reqwest::get("http://localhost:11434/api/tags")
        .await
        .is_ok();

    let ffmpeg_available = encoding::find_ffmpeg().is_ok();

    Ok(AppStatus {
        version: env!("CARGO_PKG_VERSION").to_string(),
        recording_available: true,
        ollama_available,
        ffmpeg_available,
    })
}

// --- Recordings ---

#[derive(Serialize)]
pub struct Recording {
    pub id: String,
    pub title: String,
    pub duration_ms: Option<u64>,
    pub created_at: String,
    pub status: String,
    pub thumbnail_url: Option<String>,
    pub share_url: Option<String>,
}

#[tauri::command]
pub async fn get_recordings() -> Result<Vec<Recording>, String> {
    // TODO: Fetch from local SQLite
    Ok(vec![])
}

// --- Permissions ---

#[tauri::command]
pub async fn check_permissions() -> Result<PermissionStatus, String> {
    Ok(capture::permissions::check())
}

// --- Display listing ---

#[tauri::command]
pub async fn list_displays() -> Result<Vec<DisplayInfo>, String> {
    capture::screen::list_displays()
}

// --- Capture control ---

#[tauri::command]
pub async fn start_recording(
    engine: State<'_, CaptureEngine>,
    display_id: Option<u32>,
) -> Result<StartResult, String> {
    engine.start(display_id)
}

#[tauri::command]
pub async fn stop_recording(
    engine: State<'_, CaptureEngine>,
) -> Result<StopResult, String> {
    engine.stop()
}

#[tauri::command]
pub async fn get_capture_status(
    engine: State<'_, CaptureEngine>,
) -> Result<CaptureStatusInfo, String> {
    Ok(engine.status_info())
}

// --- Camera bubble window ---

#[tauri::command]
pub async fn open_camera_bubble(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;

    // Close existing bubble if any
    if let Some(existing) = app.get_webview_window("camera-bubble") {
        let _ = existing.close();
    }

    // Position bubble at bottom-left of screen
    let (pos_x, pos_y) = if let Ok(Some(monitor)) = app.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        (40.0, (size.height as f64 / scale) - 320.0)
    } else {
        (40.0, 500.0)
    };

    // Create floating bubble window (no decorations, always on top)
    WebviewWindowBuilder::new(
        &app,
        "camera-bubble",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("")
    .inner_size(220.0, 280.0)
    .position(pos_x, pos_y)
    .decorations(false)
    .always_on_top(true)
    .resizable(false)
    .build()
    .map_err(|e| format!("Failed to create camera bubble: {e}"))?;

    // Hide main window
    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.hide();
    }

    tracing::info!("Camera bubble opened");
    Ok(())
}

#[tauri::command]
pub async fn stop_and_close_bubble(
    app: tauri::AppHandle,
    engine: State<'_, CaptureEngine>,
) -> Result<(), String> {
    // Stop the recording
    let result = engine.stop()?;

    // Close camera bubble
    if let Some(bubble) = app.get_webview_window("camera-bubble") {
        let _ = bubble.close();
    }

    // Show main window and emit result
    if let Some(main_win) = app.get_webview_window("main") {
        let _ = main_win.emit("recording-complete", &result);
        let _ = main_win.show();
        let _ = main_win.set_focus();
    }

    tracing::info!("Recording stopped from bubble, returning to main window");
    Ok(())
}

// --- Post-recording processing: segmentation + upload ---

#[derive(Debug, Clone, Serialize)]
pub struct ProcessResult {
    pub video_id: String,
    pub share_token: String,
    pub share_url: String,
    pub segment_count: usize,
    pub total_bytes: u64,
}

/// Segment the .mov recording into fMP4 and upload to Cloudflare R2.
///
/// This runs as a background task. Progress is emitted via "upload-progress" events.
#[tauri::command]
pub async fn process_and_upload(
    app: tauri::AppHandle,
    recording_id: String,
    mov_path: String,
    duration_ms: u64,
) -> Result<ProcessResult, String> {
    let mov = PathBuf::from(&mov_path);

    // 1. Create video record on the backend
    tracing::info!("Creating video record on backend for {recording_id}");
    let api_client = ApiClient::from_env();
    let create_resp = api_client
        .create_video(&CreateVideoRequest {
            title: "Sans titre".into(),
            width: None,
            height: None,
            fps: None,
            codec: Some("hevc".into()),
        })
        .await?;

    let video_id = create_resp.id.clone();
    let share_token = create_resp.share_token.clone();
    let api_base = std::env::var("SPARKLOOM_API_URL")
        .unwrap_or_else(|_| "http://localhost:8787".into());
    let share_url = format!("{}/share/{}", api_base, share_token);

    tracing::info!("Video created: {video_id}, share: {share_url}");

    // Emit the share URL immediately so the UI can show it
    if let Some(win) = app.get_webview_window("main") {
        #[derive(Serialize, Clone)]
        struct ShareReady {
            recording_id: String,
            video_id: String,
            share_token: String,
            share_url: String,
        }
        let _ = win.emit(
            "share-ready",
            ShareReady {
                recording_id: recording_id.clone(),
                video_id: video_id.clone(),
                share_token: share_token.clone(),
                share_url: share_url.clone(),
            },
        );
    }

    // 2. Segment the .mov into fMP4
    let segments_dir = mov
        .parent()
        .unwrap_or_else(|| std::path::Path::new("/tmp"))
        .join(format!("{recording_id}_segments"));

    tracing::info!("Segmenting {} -> {}", mov.display(), segments_dir.display());

    let segmentation = encoding::segment_video(&mov, &segments_dir).await?;

    tracing::info!(
        "Segmentation done: {} segments",
        segmentation.segment_count
    );

    // 3. Upload all segments to R2
    let upload_manager = UploadManager::new(api_client);
    let app_for_progress = app.clone();
    let total_bytes = upload_manager
        .upload_recording(&video_id, &segmentation, duration_ms, move |progress| {
            if let Some(win) = app_for_progress.get_webview_window("main") {
                let _ = win.emit("upload-progress", &progress);
            }
        })
        .await?;

    tracing::info!(
        "Upload complete for {video_id}: {} segments, {} bytes",
        segmentation.segment_count,
        total_bytes
    );

    // 4. Clean up segment files (keep the original .mov)
    if let Err(e) = tokio::fs::remove_dir_all(&segments_dir).await {
        tracing::warn!("Failed to clean up segments dir: {e}");
    }

    Ok(ProcessResult {
        video_id,
        share_token,
        share_url,
        segment_count: segmentation.segment_count,
        total_bytes,
    })
}
