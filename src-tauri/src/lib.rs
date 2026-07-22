mod audio;
mod providers;

use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const KEYRING_SERVICE: &str = "voicepill";
const DEFAULT_HOTKEY: &str = "CmdOrCtrl+Shift+Space";

struct AppState {
    recorder: Mutex<Option<audio::RecordingSession>>,
    last_wav: Mutex<Vec<u8>>,
}

// ---------- Aufnahme ----------

#[tauri::command]
fn start_recording(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    let mut rec = state.recorder.lock().unwrap();
    if rec.is_some() {
        return Err("Aufnahme läuft bereits".into());
    }
    *rec = Some(audio::RecordingSession::start(app)?);
    Ok(())
}

#[tauri::command]
fn stop_recording(state: tauri::State<AppState>) -> Result<f32, String> {
    let session = state
        .recorder
        .lock()
        .unwrap()
        .take()
        .ok_or("Keine Aufnahme aktiv")?;
    let (wav, duration) = session.finish()?;
    *state.last_wav.lock().unwrap() = wav;
    Ok(duration)
}

#[tauri::command]
fn cancel_recording(state: tauri::State<AppState>) -> Result<(), String> {
    if let Some(session) = state.recorder.lock().unwrap().take() {
        session.cancel();
    }
    Ok(())
}

// ---------- Transkription & Verfeinerung ----------

#[tauri::command]
async fn transcribe(
    state: tauri::State<'_, AppState>,
    provider: String,
    model: String,
    language: String,
    custom_endpoint: String,
) -> Result<String, String> {
    let wav = state.last_wav.lock().unwrap().clone();
    if wav.is_empty() {
        return Err("Keine Audiodaten vorhanden".into());
    }
    let token = get_keyring_token(&provider).unwrap_or_default();
    if token.is_empty() && custom_endpoint.trim().is_empty() {
        return Err(format!("Kein API-Token für '{provider}' hinterlegt. Bitte in den Einstellungen speichern."));
    }
    providers::transcribe(&provider, &model, &language, &token, &custom_endpoint, wav).await
}

#[tauri::command]
async fn refine(
    provider: String,
    model: String,
    system_prompt: String,
    text: String,
    custom_endpoint: String,
) -> Result<String, String> {
    let token = get_keyring_token(&format!("llm:{provider}")).unwrap_or_default();
    if token.is_empty() && custom_endpoint.trim().is_empty() {
        return Err(format!("Kein API-Token für '{provider}' hinterlegt. Bitte in den Einstellungen speichern."));
    }
    providers::refine(&provider, &model, &system_prompt, &text, &token, &custom_endpoint).await
}

// ---------- Einfügen ----------

#[tauri::command]
fn paste_text(text: String, auto_paste: bool) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())?;

    if auto_paste {
        std::thread::sleep(Duration::from_millis(150));
        use enigo::{
            Direction::{Click, Press, Release},
            Enigo, Key, Keyboard, Settings,
        };
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        let modifier = Key::Meta;
        #[cfg(not(target_os = "macos"))]
        let modifier = Key::Control;

        enigo.key(modifier, Press).map_err(|e| e.to_string())?;
        enigo
            .key(Key::Unicode('v'), Click)
            .map_err(|e| e.to_string())?;
        enigo.key(modifier, Release).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- Tokens (Keyring) ----------

fn get_keyring_token(key: &str) -> Result<String, String> {
    keyring::Entry::new(KEYRING_SERVICE, key)
        .map_err(|e| e.to_string())?
        .get_password()
        .map_err(|_| format!("Kein API-Token für '{key}' hinterlegt. Bitte in den Einstellungen speichern."))
}

#[tauri::command]
fn set_token(key: String, token: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?;
    if token.trim().is_empty() {
        let _ = entry.delete_credential();
        Ok(())
    } else {
        entry.set_password(token.trim()).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn has_token(key: String) -> bool {
    keyring::Entry::new(KEYRING_SERVICE, &key)
        .and_then(|e| e.get_password())
        .is_ok()
}

#[tauri::command]
fn get_token(key: String) -> Result<String, String> {
    get_keyring_token(&key)
}

// ---------- Einstellungen ----------

fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

fn default_settings() -> serde_json::Value {
    serde_json::json!({
        "stt_provider": "groq",
        "stt_model": "whisper-large-v3-turbo",
        "language": "de",
        "hotkey": DEFAULT_HOTKEY,
        "auto_paste": true,
        "stt_custom_endpoint": "",
        "refine_custom_endpoint": "",
        "refine_enabled": false,
        "refine_provider": "anthropic",
        "refine_model": "claude-haiku-4-5",
        "refine_preset": "cleanup",
        "custom_prompt": ""
    })
}

fn read_settings(app: &tauri::AppHandle) -> serde_json::Value {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(default_settings)
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> serde_json::Value {
    // Defaults mit gespeicherten Werten mischen, damit neue Felder nie fehlen
    let mut merged = default_settings();
    let stored = read_settings(&app);
    if let (Some(m), Some(s)) = (merged.as_object_mut(), stored.as_object()) {
        for (k, v) in s {
            m.insert(k.clone(), v.clone());
        }
    }
    merged
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let path = settings_path(&app)?;
    std::fs::write(&path, serde_json::to_string_pretty(&settings).unwrap())
        .map_err(|e| e.to_string())?;
    let _ = app.emit("settings-changed", ());
    Ok(())
}

#[tauri::command]
fn update_hotkey(app: tauri::AppHandle, hotkey: String) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(hotkey.as_str())
        .map_err(|e| format!("Hotkey '{hotkey}' konnte nicht registriert werden: {e}"))
}

#[tauri::command]
fn set_pill_click_through(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    if let Some(pill) = app.get_webview_window("pill") {
        let _ = pill.set_ignore_cursor_events(ignore);
    }
    Ok(())
}

// ---------- App ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = app.emit("hotkey-toggle", ());
                    }
                })
                .build(),
        )
        .manage(AppState {
            recorder: Mutex::new(None),
            last_wav: Mutex::new(Vec::new()),
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            cancel_recording,
            transcribe,
            refine,
            paste_text,
            set_token,
            has_token,
            get_token,
            load_settings,
            save_settings,
            update_hotkey,
            set_pill_click_through
        ])
        .setup(|app| {
            // Pille oben mittig positionieren und Klick-Durchlässigkeit aktivieren
            if let Some(pill) = app.get_webview_window("pill") {
                if let Ok(Some(monitor)) = pill.primary_monitor() {
                    let screen = monitor.size();
                    let pill_w = pill.outer_size().map(|s| s.width).unwrap_or(300);
                    let x = ((screen.width.saturating_sub(pill_w)) / 2) as i32;
                    let _ = pill.set_position(tauri::PhysicalPosition::new(x, 16));
                }
                let _ = pill.set_ignore_cursor_events(true);
            }

            // Hotkey aus Einstellungen registrieren
            let settings = read_settings(app.handle());
            let hotkey = settings["hotkey"].as_str().unwrap_or(DEFAULT_HOTKEY).to_string();
            if app.global_shortcut().register(hotkey.as_str()).is_err() {
                let _ = app.global_shortcut().register(DEFAULT_HOTKEY);
            }

            // Tray-Menü
            let settings_item = MenuItem::with_id(app, "settings", "Einstellungen…", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "VoicePill beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&settings_item, &quit_item])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "settings" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Einstellungsfenster schließen = verstecken, App läuft weiter
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von VoicePill");
}
