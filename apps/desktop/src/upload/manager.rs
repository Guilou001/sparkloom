use std::path::Path;
use std::sync::Arc;

use tokio::sync::Semaphore;

use crate::encoding::SegmentationResult;
use crate::upload::r2_client::{ApiClient, StopVideoRequest};

/// Maximum concurrent segment uploads.
const MAX_CONCURRENT_UPLOADS: usize = 3;

/// Maximum retry attempts per segment.
const MAX_RETRIES: u32 = 3;

pub struct UploadManager {
    client: ApiClient,
    semaphore: Arc<Semaphore>,
}

/// Progress info emitted to the UI via Tauri events.
#[derive(Debug, Clone, serde::Serialize)]
pub struct UploadProgress {
    pub video_id: String,
    pub phase: UploadPhase,
    pub uploaded: usize,
    pub total: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadPhase {
    Init,
    Segments,
    Finalizing,
    Done,
    Error,
}

impl UploadManager {
    pub fn new(client: ApiClient) -> Self {
        Self {
            client,
            semaphore: Arc::new(Semaphore::new(MAX_CONCURRENT_UPLOADS)),
        }
    }

    /// Upload all segments for a video.
    ///
    /// Returns the total bytes uploaded on success.
    /// Calls `progress_fn` with progress updates for the UI.
    pub async fn upload_recording(
        &self,
        video_id: &str,
        segmentation: &SegmentationResult,
        duration_ms: u64,
        progress_fn: impl Fn(UploadProgress) + Send + Sync + 'static,
    ) -> Result<u64, String> {
        let progress_fn = Arc::new(progress_fn);
        let video_id_str = video_id.to_string();
        let total = segmentation.media_segments.len() + 1; // +1 for init segment

        // 1. Upload init segment (idx = -1)
        progress_fn(UploadProgress {
            video_id: video_id_str.clone(),
            phase: UploadPhase::Init,
            uploaded: 0,
            total,
            error: None,
        });

        let init_data = tokio::fs::read(&segmentation.init_segment)
            .await
            .map_err(|e| format!("Failed to read init segment: {e}"))?;
        let mut total_bytes = init_data.len() as u64;

        self.upload_with_retry(video_id, -1, init_data).await?;

        tracing::info!("Init segment uploaded for video {video_id}");

        // 2. Upload media segments in parallel (max 3 concurrent)
        progress_fn(UploadProgress {
            video_id: video_id_str.clone(),
            phase: UploadPhase::Segments,
            uploaded: 1,
            total,
            error: None,
        });

        let mut handles = Vec::new();
        let uploaded_count = Arc::new(std::sync::atomic::AtomicUsize::new(1));

        for (idx, seg_path) in segmentation.media_segments.iter().enumerate() {
            let sem = self.semaphore.clone();
            let client = self.client.clone();
            let vid = video_id.to_string();
            let path = seg_path.clone();
            let progress_fn = progress_fn.clone();
            let vid_for_progress = video_id_str.clone();
            let uploaded_count = uploaded_count.clone();

            let handle = tokio::spawn(async move {
                let _permit = sem.acquire().await.map_err(|e| e.to_string())?;

                let data = tokio::fs::read(&path)
                    .await
                    .map_err(|e| format!("Failed to read segment {idx}: {e}"))?;
                let size = data.len() as u64;

                upload_segment_with_retry(&client, &vid, idx as i32, data).await?;

                let count =
                    uploaded_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                progress_fn(UploadProgress {
                    video_id: vid_for_progress,
                    phase: UploadPhase::Segments,
                    uploaded: count,
                    total,
                    error: None,
                });

                tracing::debug!("Segment {idx} uploaded for video {vid}");
                Ok::<u64, String>(size)
            });

            handles.push(handle);
        }

        // Wait for all uploads
        for handle in handles {
            match handle.await {
                Ok(Ok(size)) => total_bytes += size,
                Ok(Err(e)) => return Err(e),
                Err(e) => return Err(format!("Upload task panicked: {e}")),
            }
        }

        tracing::info!(
            "All {} segments uploaded for video {video_id} ({total_bytes} bytes)",
            segmentation.segment_count
        );

        // 3. Finalize — mark video as stopped
        progress_fn(UploadProgress {
            video_id: video_id_str.clone(),
            phase: UploadPhase::Finalizing,
            uploaded: total,
            total,
            error: None,
        });

        self.client
            .stop_video(
                video_id,
                &StopVideoRequest {
                    duration_ms,
                    file_size_bytes: Some(total_bytes),
                },
            )
            .await?;

        progress_fn(UploadProgress {
            video_id: video_id_str,
            phase: UploadPhase::Done,
            uploaded: total,
            total,
            error: None,
        });

        Ok(total_bytes)
    }

    async fn upload_with_retry(
        &self,
        video_id: &str,
        segment_index: i32,
        data: Vec<u8>,
    ) -> Result<(), String> {
        upload_segment_with_retry(&self.client, video_id, segment_index, data).await
    }
}

async fn upload_segment_with_retry(
    client: &ApiClient,
    video_id: &str,
    segment_index: i32,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut last_err = String::new();
    for attempt in 0..MAX_RETRIES {
        match client
            .upload_segment(video_id, segment_index, data.clone())
            .await
        {
            Ok(_) => return Ok(()),
            Err(e) => {
                last_err = e;
                if attempt < MAX_RETRIES - 1 {
                    let delay_ms = 500 * 2u64.pow(attempt);
                    tracing::warn!(
                        "Upload segment {segment_index} attempt {} failed, retrying in {delay_ms}ms: {last_err}",
                        attempt + 1
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                }
            }
        }
    }
    Err(format!(
        "Segment {segment_index} failed after {MAX_RETRIES} attempts: {last_err}"
    ))
}

/// Calculate total file size from segments on disk.
pub fn total_size(init_path: &Path, segments: &[impl AsRef<Path>]) -> u64 {
    let init_size = std::fs::metadata(init_path)
        .map(|m| m.len())
        .unwrap_or(0);
    let seg_size: u64 = segments
        .iter()
        .map(|p| std::fs::metadata(p.as_ref()).map(|m| m.len()).unwrap_or(0))
        .sum();
    init_size + seg_size
}
