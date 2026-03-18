-- SparkLoom D1 Schema — Initial migration

-- Videos
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    title TEXT DEFAULT 'Sans titre',
    status TEXT CHECK(status IN ('recording','processing','ready','error'))
           DEFAULT 'recording',
    duration_ms INTEGER,
    width INTEGER,
    height INTEGER,
    fps INTEGER,
    codec TEXT DEFAULT 'hevc',
    file_size_bytes INTEGER DEFAULT 0,
    share_token TEXT UNIQUE,
    is_public INTEGER DEFAULT 1,
    view_count INTEGER DEFAULT 0,
    last_segment_index INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    recording_stopped_at TEXT,
    processing_completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_videos_share ON videos(share_token);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);

-- Video segments (tracking what's in R2)
CREATE TABLE IF NOT EXISTS video_segments (
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    segment_index INTEGER NOT NULL,
    r2_key TEXT NOT NULL,
    size_bytes INTEGER,
    duration_ms INTEGER,
    uploaded_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (video_id, segment_index)
);

-- Transcriptions
CREATE TABLE IF NOT EXISTS transcriptions (
    id TEXT PRIMARY KEY,
    video_id TEXT UNIQUE NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    full_text TEXT,
    language TEXT DEFAULT 'fr',
    model_used TEXT DEFAULT 'whisper-large-v3-turbo',
    confidence REAL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Transcript words with timestamps (for click-to-seek)
CREATE TABLE IF NOT EXISTS transcript_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    confidence REAL
);

CREATE INDEX IF NOT EXISTS idx_words_video ON transcript_words(video_id, start_ms);

-- AI summaries
CREATE TABLE IF NOT EXISTS video_summaries (
    id TEXT PRIMARY KEY,
    video_id TEXT UNIQUE NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    title TEXT,
    summary TEXT,
    key_points TEXT,
    action_items TEXT,
    chapters TEXT,
    sentiment TEXT,
    topics TEXT,
    model_used TEXT DEFAULT 'qwen3.5-4b',
    created_at TEXT DEFAULT (datetime('now'))
);
