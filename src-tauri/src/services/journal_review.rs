use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HighlightInput {
    pub id: String,
    pub date: String,
    pub summary: String,
    pub result: String,
    pub theme: String,
    pub source_type: String,
    pub source_id: String,
    pub source_revision: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    #[serde(flatten)]
    pub input: HighlightInput,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub source_deleted: bool,
    pub source_changed: bool,
    pub source_revoked: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Material {
    pub source_type: String,
    pub source_id: String,
    pub snapshot: String,
    pub source_deleted: bool,
    pub source_changed: bool,
    pub source_revoked: bool,
}
fn valid_text(s: &str, max: usize, required: bool) -> bool {
    !s.contains('\0') && s.encode_utf16().count() <= max && (!required || !s.is_empty())
}
fn validate(input: &mut HighlightInput, revision: i64) -> Result<(), &'static str> {
    for s in [
        &mut input.id,
        &mut input.summary,
        &mut input.result,
        &mut input.theme,
        &mut input.source_id,
    ] {
        *s = s
            .trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
            .to_owned();
    }
    super::journal_content::period("day", &input.date)?;
    if revision < 0
        || input.source_revision < 0
        || !valid_text(&input.id, 100, true)
        || !valid_text(&input.source_id, 100, true)
        || !valid_text(&input.summary, 20000, true)
        || !valid_text(&input.result, 20000, false)
        || !valid_text(&input.theme, 100, false)
        || !["note", "task", "legacy"].contains(&input.source_type.as_str())
        || (input.source_type == "task" && input.source_revision != 0)
    {
        return Err("INVALID_HIGHLIGHT");
    }
    Ok(())
}
fn map(row: sqlx::sqlite::SqliteRow) -> Highlight {
    Highlight {
        input: HighlightInput {
            id: row.get("id"),
            date: row.get("date"),
            summary: row.get("summary"),
            result: row.get("result"),
            theme: row.get("theme"),
            source_type: row.get("source_type"),
            source_id: row.get("source_id"),
            source_revision: row.get("source_revision"),
        },
        revision: row.get("revision"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        deleted_at: row.get("deleted_at"),
        source_deleted: false,
        source_changed: false,
        source_revoked: false,
    }
}
async fn status(
    tx: &mut Transaction<'_, Sqlite>,
    input: &HighlightInput,
) -> Result<(bool, bool, bool), &'static str> {
    let day = sqlx::query("SELECT content_revision,deleted_at,items_json FROM journal_records WHERE kind='day' AND period_start=?").bind(&input.date).fetch_optional(&mut **tx).await.map_err(|_|"JOURNAL_REVIEW_READ_FAILED")?;
    let trashed = day
        .as_ref()
        .is_some_and(|r| r.get::<Option<String>, _>("deleted_at").is_some());
    if input.source_type == "task" {
        let task =
            sqlx::query("SELECT revoked_at FROM journal_task_completions WHERE id=? AND day=?")
                .bind(&input.source_id)
                .bind(&input.date)
                .fetch_optional(&mut **tx)
                .await
                .map_err(|_| "JOURNAL_REVIEW_READ_FAILED")?;
        return Ok((
            trashed || task.is_none(),
            false,
            task.is_some_and(|r| r.get::<Option<String>, _>("revoked_at").is_some()),
        ));
    }
    let missing_item = input.source_type == "legacy"
        && !day.as_ref().is_some_and(|r| {
            serde_json::from_str::<Value>(&r.get::<String, _>("items_json"))
                .ok()
                .and_then(|v| {
                    v.as_array().map(|a| {
                        a.iter().any(|i| {
                            i["id"].as_str() == Some(&input.source_id) && i["origin"] != "task_auto"
                        })
                    })
                })
                .unwrap_or(false)
        });
    Ok((
        trashed || day.is_none() || missing_item,
        day.as_ref()
            .is_some_and(|r| r.get::<i64, _>("content_revision") != input.source_revision),
        false,
    ))
}
async fn highlight(tx: &mut Transaction<'_, Sqlite>, id: &str) -> Result<Highlight, &'static str> {
    let row = sqlx::query("SELECT * FROM journal_highlights WHERE id=?")
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| "JOURNAL_REVIEW_READ_FAILED")?
        .ok_or("HIGHLIGHT_NOT_FOUND")?;
    let mut h = map(row);
    (h.source_deleted, h.source_changed, h.source_revoked) = status(tx, &h.input).await?;
    Ok(h)
}
pub async fn list(
    pool: &SqlitePool,
    from: &str,
    to: &str,
    include_unavailable: bool,
) -> Result<Vec<Highlight>, &'static str> {
    super::journal_content::period("day", from)?;
    super::journal_content::period("day", to)?;
    if from > to {
        return Err("INVALID_JOURNAL_DATE");
    }
    let mut tx = pool
        .begin()
        .await
        .map_err(|_| "JOURNAL_TRANSACTION_FAILED")?;
    let rows=sqlx::query("SELECT * FROM journal_highlights WHERE date>=? AND date<=? AND deleted_at IS NULL ORDER BY date,id").bind(from).bind(to).fetch_all(&mut *tx).await.map_err(|_|"JOURNAL_REVIEW_READ_FAILED")?;
    let mut result = Vec::new();
    for row in rows {
        let mut h = map(row);
        (h.source_deleted, h.source_changed, h.source_revoked) = status(&mut tx, &h.input).await?;
        if include_unavailable || (!h.source_deleted && !h.source_revoked) {
            result.push(h);
        }
    }
    Ok(result)
}
pub async fn save(
    pool: &SqlitePool,
    mut input: HighlightInput,
    revision: i64,
) -> Result<(), &'static str> {
    validate(&mut input, revision)?;
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|_| "JOURNAL_TRANSACTION_FAILED")?;
    if input.source_type == "note" {
        super::journal_content::ensure_record(&mut tx, "day", &input.date, &input.date).await?;
    }
    let (deleted, changed, revoked) = status(&mut tx, &input).await?;
    if deleted || revoked {
        return Err("HIGHLIGHT_SOURCE_UNAVAILABLE");
    }
    if changed {
        return Err("HIGHLIGHT_SOURCE_CONFLICT");
    }
    let old = sqlx::query(
        "SELECT revision,date,source_type,source_id FROM journal_highlights WHERE id=?",
    )
    .bind(&input.id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| "JOURNAL_REVIEW_READ_FAILED")?;
    if old.as_ref().map_or(0, |r| r.get::<i64, _>("revision")) != revision {
        return Err("HIGHLIGHT_CONFLICT");
    }
    if old.as_ref().is_some_and(|r| {
        r.get::<String, _>("date") != input.date
            || r.get::<String, _>("source_type") != input.source_type
            || r.get::<String, _>("source_id") != input.source_id
    }) {
        return Err("INVALID_HIGHLIGHT_SOURCE");
    }
    let duplicate:i64=sqlx::query_scalar("SELECT count(*) FROM journal_highlights WHERE source_type='task' AND source_id=? AND id<>? AND deleted_at IS NULL").bind(&input.source_id).bind(&input.id).fetch_one(&mut *tx).await.map_err(|_|"JOURNAL_REVIEW_READ_FAILED")?;
    if input.source_type == "task" && duplicate > 0 {
        return Err("HIGHLIGHT_ALREADY_EXISTS");
    }
    let now = super::reminders::timestamp(super::reminders::now());
    sqlx::query("INSERT INTO journal_highlights(id,date,summary,result,theme,source_type,source_id,source_revision,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET summary=excluded.summary,result=excluded.result,theme=excluded.theme,source_revision=excluded.source_revision,revision=journal_highlights.revision+1,updated_at=excluded.updated_at,deleted_at=NULL")
        .bind(input.id).bind(input.date).bind(input.summary).bind(input.result).bind(input.theme).bind(input.source_type).bind(input.source_id).bind(input.source_revision).bind(&now).bind(&now).execute(&mut *tx).await.map_err(|_|"HIGHLIGHT_SAVE_FAILED")?;
    tx.commit().await.map_err(|_| "HIGHLIGHT_SAVE_FAILED")
}
pub async fn remove(pool: &SqlitePool, id: &str, revision: i64) -> Result<(), &'static str> {
    let now = super::reminders::timestamp(super::reminders::now());
    let n=sqlx::query("UPDATE journal_highlights SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND deleted_at IS NULL").bind(&now).bind(&now).bind(id).bind(revision).execute(pool).await.map_err(|_|"HIGHLIGHT_SAVE_FAILED")?.rows_affected();
    if n != 1 {
        return Err("HIGHLIGHT_CONFLICT");
    }
    Ok(())
}
fn plain_doc(text: &str) -> Value {
    json!({"type":"doc","content":text.split('\n').map(|line|if line.is_empty(){json!({"type":"paragraph"})}else{json!({"type":"paragraph","content":[{"type":"text","text":line}]})}).collect::<Vec<_>>()})
}
fn legacy_doc(row: &sqlx::sqlite::SqliteRow) -> Result<Value, &'static str> {
    if let Some(s) = row.get::<Option<String>, _>("content_json") {
        return serde_json::from_str(&s).map_err(|_| "INVALID_CONTENT");
    }
    let title: String = row.get("title");
    let body: String = row.get("body");
    Ok(plain_doc(
        &[title, body]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
    ))
}
fn projection(doc: &Value) -> Result<String, &'static str> {
    if doc["type"] != "doc" {
        return Err("INVALID_CONTENT");
    }
    let mut text = String::new();
    crate::commands::content::document(doc, 0, &mut Vec::new(), &mut text)?;
    let text = super::journal_content::normalized_text(&text);
    if text.contains('\0') || text.encode_utf16().count() > 200000 {
        return Err("CONTENT_TOO_LONG");
    }
    Ok(text.to_owned())
}
fn snapshot(h: &Highlight) -> String {
    [
        format!("{} · {}", h.input.date, h.input.summary),
        if h.input.result.is_empty() {
            String::new()
        } else {
            format!("结果：{}", h.input.result)
        },
        if h.input.theme.is_empty() {
            String::new()
        } else {
            format!("主题：{}", h.input.theme)
        },
        format!("来源：{} 日记重点", h.input.date),
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect::<Vec<_>>()
    .join("\n")
}
async fn covered(
    tx: &mut Transaction<'_, Sqlite>,
    kind: &str,
    start: &str,
) -> Result<Vec<String>, &'static str> {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT highlight_ids FROM journal_review_sources WHERE review_kind=? AND review_start=?",
    )
    .bind(kind)
    .bind(start)
    .fetch_all(&mut **tx)
    .await
    .map_err(|_| "JOURNAL_REVIEW_READ_FAILED")?;
    let mut ids = Vec::new();
    for row in rows {
        ids.extend(serde_json::from_str::<Vec<String>>(&row).map_err(|_| "INVALID_REVIEW_SOURCE")?);
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}
pub async fn add_material(
    pool: &SqlitePool,
    kind: &str,
    start: &str,
    source_type: &str,
    source_id: &str,
    revision: i64,
) -> Result<(), &'static str> {
    if !["month", "year"].contains(&kind) || revision < 0 || !valid_text(source_id, 100, true) {
        return Err("INVALID_REVIEW_SOURCE");
    }
    let end = super::journal_content::period(kind, start)?;
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|_| "JOURNAL_TRANSACTION_FAILED")?;
    let existing:i64=sqlx::query_scalar("SELECT count(*) FROM journal_review_sources WHERE review_kind=? AND review_start=? AND source_type=? AND source_id=?").bind(kind).bind(start).bind(source_type).bind(source_id).fetch_one(&mut *tx).await.map_err(|_|"JOURNAL_REVIEW_READ_FAILED")?;
    // Idempotent retries remain successful even after the first append advanced the document.
    if existing > 0 {
        return Ok(());
    }
    let (text, source_revision, ids) = match source_type {
        "highlight" => {
            let h = highlight(&mut tx, source_id).await?;
            if h.deleted_at.is_some() || h.source_deleted || h.source_revoked {
                return Err("HIGHLIGHT_SOURCE_UNAVAILABLE");
            }
            if h.input.date.as_str() < start || h.input.date > end {
                return Err("REVIEW_SOURCE_OUT_OF_RANGE");
            }
            (snapshot(&h), h.revision, vec![source_id.to_owned()])
        }
        "month" if kind == "year" => {
            let month_end = super::journal_content::period("month", source_id)?;
            if source_id < start || month_end > end {
                return Err("REVIEW_SOURCE_OUT_OF_RANGE");
            }
            let row=sqlx::query("SELECT * FROM journal_records WHERE kind='month' AND period_start=? AND deleted_at IS NULL").bind(source_id).fetch_optional(&mut *tx).await.map_err(|_|"JOURNAL_REVIEW_READ_FAILED")?.ok_or("REVIEW_SOURCE_NOT_FOUND")?;
            let content = projection(&legacy_doc(&row)?)?;
            if content.is_empty() {
                return Err("REVIEW_SOURCE_EMPTY");
            }
            let ids = covered(&mut tx, "month", source_id).await?;
            (
                format!(
                    "{} 月度回顾\n{}\n来源：{} 月度回顾",
                    &source_id[..7],
                    content,
                    source_id
                ),
                row.get("revision"),
                ids,
            )
        }
        _ => return Err("INVALID_REVIEW_SOURCE"),
    };
    let previous = covered(&mut tx, kind, start).await?;
    if ids.iter().any(|id| previous.contains(id)) {
        return Err("REVIEW_SOURCE_OVERLAP_USE_HIGHLIGHTS");
    }
    super::journal_content::ensure_record(&mut tx, kind, start, &end)
        .await?
        .eq(&revision)
        .then_some(())
        .ok_or("JOURNAL_CONTENT_CONFLICT")?;
    let row = sqlx::query("SELECT * FROM journal_records WHERE kind=? AND period_start=?")
        .bind(kind)
        .bind(start)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| "JOURNAL_REVIEW_READ_FAILED")?;
    let mut doc = legacy_doc(&row)?;
    if doc.get("content").is_none() {
        doc["content"] = json!([]);
    }
    let content = doc["content"].as_array_mut().ok_or("INVALID_CONTENT")?;
    content.push(json!({"type":"paragraph"}));
    content.extend(
        plain_doc(&text)["content"]
            .as_array()
            .ok_or("INVALID_CONTENT")?
            .iter()
            .cloned(),
    );
    let body = projection(&doc)?;
    let json = serde_json::to_string(&doc).map_err(|_| "INVALID_CONTENT")?;
    if json.len() > 2000000 {
        return Err("INVALID_CONTENT");
    }
    let now = super::reminders::timestamp(super::reminders::now());
    sqlx::query("UPDATE journal_records SET content_json=?,body=?,content_revision=content_revision+1,revision=revision+1,updated_at=? WHERE kind=? AND period_start=?").bind(json).bind(body).bind(&now).bind(kind).bind(start).execute(&mut *tx).await.map_err(|_|"JOURNAL_REVIEW_SAVE_FAILED")?;
    sqlx::query("INSERT INTO journal_review_sources(review_kind,review_start,source_type,source_id,snapshot,source_revision,highlight_ids,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(kind).bind(start).bind(source_type).bind(source_id).bind(text).bind(source_revision).bind(serde_json::to_string(&ids).map_err(|_|"INVALID_REVIEW_SOURCE")?).bind(now).execute(&mut *tx).await.map_err(|_|"JOURNAL_REVIEW_SAVE_FAILED")?;
    tx.commit().await.map_err(|_| "JOURNAL_REVIEW_SAVE_FAILED")
}
pub async fn materials(
    pool: &SqlitePool,
    kind: &str,
    start: &str,
) -> Result<Vec<Material>, &'static str> {
    if !["month", "year"].contains(&kind) {
        return Err("INVALID_REVIEW_SOURCE");
    }
    super::journal_content::period(kind, start)?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|_| "JOURNAL_TRANSACTION_FAILED")?;
    let rows=sqlx::query("SELECT * FROM journal_review_sources WHERE review_kind=? AND review_start=? ORDER BY created_at,source_type,source_id").bind(kind).bind(start).fetch_all(&mut *tx).await.map_err(|_|"JOURNAL_REVIEW_READ_FAILED")?;
    let mut result = Vec::new();
    for row in rows {
        let source_type: String = row.get("source_type");
        let id: String = row.get("source_id");
        let revision: i64 = row.get("source_revision");
        let (deleted, changed, revoked) = if source_type == "highlight" {
            match highlight(&mut tx, &id).await {
                Ok(h) => (
                    h.deleted_at.is_some() || h.source_deleted,
                    h.source_changed || h.revision != revision,
                    h.source_revoked,
                ),
                Err("HIGHLIGHT_NOT_FOUND") => (true, false, false),
                Err(e) => return Err(e),
            }
        } else {
            let month=sqlx::query("SELECT revision,deleted_at FROM journal_records WHERE kind='month' AND period_start=?").bind(&id).fetch_optional(&mut *tx).await.map_err(|_|"JOURNAL_REVIEW_READ_FAILED")?;
            let ids: Vec<String> = serde_json::from_str(&row.get::<String, _>("highlight_ids"))
                .map_err(|_| "INVALID_REVIEW_SOURCE")?;
            let mut revoked = false;
            let mut deleted = month
                .as_ref()
                .is_none_or(|r| r.get::<Option<String>, _>("deleted_at").is_some());
            let mut changed = month
                .as_ref()
                .is_some_and(|r| r.get::<i64, _>("revision") != revision);
            for id in ids {
                match highlight(&mut tx, &id).await {
                    Ok(h) => {
                        deleted |= h.deleted_at.is_some() || h.source_deleted;
                        changed |= h.source_changed;
                        revoked |= h.source_revoked;
                    }
                    Err("HIGHLIGHT_NOT_FOUND") => deleted = true,
                    Err(e) => return Err(e),
                }
            }
            (deleted, changed, revoked)
        };
        result.push(Material {
            source_type,
            source_id: id,
            snapshot: row.get("snapshot"),
            source_deleted: deleted,
            source_changed: changed,
            source_revoked: revoked,
        });
    }
    Ok(result)
}
#[cfg(test)]
mod tests;
