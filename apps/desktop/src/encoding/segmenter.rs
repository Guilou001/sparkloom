use std::path::{Path, PathBuf};
use serde::Serialize;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct SegmentationResult {
    pub init_segment: PathBuf,
    pub media_segments: Vec<PathBuf>,
    pub segment_count: usize,
    pub output_dir: PathBuf,
}

/// Locate FFmpeg binary — checks common macOS paths.
pub fn find_ffmpeg() -> Result<PathBuf, String> {
    let candidates = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ];
    for path in &candidates {
        let p = PathBuf::from(path);
        if p.exists() {
            return Ok(p);
        }
    }
    Err("FFmpeg not found. Install with: brew install ffmpeg".into())
}

/// Segment a .mov recording into fMP4 (init.mp4 + seg_XXXXX.m4s).
///
/// Uses `ffmpeg -c copy` (remux, no re-encoding) which is near-instant.
/// Produces HLS-compatible fMP4 segments of ~2 seconds each.
pub async fn segment_video(
    mov_path: &Path,
    output_dir: &Path,
) -> Result<SegmentationResult, String> {
    let ffmpeg = find_ffmpeg()?;

    if !mov_path.exists() {
        return Err(format!("Input file not found: {}", mov_path.display()));
    }

    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("Failed to create output dir: {e}"))?;

    let init_path = output_dir.join("init.mp4");
    let segment_pattern = output_dir.join("seg_%05d.m4s");
    let playlist_path = output_dir.join("playlist.m3u8");

    tracing::info!(
        "Segmenting {} -> {}",
        mov_path.display(),
        output_dir.display()
    );

    let output = Command::new(&ffmpeg)
        .args([
            "-i",
            &mov_path.to_string_lossy(),
            "-c",
            "copy",
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            "-f",
            "hls",
            "-hls_segment_type",
            "fmp4",
            "-hls_time",
            "2",
            "-hls_list_size",
            "0",
            "-hls_fmp4_init_filename",
            &init_path.file_name().unwrap().to_string_lossy(),
            "-hls_segment_filename",
            &segment_pattern.to_string_lossy(),
            &playlist_path.to_string_lossy(),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run FFmpeg: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg segmentation failed: {stderr}"));
    }

    // Collect produced segment files
    let mut media_segments = Vec::new();
    let mut idx = 0u32;
    loop {
        let seg_path = output_dir.join(format!("seg_{:05}.m4s", idx));
        if seg_path.exists() {
            media_segments.push(seg_path);
            idx += 1;
        } else {
            break;
        }
    }

    if !init_path.exists() {
        return Err("FFmpeg did not produce init.mp4".into());
    }

    if media_segments.is_empty() {
        return Err("FFmpeg produced no media segments".into());
    }

    let result = SegmentationResult {
        init_segment: init_path,
        segment_count: media_segments.len(),
        media_segments,
        output_dir: output_dir.to_path_buf(),
    };

    tracing::info!(
        "Segmentation complete: {} segments produced",
        result.segment_count
    );

    Ok(result)
}
