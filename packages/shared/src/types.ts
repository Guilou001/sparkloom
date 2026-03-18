// --- Video ---

export type VideoStatus = "recording" | "processing" | "ready" | "error";

export interface Video {
  id: string;
  title: string;
  status: VideoStatus;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string;
  file_size_bytes: number;
  share_token: string;
  is_public: boolean;
  view_count: number;
  last_segment_index: number;
  created_at: string;
  recording_stopped_at: string | null;
  processing_completed_at: string | null;
}

export interface CreateVideoRequest {
  title?: string;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
}

export interface CreateVideoResponse {
  id: string;
  share_token: string;
}

export interface UpdateVideoRequest {
  title?: string;
  is_public?: boolean;
}

export interface StopVideoRequest {
  duration_ms: number;
  file_size_bytes?: number;
}

// --- Segments ---

export interface VideoSegment {
  video_id: string;
  segment_index: number;
  r2_key: string;
  size_bytes: number | null;
  duration_ms: number | null;
  uploaded_at: string;
}

export interface UploadSegmentResponse {
  r2_key: string;
  segment_index: number;
}

// --- Transcription ---

export interface Transcription {
  id: string;
  video_id: string;
  full_text: string | null;
  language: string;
  model_used: string;
  confidence: number | null;
  created_at: string;
}

export interface TranscriptWord {
  word: string;
  start_ms: number;
  end_ms: number;
  confidence: number | null;
}

export interface SaveTranscriptionRequest {
  full_text: string;
  language: string;
  model_used: string;
  confidence?: number;
  words: TranscriptWord[];
}

// --- Summary ---

export interface VideoSummary {
  id: string;
  video_id: string;
  title: string | null;
  summary: string | null;
  key_points: string[] | null;
  action_items: string[] | null;
  chapters: Chapter[] | null;
  sentiment: string | null;
  topics: string[] | null;
  model_used: string;
  created_at: string;
}

export interface Chapter {
  start_ms: number;
  end_ms: number;
  title: string;
  summary: string;
}

export interface SaveSummaryRequest {
  title?: string;
  summary: string;
  key_points?: string[];
  action_items?: string[];
  chapters?: Chapter[];
  sentiment?: string;
  topics?: string[];
  model_used: string;
}

// --- API ---

export interface ApiError {
  error: string;
  status: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
}
