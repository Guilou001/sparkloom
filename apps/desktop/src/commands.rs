use std::path::PathBuf;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::capture::{self, CaptureEngine, CaptureStatusInfo, StartResult, StopResult};
use crate::capture::permissions::PermissionStatus;
use crate::capture::screen::DisplayInfo;
use crate::encoding;
use crate::transcription;
use crate::upload::r2_client::{
    ApiClient, CreateVideoRequest, SaveSummaryBody, SaveTranscriptionBody, TranscriptionWordBody,
};
use crate::upload::manager::UploadManager;

// --- App status ---

#[derive(Serialize)]
pub struct AppStatus {
    pub version: String,
    pub recording_available: bool,
    pub ollama_available: bool,
    pub ffmpeg_available: bool,
    pub whisper_model_ready: bool,
}

#[tauri::command]
pub async fn get_app_status(app: tauri::AppHandle) -> Result<AppStatus, String> {
    let ollama_available = reqwest::get("http://localhost:11434/api/tags")
        .await
        .is_ok();

    let ffmpeg_available = encoding::find_ffmpeg().is_ok();

    let whisper_model_ready = app
        .path()
        .app_data_dir()
        .map(|dir| transcription::model_manager::is_model_available(&dir))
        .unwrap_or(false);

    Ok(AppStatus {
        version: env!("CARGO_PKG_VERSION").to_string(),
        recording_available: true,
        ollama_available,
        ffmpeg_available,
        whisper_model_ready,
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

// --- Delete & Rename ---

#[tauri::command]
pub async fn delete_recording(video_id: String) -> Result<(), String> {
    let api_client = ApiClient::from_env();
    api_client.delete_video(&video_id).await
}

#[tauri::command]
pub async fn rename_recording(video_id: String, title: String) -> Result<(), String> {
    let api_client = ApiClient::from_env();
    api_client.update_video_title(&video_id, &title).await
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

// --- Pause/Resume ---

#[tauri::command]
pub async fn pause_recording(
    engine: State<'_, CaptureEngine>,
) -> Result<(), String> {
    engine.pause()
}

#[tauri::command]
pub async fn resume_recording(
    engine: State<'_, CaptureEngine>,
) -> Result<(), String> {
    engine.resume()
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

    // Update tray to recording state (red icon + recording menu)
    crate::update_tray_recording(&app);

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

    // Restore tray to idle state (original icon + idle menu)
    crate::update_tray_idle(&app);

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
    pause_intervals_ms: Option<Vec<[u64; 2]>>,
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

    let pauses = pause_intervals_ms.unwrap_or_default();
    let segmentation = encoding::segment_video_with_pauses(&mov, &segments_dir, &pauses).await?;

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

// --- Thumbnails ---

#[derive(Debug, Clone, Serialize)]
pub struct ThumbnailResult {
    pub path: String,
    pub recording_id: String,
}

/// Extract a thumbnail frame from the recording at ~25% into the video.
#[tauri::command]
pub async fn generate_thumbnail(
    app: tauri::AppHandle,
    recording_id: String,
    mov_path: String,
    duration_ms: u64,
) -> Result<ThumbnailResult, String> {
    let ffmpeg = encoding::find_ffmpeg()?;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let thumb_dir = app_data_dir.join("thumbnails");
    std::fs::create_dir_all(&thumb_dir)
        .map_err(|e| format!("Failed to create thumbnails dir: {e}"))?;

    let thumb_path = thumb_dir.join(format!("{recording_id}.jpg"));
    let seek_seconds = (duration_ms as f64 * 0.25 / 1000.0).max(0.5);

    tracing::info!("Generating thumbnail at {seek_seconds:.1}s for {recording_id}");

    let output = tokio::process::Command::new(&ffmpeg)
        .args([
            "-ss",
            &format!("{seek_seconds:.3}"),
            "-i",
            &mov_path,
            "-vframes",
            "1",
            "-vf",
            "scale=480:-1",
            "-q:v",
            "3",
            "-y",
            &thumb_path.to_string_lossy(),
        ])
        .output()
        .await
        .map_err(|e| format!("FFmpeg thumbnail failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg thumbnail failed: {stderr}"));
    }

    tracing::info!("Thumbnail generated: {}", thumb_path.display());

    Ok(ThumbnailResult {
        path: thumb_path.to_string_lossy().to_string(),
        recording_id,
    })
}

// --- Whisper Model Management ---

#[derive(Debug, Clone, Serialize)]
pub struct WhisperModelStatus {
    pub available: bool,
    pub model_path: Option<String>,
}

#[tauri::command]
pub async fn check_whisper_model(app: tauri::AppHandle) -> Result<WhisperModelStatus, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let available = transcription::model_manager::is_model_available(&app_data_dir);
    let model_path = if available {
        Some(
            transcription::model_manager::default_model_path(&app_data_dir)
                .to_string_lossy()
                .to_string(),
        )
    } else {
        None
    };
    Ok(WhisperModelStatus {
        available,
        model_path,
    })
}

/// Download the Whisper model. Progress emitted via "whisper-download-progress" events.
#[tauri::command]
pub async fn download_whisper_model(app: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    if transcription::model_manager::is_model_available(&app_data_dir) {
        let path = transcription::model_manager::default_model_path(&app_data_dir);
        return Ok(path.to_string_lossy().to_string());
    }

    let app_for_progress = app.clone();
    let model_path = transcription::model_manager::download_model(
        &app_data_dir,
        move |downloaded, total| {
            if let Some(win) = app_for_progress.get_webview_window("main") {
                #[derive(Serialize, Clone)]
                struct DownloadProgress {
                    downloaded: u64,
                    total: u64,
                    percent: u32,
                }
                let pct = if total > 0 {
                    ((downloaded as f64 / total as f64) * 100.0) as u32
                } else {
                    0
                };
                let _ = win.emit(
                    "whisper-download-progress",
                    DownloadProgress {
                        downloaded,
                        total,
                        percent: pct,
                    },
                );
            }
        },
    )
    .await?;

    Ok(model_path.to_string_lossy().to_string())
}

// --- Transcription ---

#[derive(Debug, Clone, Serialize)]
pub struct TranscribeResult {
    pub full_text: String,
    pub language: String,
    pub word_count: usize,
    pub segment_count: usize,
    pub model_used: String,
}

/// Transcribe a recording: extract audio, run Whisper, upload results to backend.
///
/// Progress emitted via "transcription-progress" events.
#[tauri::command]
pub async fn transcribe_recording(
    app: tauri::AppHandle,
    video_id: String,
    mov_path: String,
    language: Option<String>,
) -> Result<TranscribeResult, String> {
    let mov = PathBuf::from(&mov_path);
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // Check model availability
    if !transcription::model_manager::is_model_available(&app_data_dir) {
        return Err("Whisper model not downloaded. Call download_whisper_model first.".into());
    }

    let model_path = transcription::model_manager::default_model_path(&app_data_dir);

    // Emit progress: extracting audio
    emit_transcription_progress(&app, &video_id, "extracting_audio", 0);

    // 1. Extract audio from .mov to 16kHz mono WAV
    tracing::info!("Extracting audio from {}", mov.display());
    let wav_path = transcription::audio::extract_audio_wav(&mov).await?;

    // Emit progress: loading model
    emit_transcription_progress(&app, &video_id, "loading_model", 10);

    // 2. Load WAV as f32 samples
    let audio_samples = transcription::audio::load_wav_as_f32(&wav_path)?;

    // 3. Load Whisper model and transcribe (CPU-intensive, run in blocking thread)
    let lang = language.clone();
    let vid_id = video_id.clone();
    let app_for_progress = app.clone();

    let result = tokio::task::spawn_blocking(move || {
        let engine = transcription::WhisperEngine::new(&model_path)?;

        // Emit progress: transcribing
        emit_transcription_progress(&app_for_progress, &vid_id, "transcribing", 20);

        let lang_ref = lang.as_deref();
        engine.transcribe(&audio_samples, lang_ref, move |progress, _total| {
            // Progress from whisper goes from 0 to 100, map to 20-90 range
            let mapped = 20 + (progress as u32 * 70 / 100);
            // We can't easily emit from here without app handle, so just log
            tracing::debug!("Whisper progress: {progress}%");
            let _ = mapped; // suppress unused warning
        })
    })
    .await
    .map_err(|e| format!("Transcription task panicked: {e}"))??;

    // Emit progress: uploading results
    emit_transcription_progress(&app, &video_id, "uploading", 90);

    // 4. Clean up WAV file
    if let Err(e) = tokio::fs::remove_file(&wav_path).await {
        tracing::warn!("Failed to clean up WAV file: {e}");
    }

    // 5. Upload transcription to backend
    let api_client = ApiClient::from_env();
    let body = SaveTranscriptionBody {
        full_text: result.full_text.clone(),
        language: result.language.clone(),
        model_used: result.model_used.clone(),
        confidence: None,
        words: result
            .words
            .iter()
            .map(|w| TranscriptionWordBody {
                word: w.word.clone(),
                start_ms: w.start_ms,
                end_ms: w.end_ms,
                confidence: w.confidence,
            })
            .collect(),
    };

    if let Err(e) = api_client.save_transcription(&video_id, &body).await {
        tracing::warn!("Failed to upload transcription to backend: {e}");
        // Don't fail the whole command — transcription still succeeded locally
    }

    // Emit progress: done
    emit_transcription_progress(&app, &video_id, "done", 100);

    tracing::info!(
        "Transcription complete for {video_id}: {} words, language: {}",
        result.words.len(),
        result.language
    );

    Ok(TranscribeResult {
        full_text: result.full_text,
        language: result.language,
        word_count: result.words.len(),
        segment_count: result.segments.len(),
        model_used: result.model_used,
    })
}

fn emit_transcription_progress(app: &tauri::AppHandle, video_id: &str, phase: &str, percent: u32) {
    if let Some(win) = app.get_webview_window("main") {
        #[derive(Serialize, Clone)]
        struct TranscriptionProgress {
            video_id: String,
            phase: String,
            percent: u32,
        }
        let _ = win.emit(
            "transcription-progress",
            TranscriptionProgress {
                video_id: video_id.to_string(),
                phase: phase.to_string(),
                percent,
            },
        );
    }
}

// --- Ollama AI Summary ---

#[tauri::command]
pub async fn check_ollama_status(
) -> Result<transcription::summary::OllamaStatus, String> {
    let engine = transcription::OllamaEngine::new();
    Ok(engine.check_status().await)
}

#[derive(Debug, Clone, Serialize)]
pub struct SummaryGenerateResult {
    pub title: String,
    pub summary: String,
    pub key_points: Vec<String>,
    pub action_items: Vec<String>,
    pub topics: Vec<String>,
    pub sentiment: String,
    pub model_used: String,
}

/// Generate an AI summary from a transcript using Ollama, then upload to backend.
///
/// Progress emitted via "summary-progress" events.
#[tauri::command]
pub async fn generate_summary(
    app: tauri::AppHandle,
    video_id: String,
    transcript: String,
) -> Result<SummaryGenerateResult, String> {
    // Emit progress: starting
    emit_summary_progress(&app, &video_id, "generating", 10);

    // 1. Generate summary with Ollama
    tracing::info!("Generating AI summary for {video_id}");
    let engine = transcription::OllamaEngine::new();

    let status = engine.check_status().await;
    if !status.running {
        return Err("Ollama is not running. Please start Ollama first.".into());
    }
    if !status.model_available {
        return Err(format!(
            "Model {} not found in Ollama. Run: ollama pull {}",
            status.model_name, status.model_name
        ));
    }

    emit_summary_progress(&app, &video_id, "generating", 30);

    let result = engine.generate_summary(&transcript).await?;

    emit_summary_progress(&app, &video_id, "uploading", 80);

    // 2. Upload summary to backend
    let api_client = ApiClient::from_env();
    let body = SaveSummaryBody {
        title: Some(result.title.clone()),
        summary: result.summary.clone(),
        key_points: Some(result.key_points.clone()),
        action_items: Some(result.action_items.clone()),
        sentiment: Some(result.sentiment.clone()),
        topics: Some(result.topics.clone()),
        model_used: result.model_used.clone(),
    };

    if let Err(e) = api_client.save_summary(&video_id, &body).await {
        tracing::warn!("Failed to upload summary to backend: {e}");
    }

    emit_summary_progress(&app, &video_id, "done", 100);

    tracing::info!(
        "Summary generated for {video_id}: \"{}\"",
        result.title
    );

    Ok(SummaryGenerateResult {
        title: result.title,
        summary: result.summary,
        key_points: result.key_points,
        action_items: result.action_items,
        topics: result.topics,
        sentiment: result.sentiment,
        model_used: result.model_used,
    })
}

// --- Export MP4 local ---

#[derive(Debug, Clone, Serialize)]
pub struct ExportResult {
    pub destination: String,
    pub size_bytes: u64,
}

/// Export a recording .mov to a user-chosen destination via save dialog.
#[tauri::command]
pub async fn export_recording(
    app: tauri::AppHandle,
    mov_path: String,
    title: String,
) -> Result<ExportResult, String> {
    use tauri_plugin_dialog::DialogExt;

    let source = PathBuf::from(&mov_path);
    if !source.exists() {
        return Err(format!("Source file not found: {mov_path}"));
    }

    // Sanitize title for filename
    let safe_title: String = title
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let default_name = format!("{safe_title}.mov");

    let dest = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Video", &["mov", "mp4"])
        .blocking_save_file();

    let dest = dest.ok_or("Export cancelled by user")?;
    let dest_path = dest.as_path().ok_or("Invalid save path")?;

    tokio::fs::copy(&source, &dest_path)
        .await
        .map_err(|e| format!("Failed to copy file: {e}"))?;

    let size = tokio::fs::metadata(&dest_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    tracing::info!("Exported recording to {}", dest_path.display());

    Ok(ExportResult {
        destination: dest_path.to_string_lossy().to_string(),
        size_bytes: size,
    })
}

// --- Trim recording ---

#[derive(Debug, Clone, Serialize)]
pub struct TrimResult {
    pub output_path: String,
    pub duration_ms: u64,
}

/// Trim a recording: cut start/end using FFmpeg (-c copy, no re-encoding).
#[tauri::command]
pub async fn trim_recording(
    mov_path: String,
    start_ms: u64,
    end_ms: u64,
) -> Result<TrimResult, String> {
    let ffmpeg = encoding::find_ffmpeg()?;
    let source = PathBuf::from(&mov_path);

    if !source.exists() {
        return Err(format!("Source file not found: {mov_path}"));
    }

    if end_ms <= start_ms {
        return Err("End time must be after start time".into());
    }

    let trimmed_path = source.with_file_name(format!(
        "{}_trimmed.mov",
        source.file_stem().unwrap_or_default().to_string_lossy()
    ));

    let start_s = format!("{:.3}", start_ms as f64 / 1000.0);
    let end_s = format!("{:.3}", end_ms as f64 / 1000.0);

    tracing::info!("Trimming {mov_path}: {start_s}s -> {end_s}s");

    let output = tokio::process::Command::new(&ffmpeg)
        .args([
            "-ss", &start_s,
            "-to", &end_s,
            "-i", &mov_path,
            "-c", "copy",
            "-y",
            &trimmed_path.to_string_lossy(),
        ])
        .output()
        .await
        .map_err(|e| format!("FFmpeg trim failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg trim failed: {stderr}"));
    }

    // Replace original with trimmed version
    tokio::fs::rename(&trimmed_path, &source)
        .await
        .map_err(|e| format!("Failed to replace original: {e}"))?;

    let duration = end_ms - start_ms;
    tracing::info!("Trim complete: {}ms", duration);

    Ok(TrimResult {
        output_path: mov_path,
        duration_ms: duration,
    })
}

// --- Import existing video ---

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub recording_id: String,
    pub output_path: String,
    pub duration_ms: u64,
}

/// Import an existing video file: copy to app recordings dir and probe its duration.
#[tauri::command]
pub async fn import_video(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<ImportResult, String> {
    let source = PathBuf::from(&file_path);
    if !source.exists() {
        return Err(format!("File not found: {file_path}"));
    }

    let recording_id = uuid::Uuid::new_v4().to_string();
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let recordings_dir = app_data_dir.join("recordings");
    std::fs::create_dir_all(&recordings_dir)
        .map_err(|e| format!("Failed to create recordings dir: {e}"))?;

    let ext = source.extension().unwrap_or_default().to_string_lossy().to_string();
    let dest = recordings_dir.join(format!("{recording_id}.{ext}"));

    tokio::fs::copy(&source, &dest)
        .await
        .map_err(|e| format!("Failed to copy video: {e}"))?;

    // Probe duration with ffprobe
    let ffmpeg = encoding::find_ffmpeg()?;
    let ffprobe = ffmpeg.with_file_name("ffprobe");
    let probe_bin = if ffprobe.exists() { ffprobe } else { ffmpeg.clone() };

    let output = tokio::process::Command::new(&probe_bin)
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            &dest.to_string_lossy(),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to probe duration: {e}"))?;

    let duration_ms = if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout
            .trim()
            .parse::<f64>()
            .map(|s| (s * 1000.0) as u64)
            .unwrap_or(0)
    } else {
        0
    };

    tracing::info!(
        "Imported video {file_path} as {recording_id} ({}ms)",
        duration_ms
    );

    Ok(ImportResult {
        recording_id,
        output_path: dest.to_string_lossy().to_string(),
        duration_ms,
    })
}

fn emit_summary_progress(app: &tauri::AppHandle, video_id: &str, phase: &str, percent: u32) {
    if let Some(win) = app.get_webview_window("main") {
        #[derive(Serialize, Clone)]
        struct SummaryProgress {
            video_id: String,
            phase: String,
            percent: u32,
        }
        let _ = win.emit(
            "summary-progress",
            SummaryProgress {
                video_id: video_id.to_string(),
                phase: phase.to_string(),
                percent,
            },
        );
    }
}
