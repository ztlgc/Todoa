use crate::{
    lifecycle::Lifecycle,
    services::journal_review::{self, Highlight, HighlightInput, Material},
};
use sqlx::SqlitePool;
use tauri::{Manager, State, WebviewWindow};
async fn pool(window: &WebviewWindow) -> Result<SqlitePool, &'static str> {
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
    crate::db::shared_pool(window.app_handle()).await
}
#[tauri::command]
pub async fn list_journal_highlights(
    window: WebviewWindow,
    from: String,
    to: String,
    include_unavailable: bool,
) -> Result<Vec<Highlight>, &'static str> {
    journal_review::list(&pool(&window).await?, &from, &to, include_unavailable).await
}
#[tauri::command]
pub async fn save_journal_highlight(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    input: HighlightInput,
    revision: i64,
) -> Result<(), &'static str> {
    let pool = pool(&window).await?;
    let _lease = lifecycle.write()?;
    journal_review::save(&pool, input, revision).await
}
#[tauri::command]
pub async fn remove_journal_highlight(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    id: String,
    revision: i64,
) -> Result<(), &'static str> {
    let pool = pool(&window).await?;
    let _lease = lifecycle.write()?;
    journal_review::remove(&pool, &id, revision).await
}
#[tauri::command]
pub async fn add_journal_review_material(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    kind: String,
    start: String,
    source_type: String,
    source_id: String,
    content_revision: i64,
) -> Result<(), &'static str> {
    let pool = pool(&window).await?;
    let _lease = lifecycle.write()?;
    journal_review::add_material(
        &pool,
        &kind,
        &start,
        &source_type,
        &source_id,
        content_revision,
    )
    .await
}
#[tauri::command]
pub async fn journal_review_materials(
    window: WebviewWindow,
    kind: String,
    start: String,
) -> Result<Vec<Material>, &'static str> {
    journal_review::materials(&pool(&window).await?, &kind, &start).await
}
