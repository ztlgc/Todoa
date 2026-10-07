use crate::lifecycle::Lifecycle;
use serde_json::Value;
use sqlx::{Row, SqlitePool};
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

fn document(
    node: &Value,
    depth: usize,
    assets: &mut Vec<i64>,
    text: &mut String,
) -> Result<(), &'static str> {
    if depth > 64 {
        return Err("CONTENT_TOO_DEEP");
    }
    let kind = node["type"].as_str().ok_or("INVALID_CONTENT")?;
    if ![
        "doc",
        "paragraph",
        "text",
        "hardBreak",
        "heading",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "codeBlock",
        "horizontalRule",
        "image",
    ]
    .contains(&kind)
    {
        return Err("INVALID_CONTENT");
    }
    if let Some(marks) = node.get("marks") {
        for mark in marks.as_array().ok_or("INVALID_CONTENT")? {
            let t = mark["type"].as_str().ok_or("INVALID_CONTENT")?;
            if ![
                "bold",
                "italic",
                "underline",
                "strike",
                "highlight",
                "code",
                "link",
            ]
            .contains(&t)
            {
                return Err("INVALID_CONTENT");
            }
            if t == "link" {
                let href = mark["attrs"]["href"].as_str().ok_or("INVALID_LINK")?;
                if !href.starts_with("https://")
                    && !href.starts_with("http://")
                    && !href.starts_with("mailto:")
                {
                    return Err("INVALID_LINK");
                }
            }
        }
    }
    if kind == "text" {
        text.push_str(node["text"].as_str().ok_or("INVALID_CONTENT")?);
    }
    if kind == "image" {
        let src = node["attrs"]["src"].as_str().ok_or("INVALID_IMAGE")?;
        let id = src
            .strip_prefix("todoa-asset:")
            .ok_or("INVALID_IMAGE")?
            .parse::<i64>()
            .map_err(|_| "INVALID_IMAGE")?;
        if id <= 0 {
            return Err("INVALID_IMAGE");
        }
        assets.push(id);
    }
    if let Some(children) = node.get("content") {
        for child in children.as_array().ok_or("INVALID_CONTENT")? {
            document(child, depth + 1, assets, text)?;
        }
    }
    if ["paragraph", "heading", "hardBreak", "listItem"].contains(&kind) {
        text.push('\n');
    }
    Ok(())
}

pub async fn save(
    pool: &SqlitePool,
    id: i64,
    title: String,
    json: String,
    revision: i64,
) -> Result<i64, &'static str> {
    if title.trim().is_empty()
        || title.chars().count() > 500
        || title.contains('\0')
        || json.len() > 2_000_000
    {
        return Err("INVALID_CONTENT");
    }
    let doc: Value = serde_json::from_str(&json).map_err(|_| "INVALID_CONTENT")?;
    if doc["type"] != "doc" {
        return Err("INVALID_CONTENT");
    }
    let mut assets = vec![];
    let mut text = String::new();
    document(&doc, 0, &mut assets, &mut text)?;
    if text.chars().count() > 100_000 {
        return Err("CONTENT_TOO_LONG");
    }
    let mut tx = pool.begin().await.map_err(|_| "CONTENT_SAVE_FAILED")?;
    for asset in assets {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM task_asset_refs WHERE task_id=? AND asset_id=?",
        )
        .bind(id)
        .bind(asset)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| "CONTENT_SAVE_FAILED")?;
        if count != 1 {
            return Err("IMAGE_NOT_FOUND");
        }
    }
    let now = crate::services::reminders::timestamp(crate::services::reminders::now());
    let result = sqlx::query("UPDATE tasks SET title=?,notes=?,content_json=?,content_revision=content_revision+1,updated_at=? WHERE id=? AND deleted_at IS NULL AND content_revision=?")
        .bind(title.trim()).bind(text.trim_end()).bind(json).bind(now).bind(id).bind(revision).execute(&mut *tx).await.map_err(|_| "CONTENT_SAVE_FAILED")?;
    if result.rows_affected() != 1 {
        return Err("CONTENT_CONFLICT");
    }
    tx.commit().await.map_err(|_| "CONTENT_SAVE_FAILED")?;
    Ok(revision + 1)
}

#[tauri::command]
pub async fn save_task_content(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    id: i64,
    title: String,
    json: String,
    revision: i64,
) -> Result<i64, &'static str> {
    let pool = pool(&window).await?;
    let _guard = lifecycle.write()?;
    save(&pool, id, title, json, revision).await
}
#[tauri::command]
pub async fn import_task_image(
    window: WebviewWindow,
    lifecycle: State<'_, Lifecycle>,
    id: i64,
    mime: String,
    data: Vec<u8>,
) -> Result<i64, &'static str> {
    let pool = pool(&window).await?;
    let _guard = lifecycle.write()?;
    let signature = match mime.as_str() {
        "image/png" => data.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => data.starts_with(b"\xff\xd8\xff"),
        "image/webp" => data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP"),
        _ => false,
    };
    if !signature || data.len() > 10_485_760 {
        return Err("INVALID_IMAGE");
    }
    let mut tx = pool.begin().await.map_err(|_| "IMAGE_IMPORT_FAILED")?;
    let exists: i64 =
        sqlx::query_scalar("SELECT count(*) FROM tasks WHERE id=? AND deleted_at IS NULL")
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|_| "IMAGE_IMPORT_FAILED")?;
    if exists != 1 {
        return Err("TASK_NOT_FOUND");
    }
    let asset = sqlx::query("INSERT INTO task_assets(mime,data) VALUES(?,?)")
        .bind(mime)
        .bind(data)
        .execute(&mut *tx)
        .await
        .map_err(|_| "IMAGE_IMPORT_FAILED")?
        .last_insert_rowid();
    sqlx::query("INSERT INTO task_asset_refs(task_id,asset_id) VALUES(?,?)")
        .bind(id)
        .bind(asset)
        .execute(&mut *tx)
        .await
        .map_err(|_| "IMAGE_IMPORT_FAILED")?;
    tx.commit().await.map_err(|_| "IMAGE_IMPORT_FAILED")?;
    Ok(asset)
}
#[tauri::command]
pub async fn read_task_image(
    window: WebviewWindow,
    id: i64,
    asset: i64,
) -> Result<(String, Vec<u8>), &'static str> {
    let pool = pool(&window).await?;
    let row=sqlx::query("SELECT mime,data FROM task_assets a JOIN task_asset_refs r ON r.asset_id=a.id WHERE r.task_id=? AND a.id=?").bind(id).bind(asset).fetch_optional(&pool).await.map_err(|_| "IMAGE_READ_FAILED")?.ok_or("IMAGE_NOT_FOUND")?;
    Ok((row.get("mime"), row.get("data")))
}
