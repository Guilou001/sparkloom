use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct ApiClient {
    client: Client,
    base_url: String,
    api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateVideoResponse {
    pub id: String,
    pub share_token: String,
}

#[derive(Debug, Serialize)]
pub struct CreateVideoRequest {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codec: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StopVideoRequest {
    pub duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct UploadSegmentResponse {
    pub r2_key: String,
    pub segment_index: i32,
}

impl ApiClient {
    pub fn new(base_url: &str, api_key: Option<String>) -> Self {
        Self {
            client: Client::new(),
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
        }
    }

    /// Load client configuration from environment variables.
    pub fn from_env() -> Self {
        let base_url =
            std::env::var("SPARKLOOM_API_URL").unwrap_or_else(|_| "http://localhost:8787".into());
        let api_key = std::env::var("SPARKLOOM_API_KEY").ok();
        Self::new(&base_url, api_key)
    }

    fn auth_header(&self) -> Option<String> {
        self.api_key.as_ref().map(|k| format!("Bearer {k}"))
    }

    /// POST /api/videos — Create a new video record on the backend.
    pub async fn create_video(
        &self,
        req: &CreateVideoRequest,
    ) -> Result<CreateVideoResponse, String> {
        let url = format!("{}/api/videos", self.base_url);
        let mut builder = self.client.post(&url).json(req);
        if let Some(auth) = self.auth_header() {
            builder = builder.header("Authorization", auth);
        }

        let resp = builder
            .send()
            .await
            .map_err(|e| format!("Failed to create video: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Create video failed ({status}): {body}"));
        }

        resp.json::<CreateVideoResponse>()
            .await
            .map_err(|e| format!("Failed to parse create video response: {e}"))
    }

    /// PUT /api/videos/:id/segments/:idx — Upload a segment (binary body).
    /// Use idx = -1 for the init segment.
    pub async fn upload_segment(
        &self,
        video_id: &str,
        segment_index: i32,
        data: Vec<u8>,
    ) -> Result<UploadSegmentResponse, String> {
        let url = format!(
            "{}/api/videos/{}/segments/{}",
            self.base_url, video_id, segment_index
        );

        let content_type = if segment_index == -1 {
            "video/mp4"
        } else {
            "video/iso.segment"
        };

        let mut builder = self
            .client
            .put(&url)
            .header("Content-Type", content_type)
            .body(data);

        if let Some(auth) = self.auth_header() {
            builder = builder.header("Authorization", auth);
        }

        let resp = builder
            .send()
            .await
            .map_err(|e| format!("Failed to upload segment {segment_index}: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Upload segment {segment_index} failed ({status}): {body}"
            ));
        }

        resp.json::<UploadSegmentResponse>()
            .await
            .map_err(|e| format!("Failed to parse upload response: {e}"))
    }

    /// POST /api/videos/:id/stop — Mark recording as stopped.
    pub async fn stop_video(
        &self,
        video_id: &str,
        req: &StopVideoRequest,
    ) -> Result<(), String> {
        let url = format!("{}/api/videos/{}/stop", self.base_url, video_id);
        let mut builder = self.client.post(&url).json(req);
        if let Some(auth) = self.auth_header() {
            builder = builder.header("Authorization", auth);
        }

        let resp = builder
            .send()
            .await
            .map_err(|e| format!("Failed to stop video: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Stop video failed ({status}): {body}"));
        }

        Ok(())
    }
}
