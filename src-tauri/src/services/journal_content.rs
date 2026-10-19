use chrono::{Datelike, Duration, NaiveDate};
use serde_json::Value;
use sqlx::{Row, Sqlite, SqlitePool, Transaction};

fn period(kind: &str, start: &str) -> Result<String, &'static str> {
    let day = NaiveDate::parse_from_str(start, "%Y-%m-%d").map_err(|_| "INVALID_JOURNAL_DATE")?;
    if start.len() != 10 || day.year() < 1000 || day.to_string() != start {
        return Err("INVALID_JOURNAL_DATE");
    }
    let end = match kind {
        "day" => day,
        "week" if day.weekday().num_days_from_monday() == 0 => day
            .checked_add_signed(Duration::days(6))
            .ok_or("INVALID_JOURNAL_DATE")?,
        "month" if day.day() == 1 => {
            let next = if day.month() == 12 {
                NaiveDate::from_ymd_opt(day.year() + 1, 1, 1)
            } else {
                NaiveDate::from_ymd_opt(day.year(), day.month() + 1, 1)
            };
            next.and_then(|date| date.pred_opt())
                .ok_or("INVALID_JOURNAL_DATE")?
        }
        "year" if day.month() == 1 && day.day() == 1 => {
            NaiveDate::from_ymd_opt(day.year(), 12, 31).ok_or("INVALID_JOURNAL_DATE")?
        }
        _ => return Err("INVALID_JOURNAL_DATE"),
    };
    if end.year() > 9999 {
        return Err("INVALID_JOURNAL_DATE");
    }
    Ok(end.to_string())
}

async fn ensure_record(
    tx: &mut Transaction<'_, Sqlite>,
    kind: &str,
    start: &str,
    end: &str,
) -> Result<i64, &'static str> {
    let now = super::reminders::timestamp(super::reminders::now());
    sqlx::query("INSERT INTO journal_records(kind,period_start,period_end,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(kind,period_start) DO NOTHING")
        .bind(kind).bind(start).bind(end).bind(&now).bind(&now).execute(&mut **tx).await.map_err(|_|"JOURNAL_CONTENT_SAVE_FAILED")?;
    let row = sqlx::query(
        "SELECT content_revision,deleted_at FROM journal_records WHERE kind=? AND period_start=?",
    )
    .bind(kind)
    .bind(start)
    .fetch_one(&mut **tx)
    .await
    .map_err(|_| "JOURNAL_CONTENT_READ_FAILED")?;
    if row.get::<Option<String>, _>("deleted_at").is_some() {
        return Err("JOURNAL_IN_TRASH");
    }
    Ok(row.get("content_revision"))
}

pub async fn save(
    pool: &SqlitePool,
    kind: &str,
    start: &str,
    json: &str,
    revision: i64,
) -> Result<i64, &'static str> {
    let end = period(kind, start)?;
    if revision < 0 || json.len() > 2_000_000 {
        return Err("INVALID_CONTENT");
    }
    let doc: Value = serde_json::from_str(json).map_err(|_| "INVALID_CONTENT")?;
    if doc["type"] != "doc" {
        return Err("INVALID_CONTENT");
    }
    let mut assets = Vec::new();
    let mut text = String::new();
    crate::commands::content::document(&doc, 0, &mut assets, &mut text)?;
    if text.contains('\0') || text.encode_utf16().count() > 200_000 {
        return Err("CONTENT_TOO_LONG");
    }
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|_| "JOURNAL_TRANSACTION_FAILED")?;
    if ensure_record(&mut tx, kind, start, &end).await? != revision {
        return Err("JOURNAL_CONTENT_CONFLICT");
    }
    for asset in assets {
        let exists: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM journal_assets WHERE id=? AND kind=? AND period_start=?",
        )
        .bind(asset)
        .bind(kind)
        .bind(start)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| "JOURNAL_CONTENT_SAVE_FAILED")?;
        if exists != 1 {
            return Err("IMAGE_NOT_FOUND");
        }
    }
    let now = super::reminders::timestamp(super::reminders::now());
    sqlx::query("UPDATE journal_records SET body=?,content_json=?,content_revision=content_revision+1,revision=revision+1,updated_at=? WHERE kind=? AND period_start=?")
        .bind(text.trim_end()).bind(json).bind(now).bind(kind).bind(start).execute(&mut *tx).await.map_err(|_|"JOURNAL_CONTENT_SAVE_FAILED")?;
    tx.commit()
        .await
        .map_err(|_| "JOURNAL_CONTENT_SAVE_FAILED")?;
    Ok(revision + 1)
}

pub async fn import_image(
    pool: &SqlitePool,
    kind: &str,
    start: &str,
    mime: &str,
    data: &[u8],
) -> Result<i64, &'static str> {
    let end = period(kind, start)?;
    let signature = match mime {
        "image/png" => data.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => data.starts_with(b"\xff\xd8\xff"),
        "image/webp" => data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP"),
        _ => false,
    };
    if !signature || data.len() > 10_485_760 {
        return Err("INVALID_IMAGE");
    }
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|_| "IMAGE_IMPORT_FAILED")?;
    ensure_record(&mut tx, kind, start, &end).await?;
    let id = sqlx::query("INSERT INTO journal_assets(kind,period_start,mime,data) VALUES(?,?,?,?)")
        .bind(kind)
        .bind(start)
        .bind(mime)
        .bind(data)
        .execute(&mut *tx)
        .await
        .map_err(|_| "IMAGE_IMPORT_FAILED")?
        .last_insert_rowid();
    tx.commit().await.map_err(|_| "IMAGE_IMPORT_FAILED")?;
    Ok(id)
}

pub async fn read_image(
    pool: &SqlitePool,
    kind: &str,
    start: &str,
    asset: i64,
) -> Result<(String, Vec<u8>), &'static str> {
    period(kind, start)?;
    let row = sqlx::query(
        "SELECT mime,data FROM journal_assets WHERE id=? AND kind=? AND period_start=?",
    )
    .bind(asset)
    .bind(kind)
    .bind(start)
    .fetch_optional(pool)
    .await
    .map_err(|_| "IMAGE_READ_FAILED")?
    .ok_or("IMAGE_NOT_FOUND")?;
    Ok((row.get("mime"), row.get("data")))
}

#[cfg(test)]
mod tests;
