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

/// Segment a recording into fMP4, trimming out paused sections first.
///
/// If `pause_intervals_ms` is empty, delegates to `segment_video` directly.
/// Otherwise: extract active (non-paused) sections with FFmpeg `-c copy`,
/// concatenate them, then segment the result into fMP4.
pub async fn segment_video_with_pauses(
    mov_path: &Path,
    output_dir: &Path,
    pause_intervals_ms: &[[u64; 2]],
) -> Result<SegmentationResult, String> {
    if pause_intervals_ms.is_empty() {
        return segment_video(mov_path, output_dir).await;
    }

    let ffmpeg = find_ffmpeg()?;

    if !mov_path.exists() {
        return Err(format!("Input file not found: {}", mov_path.display()));
    }

    // Compute active (non-paused) time ranges.
    // Each active segment: (start_seconds, end_seconds_or_none).
    // end_seconds is None for the last segment (runs to EOF).
    let mut active_segments: Vec<(f64, Option<f64>)> = Vec::new();
    let mut cursor_ms: u64 = 0;

    for interval in pause_intervals_ms {
        let pause_start = interval[0];
        let pause_end = interval[1];
        if pause_start > cursor_ms {
            active_segments.push((cursor_ms as f64 / 1000.0, Some(pause_start as f64 / 1000.0)));
        }
        cursor_ms = pause_end;
    }
    // Final segment from last resume to end of file
    active_segments.push((cursor_ms as f64 / 1000.0, None));

    if active_segments.is_empty() {
        return Err("No active recording segments (entire recording was paused)".into());
    }

    // If only one active segment starting at 0 with no end, no trimming needed
    if active_segments.len() == 1 && active_segments[0].0 == 0.0 && active_segments[0].1.is_none()
    {
        return segment_video(mov_path, output_dir).await;
    }

    tracing::info!(
        "Trimming {} pause intervals from recording before segmentation",
        pause_intervals_ms.len()
    );

    let trim_dir = output_dir
        .parent()
        .unwrap_or(Path::new("/tmp"))
        .join(format!(
            "{}_trim",
            output_dir
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
        ));
    std::fs::create_dir_all(&trim_dir)
        .map_err(|e| format!("Failed to create trim dir: {e}"))?;

    // Extract each active segment with FFmpeg -c copy
    let mut part_files = Vec::new();
    let mov_str = mov_path.to_string_lossy().to_string();
    for (i, (start_s, end_s)) in active_segments.iter().enumerate() {
        let part_path = trim_dir.join(format!("part_{i:03}.mov"));
        let part_str = part_path.to_string_lossy().to_string();
        let start_str = format!("{start_s:.3}");

        let mut args: Vec<String> = vec!["-ss".into(), start_str];
        if let Some(end) = end_s {
            args.push("-to".into());
            args.push(format!("{end:.3}"));
        }
        args.extend([
            "-i".into(),
            mov_str.clone(),
            "-c".into(),
            "copy".into(),
            "-y".into(),
            part_str,
        ]);

        let output = Command::new(&ffmpeg)
            .args(&args)
            .output()
            .await
            .map_err(|e| format!("Failed to extract segment {i}: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::warn!("FFmpeg trim warning for part {i}: {stderr}");
        }

        if part_path.exists() {
            part_files.push(part_path);
        }
    }

    if part_files.is_empty() {
        return Err("FFmpeg produced no active segments after trimming pauses".into());
    }

    // If only one part, segment it directly
    if part_files.len() == 1 {
        let result = segment_video(&part_files[0], output_dir).await?;
        let _ = tokio::fs::remove_dir_all(&trim_dir).await;
        return Ok(result);
    }

    // Create concat file and concatenate all parts
    let concat_file = trim_dir.join("concat.txt");
    let concat_content: String = part_files
        .iter()
        .map(|p| format!("file '{}'\n", p.to_string_lossy()))
        .collect();
    tokio::fs::write(&concat_file, &concat_content)
        .await
        .map_err(|e| format!("Failed to write concat file: {e}"))?;

    let trimmed_path = trim_dir.join("trimmed.mov");
    let output = Command::new(&ffmpeg)
        .args([
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &concat_file.to_string_lossy(),
            "-c",
            "copy",
            "-y",
            &trimmed_path.to_string_lossy(),
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to concatenate: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg concat failed: {stderr}"));
    }

    // Segment the trimmed file into fMP4
    let result = segment_video(&trimmed_path, output_dir).await?;

    // Clean up temp files
    let _ = tokio::fs::remove_dir_all(&trim_dir).await;

    Ok(result)
}
