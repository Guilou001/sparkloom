mod commands;
mod capture;
mod encoding;
mod upload;
mod transcription;
mod storage;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, RunEvent,
};
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("sparkloom=debug".parse().unwrap()))
        .init();

    tracing::info!("Starting SparkLoom");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(capture::CaptureEngine::new())
        .setup(|app| {
            // Build tray menu
            let show = MenuItem::with_id(app, "show", "Show SparkLoom", true, None::<&str>)?;
            let new_recording = MenuItem::with_id(app, "new_recording", "New Recording", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &new_recording, &quit])?;

            // Create tray icon
            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("SparkLoom")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        // Don't show main window if recording (bubble is active)
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
                        // Don't start new recording if already recording
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
                        // Don't show main window if recording (bubble is active)
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
            commands::check_permissions,
            commands::list_displays,
            commands::start_recording,
            commands::stop_recording,
            commands::get_capture_status,
            commands::open_camera_bubble,
            commands::stop_and_close_bubble,
            commands::process_and_upload,
        ])
        .build(tauri::generate_context!())
        .expect("error while building SparkLoom");

    // Handle RunEvent to prevent window reopen during recording
    app.run(|app_handle, event| {
        if let RunEvent::Reopen { .. } = event {
            // macOS: dock icon click or Cmd+Tab — don't show main window if recording
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
