use ollama_rs::{
    generation::chat::{request::ChatMessageRequest, ChatMessage},
    Ollama,
};
use serde::{Deserialize, Serialize};

const DEFAULT_MODEL: &str = "qwen3.5:4b";
const OLLAMA_HOST: &str = "http://localhost";
const OLLAMA_PORT: u16 = 11434;

const SYSTEM_PROMPT: &str = r#"You are an AI assistant that analyzes video transcriptions. Given a transcription, output ONLY a valid JSON object with these exact fields:
- "title": concise title for the video (max 10 words)
- "summary": 2-3 sentence summary of the content
- "key_points": array of 3-5 key takeaways (strings)
- "action_items": array of actionable items mentioned (empty array if none)
- "topics": array of 2-4 topic tags (single words or short phrases)
- "sentiment": one of "informative", "positive", "negative", "neutral", "tutorial", "discussion"

Output ONLY valid JSON. No markdown, no code blocks, no explanation."#;

#[derive(Debug, Clone, Serialize)]
pub struct SummaryResult {
    pub title: String,
    pub summary: String,
    pub key_points: Vec<String>,
    pub action_items: Vec<String>,
    pub topics: Vec<String>,
    pub sentiment: String,
    pub model_used: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OllamaStatus {
    pub running: bool,
    pub model_available: bool,
    pub model_name: String,
}

#[derive(Debug, Deserialize)]
struct SummaryJson {
    title: Option<String>,
    summary: Option<String>,
    key_points: Option<Vec<String>>,
    action_items: Option<Vec<String>>,
    topics: Option<Vec<String>>,
    sentiment: Option<String>,
}

pub struct OllamaEngine {
    ollama: Ollama,
    model: String,
}

impl OllamaEngine {
    pub fn new() -> Self {
        Self {
            ollama: Ollama::new(OLLAMA_HOST.to_string(), OLLAMA_PORT),
            model: DEFAULT_MODEL.to_string(),
        }
    }

    /// Check if Ollama is running and the model is available.
    pub async fn check_status(&self) -> OllamaStatus {
        let mut status = OllamaStatus {
            running: false,
            model_available: false,
            model_name: self.model.clone(),
        };

        match self.ollama.list_local_models().await {
            Ok(models) => {
                status.running = true;
                status.model_available = models.iter().any(|m| m.name.contains("qwen3.5"));
            }
            Err(_) => {}
        }

        status
    }

    /// Generate a summary from a transcript using Ollama.
    pub async fn generate_summary(&self, transcript: &str) -> Result<SummaryResult, String> {
        // Truncate very long transcripts to stay within model context
        let truncated = if transcript.len() > 12000 {
            &transcript[..12000]
        } else {
            transcript
        };

        let user_prompt = format!(
            "Analyze the following video transcription and generate a structured summary:\n\n{}",
            truncated
        );

        let messages = vec![
            ChatMessage::system(SYSTEM_PROMPT.to_string()),
            ChatMessage::user(user_prompt),
        ];

        let request = ChatMessageRequest::new(self.model.clone(), messages)
            .format(ollama_rs::generation::parameters::FormatType::Json);

        let response = self
            .ollama
            .send_chat_messages(request)
            .await
            .map_err(|e| format!("Ollama request failed: {e}"))?;

        let content = response.message.content;

        if content.is_empty() {
            return Err("Ollama returned an empty response".to_string());
        }

        tracing::debug!("Ollama raw response: {}", &content[..content.len().min(500)]);

        parse_summary_response(&content, &self.model)
    }
}

fn parse_summary_response(content: &str, model: &str) -> Result<SummaryResult, String> {
    // Try parsing as JSON directly
    let parsed: SummaryJson = serde_json::from_str(content)
        .map_err(|e| format!("Failed to parse Ollama JSON response: {e}\nRaw: {content}"))?;

    Ok(SummaryResult {
        title: parsed.title.unwrap_or_else(|| "Sans titre".to_string()),
        summary: parsed
            .summary
            .unwrap_or_else(|| "No summary generated.".to_string()),
        key_points: parsed.key_points.unwrap_or_default(),
        action_items: parsed.action_items.unwrap_or_default(),
        topics: parsed.topics.unwrap_or_default(),
        sentiment: parsed.sentiment.unwrap_or_else(|| "neutral".to_string()),
        model_used: model.to_string(),
    })
}
