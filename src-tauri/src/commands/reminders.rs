use crate::{
    lifecycle::Lifecycle,
    reminder_scheduler::Scheduler,
    services::{reminders, schedule},
};
use std::sync::Arc;
use tauri::{Emitter, Manager, State, WebviewWindow};
fn source(window: &WebviewWindow) -> Result<(), &'static str> {
    super::quick_add::source(window.label(), "main")?;
    if !matches!(
        window
            .app_handle()
            .try_state::<crate::db::BootState>()
            .as_deref(),
        Some(crate::db::BootState::Ready)
    ) {
        return Err("DATABASE_NOT_READY");
    }
    Ok(())
}
fn changed(window: &WebviewWindow) {
    if let Some(s) = window.app_handle().try_state::<Arc<Scheduler>>() {
        s.changed();
    }
    let _ = window.app_handle().emit_to("main", "reminders-changed", ());
}
#[tauri::command]
pub async fn create_scheduled_task(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    input: schedule::ScheduledInput,
) -> Result<i64, &'static str> {
    source(&window)?;
    let _guard = lifecycle.write()?;
    let pool = crate::db::shared_pool(window.app_handle()).await?;
    let id = schedule::create(&pool, input, reminders::now()).await?;
    changed(&window);
    Ok(id)
}
#[tauri::command]
pub async fn update_task_schedule(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    id: i64,
    input: schedule::ScheduledUpdate,
) -> Result<(), &'static str> {
    source(&window)?;
    let _guard = lifecycle.write()?;
    let pool = crate::db::shared_pool(window.app_handle()).await?;
    schedule::update(&pool, id, input, reminders::now()).await?;
    changed(&window);
    Ok(())
}
#[tauri::command]
pub async fn create_reminder(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    task_id: i64,
    remind_at: String,
) -> Result<i64, &'static str> {
    source(&window)?;
    let _guard = lifecycle.write()?;
    let pool = crate::db::shared_pool(window.app_handle()).await?;
    let id = reminders::create(&pool, task_id, &remind_at, reminders::now()).await?;
    changed(&window);
    Ok(id)
}
#[tauri::command]
pub async fn edit_reminder(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    id: i64,
    remind_at: String,
) -> Result<(), &'static str> {
    source(&window)?;
    let _guard = lifecycle.write()?;
    let pool = crate::db::shared_pool(window.app_handle()).await?;
    reminders::edit(&pool, id, &remind_at, reminders::now()).await?;
    changed(&window);
    Ok(())
}
#[tauri::command]
pub async fn delete_reminder(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    id: i64,
) -> Result<(), &'static str> {
    source(&window)?;
    let _guard = lifecycle.write()?;
    let pool = crate::db::shared_pool(window.app_handle()).await?;
    reminders::delete(&pool, id).await?;
    changed(&window);
    Ok(())
}
#[tauri::command]
pub async fn update_task_status(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    id: i64,
    status: String,
) -> Result<(), &'static str> {
    source(&window)?;
    let _guard = lifecycle.write()?;
    let pool = crate::db::shared_pool(window.app_handle()).await?;
    reminders::update_status(&pool, id, &status, reminders::now()).await?;
    changed(&window);
    Ok(())
}
#[tauri::command]
pub fn reconcile_reminders(window: WebviewWindow) -> Result<(), &'static str> {
    source(&window)?;
    changed(&window);
    Ok(())
}
#[tauri::command]
pub fn reminder_scheduler_status(window: WebviewWindow) -> Result<&'static str, &'static str> {
    source(&window)?;
    Ok(window
        .app_handle()
        .try_state::<Arc<Scheduler>>()
        .map_or("database-not-ready", |s| s.status()))
}
