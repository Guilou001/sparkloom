use std::path::{Path, PathBuf};
use tokio::process::Command;

use crate::encoding::find_ffmpeg;

/// Extract audio from a video file as 16kHz mono WAV (required by Whisper).
///
/// Uses FFmpeg to remux/transcode the audio track to PCM 16-bit LE, 16kHz, mono.
/// Returns the path to the generated .wav file.
pub async fn extract_audio_wav(video_path: &Path) -> Result<PathBuf, String> {
    let ffmpeg = find_ffmpeg()?;

    if !video_path.exists() {
        return Err(format!("Video file not found: {}", video_path.display()));
    }

    let wav_path = video_path.with_extension("wav");

    tracing::info!(
        "Extracting audio: {} -> {}",
        video_path.display(),
        wav_path.display()
    );

    let output = Command::new(&ffmpeg)
        .args([
            "-i",
            &video_path.to_string_lossy(),
            "-vn",               // no video
            "-acodec",
            "pcm_s16le",         // 16-bit PCM little-endian
            "-ar",
            "16000",             // 16kHz sample rate
            "-ac",
            "1",                 // mono
            "-y",                // overwrite
            &wav_path.to_string_lossy(),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run FFmpeg for audio extraction: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg audio extraction failed: {stderr}"));
    }

    if !wav_path.exists() {
        return Err("FFmpeg did not produce WAV output".into());
    }

    let file_size = std::fs::metadata(&wav_path)
        .map(|m| m.len())
        .unwrap_or(0);

    tracing::info!(
        "Audio extraction complete: {} ({} bytes)",
        wav_path.display(),
        file_size
    );

    Ok(wav_path)
}

/// Load a WAV file as f32 samples normalized to [-1.0, 1.0].
///
/// The WAV file must be 16kHz mono (as produced by `extract_audio_wav`).
pub fn load_wav_as_f32(wav_path: &Path) -> Result<Vec<f32>, String> {
    let reader = hound::WavReader::open(wav_path)
        .map_err(|e| format!("Failed to open WAV file: {e}"))?;

    let spec = reader.spec();
    tracing::info!(
        "WAV spec: {} Hz, {} channels, {} bits, {:?}",
        spec.sample_rate,
        spec.channels,
        spec.bits_per_sample,
        spec.sample_format
    );

    if spec.sample_rate != 16000 {
        return Err(format!(
            "Expected 16kHz WAV, got {} Hz",
            spec.sample_rate
        ));
    }

    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => {
            let max_val = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .into_samples::<i32>()
                .filter_map(|s| s.ok())
                .map(|s| s as f32 / max_val)
                .collect()
        }
        hound::SampleFormat::Float => {
            reader
                .into_samples::<f32>()
                .filter_map(|s| s.ok())
                .collect()
        }
    };

    let duration_secs = samples.len() as f64 / 16000.0;
    tracing::info!(
        "Loaded {} samples ({:.1}s of audio)",
        samples.len(),
        duration_secs
    );

    Ok(samples)
}
