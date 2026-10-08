use crate::{
    lifecycle::Lifecycle,
    preferences::{Preferences, PreferencesState},
    reminder_scheduler::Scheduler,
};
use std::sync::Arc;
use tauri::{Emitter, Manager, State, WebviewWindow};
fn source(window: &WebviewWindow) -> Result<(), &'static str> {
    super::quick_add::source(window.label(), "main")
}
#[tauri::command]
pub fn get_app_preferences(window: WebviewWindow) -> Result<Preferences, &'static str> {
    source(&window)?;
    Ok(window
        .app_handle()
        .try_state::<Arc<PreferencesState>>()
        .ok_or("PREFERENCES_NOT_READY")?
        .snapshot())
}
#[tauri::command]
pub async fn set_app_preferences(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    input: Preferences,
) -> Result<Preferences, &'static str> {
    source(&window)?;
    let _guard = lifecycle.write()?;
    let pool = crate::db::shared_pool(window.app_handle()).await?;
    let state = window
        .app_handle()
        .try_state::<Arc<PreferencesState>>()
        .ok_or("PREFERENCES_NOT_READY")?
        .inner()
        .clone();
    let saved = state.save(&pool, input).await?;
    if let Some(s) = window.app_handle().try_state::<Arc<Scheduler>>() {
        s.changed();
    }
    let _ = window
        .app_handle()
        .emit_to("main", "preferences-changed", ());
    Ok(saved)
}
#[tauri::command]
pub fn test_system_notification(window: WebviewWindow) -> Result<(), &'static str> {
    source(&window)?;
    use tauri_plugin_notification::NotificationExt;
    match crate::reminder_scheduler::system_availability(window.app_handle()) {
        "ready" | "notification-setting-unknown" => {}
        code => return Err(code),
    }
    window
        .app_handle()
        .notification()
        .builder()
        .title("Todoa 通知测试")
        .body("这是一条测试通知。如果你看到了它，说明本次系统通知已显示。")
        .show()
        .map_err(|_| "NOTIFICATION_API_FAILED")
}
