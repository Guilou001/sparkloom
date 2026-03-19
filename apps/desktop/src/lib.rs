mod commands;
mod capture;
mod encoding;
mod upload;
mod transcription;
mod storage;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent,
};
use image::GenericImageView;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tracing_subscriber::EnvFilter;

/// Generate a 22x22 RGBA red circle icon for the tray during recording.
fn create_recording_icon() -> Image<'static> {
    let size = 22u32;
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    let center = size as f64 / 2.0;
    let radius = center - 2.0;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f64 - center;
            let dy = y as f64 - center;
            let dist = (dx * dx + dy * dy).sqrt();
            let idx = ((y * size + x) * 4) as usize;
            if dist <= radius {
                // Anti-aliased edge
                let alpha = if dist > radius - 1.0 {
                    ((radius - dist) * 255.0) as u8
                } else {
                    255
                };
                rgba[idx] = 239;     // R
                rgba[idx + 1] = 68;  // G
                rgba[idx + 2] = 68;  // B
                rgba[idx + 3] = alpha;
            }
        }
    }

    Image::new_owned(rgba, size, size)
}

/// Update the system tray to recording state (red icon, recording menu).
pub(crate) fn update_tray_recording(app: &tauri::AppHandle) {
    let Some(tray) = app.tray_by_id("main-tray") else { return };

    let _ = tray.set_icon(Some(create_recording_icon()));
    #[cfg(target_os = "macos")]
    let _ = tray.set_icon_as_template(false);
    let _ = tray.set_tooltip(Some("SparkLoom — Recording"));

    // Build recording-specific menu
    let Ok(stop) = MenuItem::with_id(app, "stop_recording", "Stop Recording  ⌘⇧R", true, None::<&str>) else { return };
    let Ok(pause) = MenuItem::with_id(app, "pause_recording", "Pause  ⌘⇧P", true, None::<&str>) else { return };
    let Ok(discard) = MenuItem::with_id(app, "discard_recording", "Discard  ⌘⇧D", true, None::<&str>) else { return };
    let Ok(quit) = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>) else { return };
    let Ok(menu) = Menu::with_items(app, &[&stop, &pause, &discard, &quit]) else { return };
    let _ = tray.set_menu(Some(menu));
}

/// Update the system tray back to idle state (original icon, idle menu).
pub(crate) fn update_tray_idle(app: &tauri::AppHandle) {
    let Some(tray) = app.tray_by_id("main-tray") else { return };

    // Decode the original tray icon PNG to raw RGBA
    let png_bytes = include_bytes!("../icons/tray-icon.png");
    if let Ok(img) = image::load_from_memory(png_bytes) {
        let rgba = img.to_rgba8();
        let (w, h) = img.dimensions();
        let _ = tray.set_icon(Some(Image::new_owned(rgba.into_raw(), w, h)));
    }
    #[cfg(target_os = "macos")]
    let _ = tray.set_icon_as_template(true);
    let _ = tray.set_tooltip(Some("SparkLoom"));

    // Build idle menu
    let Ok(show) = MenuItem::with_id(app, "show", "Show SparkLoom", true, None::<&str>) else { return };
    let Ok(new_rec) = MenuItem::with_id(app, "new_recording", "New Recording", true, None::<&str>) else { return };
    let Ok(quit) = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>) else { return };
    let Ok(menu) = Menu::with_items(app, &[&show, &new_rec, &quit]) else { return };
    let _ = tray.set_menu(Some(menu));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("sparkloom=debug".parse().unwrap()))
        .init();

    tracing::info!("Starting SparkLoom");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(capture::CaptureEngine::new())
        .setup(|app| {
            // Build tray menu
            let show = MenuItem::with_id(app, "show", "Show SparkLoom", true, None::<&str>)?;
            let new_recording = MenuItem::with_id(app, "new_recording", "New Recording", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &new_recording, &quit])?;

            // Create tray icon with ID for dynamic updates
            TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .tooltip("SparkLoom")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(engine) = app.try_state::<capture::CaptureEngine>() {
                            if engine.is_recording() {
                                return;
                            }
                        }
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "new_recording" => {
                        if let Some(engine) = app.try_state::<capture::CaptureEngine>() {
                            if engine.is_recording() {
                                return;
                            }
                        }
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("start-recording", ());
                        }
                    }
                    "stop_recording" => {
                        if let Some(window) = app.get_webview_window("camera-bubble") {
                            let _ = window.emit("shortcut-stop", ());
                        }
                    }
                    "pause_recording" => {
                        if let Some(window) = app.get_webview_window("camera-bubble") {
                            let _ = window.emit("shortcut-pause-toggle", ());
                        }
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("shortcut-pause-toggle", ());
                        }
                    }
                    "discard_recording" => {
                        if let Some(window) = app.get_webview_window("camera-bubble") {
                            let _ = window.emit("shortcut-discard", ());
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(engine) = app.try_state::<capture::CaptureEngine>() {
                            if engine.is_recording() {
                                return;
                            }
                        }
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Register global keyboard shortcuts
            let shortcut_record = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyR);
            let shortcut_pause = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyP);
            let shortcut_discard = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyD);

            app.global_shortcut().on_shortcut(shortcut_record, {
                let app_handle = app.handle().clone();
                move |_app, _shortcut, _event| {
                    // Toggle recording: if idle → start, if recording → stop
                    let is_recording = app_handle
                        .try_state::<capture::CaptureEngine>()
                        .map(|e| e.is_recording())
                        .unwrap_or(false);

                    if is_recording {
                        // Emit stop event to camera bubble
                        if let Some(window) = app_handle.get_webview_window("camera-bubble") {
                            let _ = window.emit("shortcut-stop", ());
                        }
                    } else {
                        // Start new recording
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("start-recording", ());
                        }
                    }
                }
            })?;

            app.global_shortcut().on_shortcut(shortcut_pause, {
                let app_handle = app.handle().clone();
                move |_app, _shortcut, _event| {
                    // Toggle pause/resume during recording
                    if let Some(window) = app_handle.get_webview_window("camera-bubble") {
                        let _ = window.emit("shortcut-pause-toggle", ());
                    }
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.emit("shortcut-pause-toggle", ());
                    }
                }
            })?;

            app.global_shortcut().on_shortcut(shortcut_discard, {
                let app_handle = app.handle().clone();
                move |_app, _shortcut, _event| {
                    // Discard current recording
                    if let Some(window) = app_handle.get_webview_window("camera-bubble") {
                        let _ = window.emit("shortcut-discard", ());
                    }
                }
            })?;

            tracing::info!(
                "Global shortcuts registered: Cmd+Shift+R (record), Cmd+Shift+P (pause), Cmd+Shift+D (discard)"
            );

            // Initialize local database
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            storage::init_db(&app_data_dir)?;

            tracing::info!("SparkLoom initialized successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_status,
            commands::get_recordings,
            commands::delete_recording,
            commands::rename_recording,
            commands::check_permissions,
            commands::list_displays,
            commands::start_recording,
            commands::stop_recording,
            commands::pause_recording,
            commands::resume_recording,
            commands::get_capture_status,
            commands::open_camera_bubble,
            commands::stop_and_close_bubble,
            commands::process_and_upload,
            commands::generate_thumbnail,
            commands::check_whisper_model,
            commands::download_whisper_model,
            commands::transcribe_recording,
            commands::check_ollama_status,
            commands::generate_summary,
            commands::export_recording,
            commands::trim_recording,
            commands::import_video,
        ])
        .build(tauri::generate_context!())
        .expect("error while building SparkLoom");

    // Handle RunEvent to prevent window reopen during recording
    app.run(|app_handle, event| {
        if let RunEvent::Reopen { .. } = event {
            if let Some(engine) = app_handle.try_state::<capture::CaptureEngine>() {
                if engine.is_recording() {
                    return;
                }
            }
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
}
