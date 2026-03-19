use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// A single word with timestamps from the transcription.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptWord {
    pub word: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub confidence: Option<f32>,
}

/// A segment (sentence/phrase) from the transcription.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

/// Full transcription result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub full_text: String,
    pub language: String,
    pub segments: Vec<TranscriptSegment>,
    pub words: Vec<TranscriptWord>,
    pub model_used: String,
}

/// Thread-safe Whisper context wrapper.
pub struct WhisperEngine {
    ctx: Arc<WhisperContext>,
    model_name: String,
}

impl WhisperEngine {
    /// Load a Whisper GGML model from disk.
    pub fn new(model_path: &Path) -> Result<Self, String> {
        tracing::info!("Loading Whisper model from {}", model_path.display());

        let params = WhisperContextParameters::default();
        let ctx = WhisperContext::new_with_params(model_path, params)
            .map_err(|e| format!("Failed to load Whisper model: {e}"))?;

        let model_name = model_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        tracing::info!("Whisper model loaded: {model_name}");

        Ok(Self {
            ctx: Arc::new(ctx),
            model_name,
        })
    }

    /// Transcribe f32 audio samples (16kHz mono).
    ///
    /// `language`: ISO language code (e.g. "fr", "en") or None for auto-detect.
    /// `on_progress`: callback called with (percent, 100).
    pub fn transcribe<F>(
        &self,
        audio: &[f32],
        language: Option<&str>,
        on_progress: F,
    ) -> Result<TranscriptionResult, String>
    where
        F: Fn(i32, i32) + Send + 'static,
    {
        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| format!("Failed to create Whisper state: {e}"))?;

        let mut params = FullParams::new(SamplingStrategy::BeamSearch {
            beam_size: 5,
            patience: -1.0,
        });

        // Configure language
        if let Some(lang) = language {
            params.set_language(Some(lang));
        } else {
            params.set_language(None); // auto-detect
        }

        // Configure output
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_token_timestamps(true); // needed for word-level timestamps
        params.set_split_on_word(true);

        // Progress callback
        params.set_progress_callback_safe(move |progress| {
            on_progress(progress, 100);
        });

        // Run transcription
        tracing::info!(
            "Starting transcription of {:.1}s audio",
            audio.len() as f64 / 16000.0
        );

        state
            .full(params, audio)
            .map_err(|e| format!("Whisper transcription failed: {e}"))?;

        // Extract results using whisper-rs 0.16.0 API
        let num_segments = state.full_n_segments();

        let mut segments = Vec::new();
        let mut words = Vec::new();
        let mut full_text = String::new();
        let mut detected_language = language.unwrap_or("auto").to_string();

        // Try to get detected language
        if language.is_none() {
            let lang_id = state.full_lang_id_from_state();
            if let Some(lang_str) = whisper_rs::get_lang_str(lang_id) {
                detected_language = lang_str.to_string();
            }
        }

        for i in 0..num_segments {
            let segment = state.get_segment(i).ok_or_else(|| {
                format!("Failed to get segment {i}")
            })?;

            let text = segment
                .to_str()
                .map_err(|e| format!("Failed to get segment text: {e}"))?
                .to_string();

            // Timestamps are in centiseconds (10ms units)
            let start_ms = segment.start_timestamp() * 10;
            let end_ms = segment.end_timestamp() * 10;

            segments.push(TranscriptSegment {
                text: text.clone(),
                start_ms,
                end_ms,
            });

            if !full_text.is_empty() {
                full_text.push(' ');
            }
            full_text.push_str(text.trim());

            // Extract word-level timestamps from token data
            let num_tokens = segment.n_tokens();
            for j in 0..num_tokens {
                if let Some(token) = segment.get_token(j) {
                    let token_text = match token.to_str() {
                        Ok(t) => t.to_string(),
                        Err(_) => continue,
                    };

                    // Skip special tokens and empty tokens
                    let trimmed = token_text.trim();
                    if trimmed.is_empty()
                        || trimmed.starts_with('[')
                        || trimmed.starts_with('<')
                    {
                        continue;
                    }

                    let token_data = token.token_data();
                    let word_start_ms = token_data.t0 * 10;
                    let word_end_ms = token_data.t1 * 10;

                    words.push(TranscriptWord {
                        word: trimmed.to_string(),
                        start_ms: word_start_ms,
                        end_ms: word_end_ms,
                        confidence: Some(token_data.p),
                    });
                }
            }
        }

        tracing::info!(
            "Transcription complete: {} segments, {} words, language: {}",
            segments.len(),
            words.len(),
            detected_language
        );

        Ok(TranscriptionResult {
            full_text,
            language: detected_language,
            segments,
            words,
            model_used: self.model_name.clone(),
        })
    }
}
