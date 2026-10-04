use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::{db, services};

pub fn source(label: &str, expected: &str) -> Result<(), &'static str> {
    if label == expected {
        Ok(())
    } else {
        Err("WINDOW_NOT_ALLOWED")
    }
}

#[tauri::command]
pub fn show_quick_add(window: WebviewWindow, app: AppHandle) -> Result<(), &'static str> {
    source(window.label(), "main")?;
    show_existing(&app)
}

pub fn show_existing(app: &AppHandle) -> Result<(), &'static str> {
    if app.state::<crate::lifecycle::Lifecycle>().is_quitting() {
        return Err("APP_QUITTING");
    }
    let quick = app
        .get_webview_window("quick-add")
        .ok_or("QUICK_ADD_NOT_AVAILABLE")?;
    quick.unminimize().map_err(|_| "QUICK_ADD_SHOW_FAILED")?;
    quick.show().map_err(|_| "QUICK_ADD_SHOW_FAILED")?;
    quick.set_focus().map_err(|_| "QUICK_ADD_FOCUS_FAILED")?;
    if app.emit_to("quick-add", "quick-add-shown", ()).is_err() {
        eprintln!("QUICK_ADD_FOCUS_EVENT_FAILED");
    }
    Ok(())
}

#[tauri::command]
pub fn hide_quick_add(window: WebviewWindow) -> Result<(), &'static str> {
    source(window.label(), "quick-add")?;
    window.hide().map_err(|_| "QUICK_ADD_HIDE_FAILED")
}

#[tauri::command]
pub async fn create_quick_task(
    window: WebviewWindow,
    app: AppHandle,
    status: State<'_, db::BootState>,
    title: String,
) -> Result<i64, &'static str> {
    source(window.label(), "quick-add")?;
    if !matches!(*status, db::BootState::Ready) {
        return Err("DATABASE_NOT_READY");
    }
    services::quick_add::title(&title)?;
    let _write = app.state::<crate::lifecycle::Lifecycle>().write()?;
    let pool = db::shared_pool(&app).await?;
    let id = services::quick_add::create(&pool, &title).await?;
    // The INSERT is already committed. Failed notification must not cause a retry.
    if app.emit_to("main", "task-created", id).is_err() {
        eprintln!("QUICK_ADD_EVENT_FAILED");
    }
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::source;
    #[test]
    fn validates_injected_window_source() {
        assert_eq!(source("main", "main"), Ok(()));
        assert_eq!(source("quick-add", "quick-add"), Ok(()));
        assert_eq!(source("quick-add", "main"), Err("WINDOW_NOT_ALLOWED"));
        assert_eq!(source("main", "quick-add"), Err("WINDOW_NOT_ALLOWED"));
        assert_eq!(source("acl-probe", "quick-add"), Err("WINDOW_NOT_ALLOWED"));
    }
}
