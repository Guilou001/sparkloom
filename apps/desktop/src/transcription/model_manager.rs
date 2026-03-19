use std::path::{Path, PathBuf};

use reqwest::Client;
use tokio::io::AsyncWriteExt;

/// Hugging Face URL for the whisper-large-v3-turbo GGML model.
const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin";

/// Expected file size (~1.5GB). Used for progress reporting.
const EXPECTED_SIZE_BYTES: u64 = 1_600_000_000;

/// Model file name.
const MODEL_FILENAME: &str = "ggml-large-v3-turbo.bin";

/// Get the directory where Whisper models are stored.
pub fn models_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("models")
}

/// Get the path to the default Whisper model.
pub fn default_model_path(app_data_dir: &Path) -> PathBuf {
    models_dir(app_data_dir).join(MODEL_FILENAME)
}

/// Check if the model is already downloaded.
pub fn is_model_available(app_data_dir: &Path) -> bool {
    let path = default_model_path(app_data_dir);
    if !path.exists() {
        return false;
    }
    // Check minimum size to avoid partial downloads
    std::fs::metadata(&path)
        .map(|m| m.len() > 100_000_000) // at least 100MB
        .unwrap_or(false)
}

/// Download the Whisper model to the app data directory.
///
/// `on_progress`: callback with (bytes_downloaded, total_bytes).
pub async fn download_model<F>(
    app_data_dir: &Path,
    on_progress: F,
) -> Result<PathBuf, String>
where
    F: Fn(u64, u64) + Send + 'static,
{
    let dir = models_dir(app_data_dir);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create models directory: {e}"))?;

    let model_path = dir.join(MODEL_FILENAME);
    let temp_path = dir.join(format!("{MODEL_FILENAME}.downloading"));

    // If temp file exists from a previous interrupted download, remove it
    if temp_path.exists() {
        let _ = std::fs::remove_file(&temp_path);
    }

    tracing::info!("Downloading Whisper model from {MODEL_URL}");
    tracing::info!("Target: {}", model_path.display());

    let client = Client::new();
    let response = client
        .get(MODEL_URL)
        .send()
        .await
        .map_err(|e| format!("Failed to start model download: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Model download failed with HTTP {}",
            response.status()
        ));
    }

    let total_size = response
        .content_length()
        .unwrap_or(EXPECTED_SIZE_BYTES);

    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|e| format!("Failed to create temp file: {e}"))?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write model data: {e}"))?;

        downloaded += chunk.len() as u64;
        on_progress(downloaded, total_size);
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush model file: {e}"))?;

    drop(file);

    // Rename temp file to final path (atomic on same filesystem)
    tokio::fs::rename(&temp_path, &model_path)
        .await
        .map_err(|e| format!("Failed to rename temp file: {e}"))?;

    tracing::info!(
        "Model download complete: {} ({} bytes)",
        model_path.display(),
        downloaded
    );

    Ok(model_path)
}
