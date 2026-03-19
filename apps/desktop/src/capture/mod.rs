pub mod screen;
pub mod audio;
pub mod camera;
pub mod permissions;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use screencapturekit::prelude::*;
use screencapturekit::recording_output::{
    SCRecordingOutput, SCRecordingOutputCodec, SCRecordingOutputConfiguration,
    SCRecordingOutputDelegate, SCRecordingOutputFileType,
};
use serde::Serialize;

// --- Types ---

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CaptureStatus {
    Idle,
    Recording,
    Paused,
    Stopping,
}

#[derive(Debug, Clone, Serialize)]
pub struct StartResult {
    pub recording_id: String,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StopResult {
    pub recording_id: String,
    pub output_path: String,
    pub duration_ms: u64,
    pub video_frames: u64,
    pub audio_buffers: u64,
    /// Pause intervals as `[start_offset_ms, end_offset_ms]` relative to recording start.
    pub pause_intervals_ms: Vec<[u64; 2]>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CaptureStatusInfo {
    pub status: CaptureStatus,
    pub video_frames: u64,
    pub audio_buffers: u64,
    pub duration_ms: u64,
}

// --- Frame handler ---

struct FrameCounter {
    video_frames: Arc<AtomicU64>,
    audio_buffers: Arc<AtomicU64>,
}

impl SCStreamOutputTrait for FrameCounter {
    fn did_output_sample_buffer(&self, _sample: CMSampleBuffer, output_type: SCStreamOutputType) {
        match output_type {
            SCStreamOutputType::Screen => {
                self.video_frames.fetch_add(1, Ordering::Relaxed);
            }
            SCStreamOutputType::Audio => {
                self.audio_buffers.fetch_add(1, Ordering::Relaxed);
            }
            _ => {}
        }
    }
}

// --- Recording delegate ---

struct RecordingDelegate;

impl SCRecordingOutputDelegate for RecordingDelegate {
    fn recording_did_start(&self) {
        tracing::info!("Recording file output started");
    }

    fn recording_did_fail(&self, error: String) {
        tracing::error!("Recording file output failed: {error}");
    }

    fn recording_did_finish(&self) {
        tracing::info!("Recording file output finished");
    }
}

// --- CaptureEngine ---

struct CaptureInner {
    status: CaptureStatus,
    stream: Option<SCStream>,
    recording_output: Option<SCRecordingOutput>,
    recording_id: Option<String>,
    output_path: Option<PathBuf>,
    started_at: Option<std::time::Instant>,
    /// Each entry is (pause_start, pause_end). End is None if currently paused.
    pause_intervals: Vec<(std::time::Instant, Option<std::time::Instant>)>,
}

pub struct CaptureEngine {
    inner: Mutex<CaptureInner>,
    video_frames: Arc<AtomicU64>,
    audio_buffers: Arc<AtomicU64>,
}

impl CaptureEngine {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(CaptureInner {
                status: CaptureStatus::Idle,
                stream: None,
                recording_output: None,
                recording_id: None,
                output_path: None,
                started_at: None,
                pause_intervals: Vec::new(),
            }),
            video_frames: Arc::new(AtomicU64::new(0)),
            audio_buffers: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn is_recording(&self) -> bool {
        let inner = self.inner.lock().unwrap();
        inner.status == CaptureStatus::Recording || inner.status == CaptureStatus::Paused
    }

    pub fn is_paused(&self) -> bool {
        let inner = self.inner.lock().unwrap();
        inner.status == CaptureStatus::Paused
    }

    pub fn pause(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        if inner.status != CaptureStatus::Recording {
            return Err("Not recording".to_string());
        }
        inner.status = CaptureStatus::Paused;
        inner.pause_intervals.push((std::time::Instant::now(), None));
        tracing::info!("Recording paused");
        Ok(())
    }

    pub fn resume(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        if inner.status != CaptureStatus::Paused {
            return Err("Not paused".to_string());
        }
        inner.status = CaptureStatus::Recording;
        if let Some(last) = inner.pause_intervals.last_mut() {
            last.1 = Some(std::time::Instant::now());
        }
        tracing::info!("Recording resumed");
        Ok(())
    }

    pub fn status_info(&self) -> CaptureStatusInfo {
        let inner = self.inner.lock().unwrap();
        let raw_duration = inner
            .started_at
            .map(|t| t.elapsed().as_millis() as u64)
            .unwrap_or(0);

        // Subtract paused time for effective duration
        let paused_ms: u64 = inner
            .pause_intervals
            .iter()
            .map(|(start, end)| {
                let end_time = end.unwrap_or_else(std::time::Instant::now);
                (end_time - *start).as_millis() as u64
            })
            .sum();

        CaptureStatusInfo {
            status: inner.status.clone(),
            video_frames: self.video_frames.load(Ordering::Relaxed),
            audio_buffers: self.audio_buffers.load(Ordering::Relaxed),
            duration_ms: raw_duration.saturating_sub(paused_ms),
        }
    }

    pub fn start(&self, display_id: Option<u32>) -> Result<StartResult, String> {
        let mut inner = self.inner.lock().unwrap();

        if inner.status == CaptureStatus::Recording {
            return Err("Already recording".to_string());
        }

        // Get display
        let display = screen::get_display(display_id)?;
        let width = display.width() as u32;
        let height = display.height() as u32;

        tracing::info!("Starting capture on display {width}x{height}");

        // Create filter (capture full display, exclude nothing)
        let filter = SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .build();

        // Configure stream: video + system audio + microphone
        let config = SCStreamConfiguration::new()
            .with_width(width)
            .with_height(height)
            .with_pixel_format(PixelFormat::BGRA)
            .with_shows_cursor(true)
            .with_captures_audio(true)
            .with_sample_rate(audio::SAMPLE_RATE)
            .with_channel_count(audio::CHANNEL_COUNT);

        // Prepare output directory: ~/Movies/SparkLoom/
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        let output_dir = PathBuf::from(&home).join("Movies").join("SparkLoom");
        std::fs::create_dir_all(&output_dir)
            .map_err(|e| format!("Failed to create output dir: {e}"))?;

        let recording_id = uuid::Uuid::new_v4().to_string();
        let output_path = output_dir.join(format!("{recording_id}.mov"));

        // Configure recording output (HEVC hardware encoding, .mov)
        let rec_config = SCRecordingOutputConfiguration::new()
            .with_output_url(&output_path)
            .with_video_codec(SCRecordingOutputCodec::HEVC)
            .with_output_file_type(SCRecordingOutputFileType::MOV);

        let recording_output =
            SCRecordingOutput::new_with_delegate(&rec_config, RecordingDelegate)
                .ok_or("Failed to create recording output (requires macOS 15+)")?;

        // Create stream
        let mut stream = SCStream::new(&filter, &config);

        // Add frame counter (tracks video/audio buffer counts)
        self.video_frames.store(0, Ordering::Relaxed);
        self.audio_buffers.store(0, Ordering::Relaxed);
        let handler = FrameCounter {
            video_frames: self.video_frames.clone(),
            audio_buffers: self.audio_buffers.clone(),
        };
        stream.add_output_handler(handler, SCStreamOutputType::Screen);

        // Add recording output for direct file writing
        stream
            .add_recording_output(&recording_output)
            .map_err(|e| format!("Failed to add recording output: {e}"))?;

        // Start capture
        stream
            .start_capture()
            .map_err(|e| format!("Failed to start capture: {e}"))?;

        // Update state
        inner.status = CaptureStatus::Recording;
        inner.stream = Some(stream);
        inner.recording_output = Some(recording_output);
        inner.recording_id = Some(recording_id.clone());
        inner.output_path = Some(output_path.clone());
        inner.started_at = Some(std::time::Instant::now());
        inner.pause_intervals.clear();

        tracing::info!("Capture started: {recording_id} -> {}", output_path.display());

        Ok(StartResult {
            recording_id,
            output_path: output_path.to_string_lossy().to_string(),
        })
    }

    pub fn stop(&self) -> Result<StopResult, String> {
        let mut inner = self.inner.lock().unwrap();

        if inner.status != CaptureStatus::Recording && inner.status != CaptureStatus::Paused {
            return Err("Not recording".to_string());
        }

        // Close current pause interval if paused
        if inner.status == CaptureStatus::Paused {
            if let Some(last) = inner.pause_intervals.last_mut() {
                if last.1.is_none() {
                    last.1 = Some(std::time::Instant::now());
                }
            }
        }

        inner.status = CaptureStatus::Stopping;

        // Take ownership of stream and recording output
        let stream = inner.stream.take();
        let rec_output = inner.recording_output.take();

        // Remove recording output first (flushes file writer)
        if let (Some(s), Some(ref ro)) = (stream, rec_output) {
            let _ = s.remove_recording_output(ro);
            s.stop_capture()
                .map_err(|e| format!("Failed to stop capture: {e}"))?;
        }

        let raw_duration_ms = inner
            .started_at
            .map(|t| t.elapsed().as_millis() as u64)
            .unwrap_or(0);

        // Calculate effective duration (minus paused time)
        let paused_ms: u64 = inner
            .pause_intervals
            .iter()
            .map(|(start, end)| {
                let end_time = end.unwrap_or_else(std::time::Instant::now);
                (end_time - *start).as_millis() as u64
            })
            .sum();

        // Convert pause intervals to ms offsets from recording start
        let started_at = inner.started_at.unwrap_or_else(std::time::Instant::now);
        let pause_intervals_ms: Vec<[u64; 2]> = inner
            .pause_intervals
            .iter()
            .map(|(start, end)| {
                let start_offset = (*start - started_at).as_millis() as u64;
                let end_offset = end
                    .map(|e| (e - started_at).as_millis() as u64)
                    .unwrap_or(raw_duration_ms);
                [start_offset, end_offset]
            })
            .collect();

        let result = StopResult {
            recording_id: inner.recording_id.clone().unwrap_or_default(),
            output_path: inner
                .output_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
            duration_ms: raw_duration_ms.saturating_sub(paused_ms),
            video_frames: self.video_frames.load(Ordering::Relaxed),
            audio_buffers: self.audio_buffers.load(Ordering::Relaxed),
            pause_intervals_ms,
        };

        // Reset state
        inner.status = CaptureStatus::Idle;
        inner.recording_id = None;
        inner.output_path = None;
        inner.started_at = None;
        inner.pause_intervals.clear();

        tracing::info!(
            "Capture stopped: {} ({} ms effective, {} pauses, {} video frames, {} audio buffers)",
            result.recording_id,
            result.duration_ms,
            result.pause_intervals_ms.len(),
            result.video_frames,
            result.audio_buffers
        );

        Ok(result)
    }
}
