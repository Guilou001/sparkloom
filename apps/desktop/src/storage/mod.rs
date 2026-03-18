use std::path::Path;
use rusqlite::Connection;
use tracing;

static DB_NAME: &str = "sparkloom.db";

pub fn init_db(app_data_dir: &Path) -> Result<(), String> {
    let db_path = app_data_dir.join(DB_NAME);
    tracing::info!("Initializing local database at {:?}", db_path);

    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS local_recordings (
            id TEXT PRIMARY KEY,
            title TEXT DEFAULT 'Sans titre',
            status TEXT CHECK(status IN ('recording','encoding','uploading','ready','error'))
                   DEFAULT 'recording',
            duration_ms INTEGER,
            file_path TEXT,
            share_token TEXT,
            share_url TEXT,
            cloud_video_id TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS pending_uploads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recording_id TEXT NOT NULL REFERENCES local_recordings(id),
            segment_index INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            status TEXT CHECK(status IN ('pending','uploading','done','error'))
                   DEFAULT 'pending',
            retry_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(recording_id, segment_index)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )
    .map_err(|e| e.to_string())?;

    tracing::info!("Local database initialized");
    Ok(())
}
