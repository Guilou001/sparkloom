use screencapturekit::prelude::*;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DisplayInfo {
    pub id: u32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

/// List all available displays for capture.
pub fn list_displays() -> Result<Vec<DisplayInfo>, String> {
    let content = SCShareableContent::get()
        .map_err(|e| format!("Failed to get shareable content: {e}"))?;

    let displays = content.displays();
    Ok(displays
        .into_iter()
        .enumerate()
        .map(|(i, d)| DisplayInfo {
            id: d.display_id(),
            width: d.width() as u32,
            height: d.height() as u32,
            is_primary: i == 0,
        })
        .collect())
}

/// Get a specific display by ID, or the primary display if no ID is given.
pub fn get_display(display_id: Option<u32>) -> Result<SCDisplay, String> {
    let content = SCShareableContent::get()
        .map_err(|e| format!("Screen recording permission denied: {e}"))?;

    if let Some(id) = display_id {
        content
            .displays()
            .into_iter()
            .find(|d| d.display_id() == id)
            .ok_or_else(|| format!("Display {id} not found"))
    } else {
        content
            .displays()
            .into_iter()
            .next()
            .ok_or_else(|| "No displays found".to_string())
    }
}
