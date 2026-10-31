use crate::{lifecycle::Lifecycle, services::journal_content};
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
pub async fn save_journal_content(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    kind: String,
    start: String,
    json: String,
    revision: i64,
) -> Result<i64, &'static str> {
    let pool = pool(&window).await?;
    let _lease = lifecycle.write()?;
    journal_content::save(&pool, &kind, &start, &json, revision).await
}
#[tauri::command]
pub async fn import_journal_image(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    kind: String,
    start: String,
    mime: String,
    data: Vec<u8>,
) -> Result<i64, &'static str> {
    let pool = pool(&window).await?;
    let _lease = lifecycle.write()?;
    journal_content::import_image(&pool, &kind, &start, &mime, &data).await
}
#[tauri::command]
pub async fn read_journal_image(
    window: WebviewWindow,
    kind: String,
    start: String,
    asset: i64,
) -> Result<(String, Vec<u8>), &'static str> {
    let pool = pool(&window).await?;
    journal_content::read_image(&pool, &kind, &start, asset).await
}

#[tauri::command]
pub async fn prune_journal_images(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    protected_assets: Vec<i64>,
) -> Result<u64, &'static str> {
    let pool = pool(&window).await?;
    let _lease = lifecycle.write()?;
    journal_content::prune_images(&pool, protected_assets).await
}
