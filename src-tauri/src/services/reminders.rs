use chrono::{DateTime, SecondsFormat, Utc};
use sqlx::{Row, SqlitePool};

pub fn timestamp(ms: i64) -> String {
    DateTime::from_timestamp_millis(ms)
        .expect("valid clock")
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}
pub fn now() -> i64 {
    Utc::now().timestamp_millis()
}
pub fn id(value: i64) -> Result<(), &'static str> {
    if !(1..=9_007_199_254_740_991).contains(&value) {
        return Err("INVALID_ID");
    }
    Ok(())
}
pub fn future(value: &str, now: i64) -> Result<String, &'static str> {
    let time = DateTime::parse_from_rfc3339(value).map_err(|_| "INVALID_REMINDER_TIME")?;
    let canonical = time
        .with_timezone(&Utc)
        .to_rfc3339_opts(SecondsFormat::Millis, true);
    if canonical.len() != 24 || time.timestamp_millis() <= now {
        return Err("REMINDER_MUST_BE_FUTURE");
    }
    Ok(canonical)
}
pub async fn create(
    pool: &SqlitePool,
    task_id: i64,
    value: &str,
    now: i64,
) -> Result<i64, &'static str> {
    id(task_id)?;
    let time = future(value, now)?;
    let stamp = timestamp(now);
    let result = sqlx::query("INSERT INTO reminders(task_id,remind_at,created_at,updated_at) SELECT id,?,?,? FROM tasks WHERE id=? AND status='todo'")
        .bind(time).bind(&stamp).bind(&stamp).bind(task_id).execute(pool).await.map_err(|_| "REMINDER_CREATE_FAILED")?;
    if result.rows_affected() != 1 {
        return Err("TASK_NOT_TODO");
    }
    Ok(result.last_insert_rowid())
}
pub async fn edit(
    pool: &SqlitePool,
    reminder_id: i64,
    value: &str,
    now: i64,
) -> Result<(), &'static str> {
    id(reminder_id)?;
    let time = future(value, now)?;
    let result = sqlx::query("UPDATE reminders SET remind_at=?,updated_at=? WHERE id=? AND triggered_at IS NULL AND EXISTS(SELECT 1 FROM tasks WHERE tasks.id=reminders.task_id AND status='todo')")
        .bind(time).bind(timestamp(now)).bind(reminder_id).execute(pool).await.map_err(|_| "REMINDER_EDIT_FAILED")?;
    if result.rows_affected() != 1 {
        return Err("REMINDER_NOT_EDITABLE");
    }
    Ok(())
}
pub async fn delete(pool: &SqlitePool, reminder_id: i64) -> Result<(), &'static str> {
    id(reminder_id)?;
    let result = sqlx::query("DELETE FROM reminders WHERE id=?")
        .bind(reminder_id)
        .execute(pool)
        .await
        .map_err(|_| "REMINDER_DELETE_FAILED")?;
    if result.rows_affected() != 1 {
        return Err("REMINDER_NOT_FOUND");
    }
    Ok(())
}
pub async fn update_status(
    pool: &SqlitePool,
    task_id: i64,
    status: &str,
    now: i64,
) -> Result<(), &'static str> {
    id(task_id)?;
    if !matches!(status, "todo" | "completed") {
        return Err("INVALID_STATUS");
    }
    let mut tx = pool.begin().await.map_err(|_| "TASK_TRANSACTION_FAILED")?;
    let stamp = timestamp(now);
    let result = sqlx::query("UPDATE tasks SET completed_at=CASE WHEN status=? THEN completed_at WHEN ?='completed' THEN ? ELSE NULL END,updated_at=CASE WHEN status=? THEN updated_at ELSE ? END,status=? WHERE id=?")
        .bind(status).bind(status).bind(&stamp).bind(status).bind(&stamp).bind(status).bind(task_id).execute(&mut *tx).await.map_err(|_| "TASK_STATUS_FAILED")?;
    if result.rows_affected() != 1 {
        return Err("TASK_NOT_FOUND");
    }
    if status == "completed" {
        sqlx::query("DELETE FROM reminders WHERE task_id=? AND triggered_at IS NULL")
            .bind(task_id)
            .execute(&mut *tx)
            .await
            .map_err(|_| "REMINDER_CANCEL_FAILED")?;
    }
    tx.commit().await.map_err(|_| "TASK_COMMIT_FAILED")
}
#[derive(Clone)]
pub struct Pending {
    pub id: i64,
    pub time: String,
    pub title: String,
}
pub async fn pending(pool: &SqlitePool) -> Result<Vec<Pending>, sqlx::Error> {
    let rows = sqlx::query("SELECT r.id,r.remind_at,t.title FROM reminders r JOIN tasks t ON t.id=r.task_id WHERE r.triggered_at IS NULL AND t.status='todo' ORDER BY r.remind_at,r.id").fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|r| Pending {
            id: r.get("id"),
            time: r.get("remind_at"),
            title: r.get("title"),
        })
        .collect())
}
