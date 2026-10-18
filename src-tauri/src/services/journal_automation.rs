use chrono::{DateTime, Local};
use sqlx::{Row, Sqlite, SqlitePool, Transaction};

fn local_day(stamp: &str) -> Result<String, &'static str> {
    Ok(DateTime::parse_from_rfc3339(stamp)
        .map_err(|_| "JOURNAL_COMPLETION_TIME_INVALID")?
        .with_timezone(&Local)
        .format("%Y-%m-%d")
        .to_string())
}

// Called inside the task status transaction, after completed_at has been set.
// Inserting a snapshot never changes a handwritten journal or revives its tombstone.
pub async fn capture(tx: &mut Transaction<'_, Sqlite>, task_id: i64) -> Result<(), &'static str> {
    let row = sqlx::query("SELECT t.id,t.created_at,t.completed_at,t.title,t.notes,t.priority,coalesce(l.name,'') AS theme FROM tasks t LEFT JOIN lists l ON l.id=t.list_id WHERE t.id=? AND t.status='completed' AND t.completed_at IS NOT NULL")
        .bind(task_id).fetch_optional(&mut **tx).await.map_err(|_| "JOURNAL_COMPLETION_READ_FAILED")?
        .ok_or("TASK_NOT_FOUND")?;
    let created: String = row.get("created_at");
    let completed: String = row.get("completed_at");
    let day = local_day(&completed)?;
    let key = format!("auto:{task_id}:{created}:{completed}");
    sqlx::query("INSERT INTO journal_task_completions(id,day,task_id,task_created_at,completed_at,title,notes,theme,important) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(task_id,task_created_at,completed_at) DO UPDATE SET revoked_at=NULL,revoked_day=NULL WHERE journal_task_completions.revoked_at IS NOT NULL")
        .bind(key).bind(day).bind(task_id).bind(created).bind(completed)
        .bind(row.get::<String,_>("title")).bind(row.get::<String,_>("notes"))
        .bind(row.get::<String,_>("theme")).bind(row.get::<String,_>("priority")=="high")
        .execute(&mut **tx).await.map_err(|_| "JOURNAL_COMPLETION_WRITE_FAILED")?;
    Ok(())
}

pub async fn revoke(
    tx: &mut Transaction<'_, Sqlite>,
    task_id: i64,
    now: i64,
) -> Result<(), &'static str> {
    let stamp = super::reminders::timestamp(now);
    let day = local_day(&stamp)?;
    sqlx::query("UPDATE journal_task_completions SET revoked_at=?,revoked_day=? WHERE task_id=? AND task_created_at=(SELECT created_at FROM tasks WHERE id=?) AND revoked_at IS NULL")
        .bind(stamp).bind(day).bind(task_id).bind(task_id).execute(&mut **tx).await.map_err(|_| "JOURNAL_COMPLETION_WRITE_FAILED")?;
    Ok(())
}

// Older versions only retained the current completed_at. Capture those available
// facts once; never reconstruct cleared completion times or overwrite a snapshot.
pub async fn reconcile(pool: &SqlitePool) -> Result<(), &'static str> {
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|_| "JOURNAL_TRANSACTION_FAILED")?;
    let ids: Vec<i64> = sqlx::query_scalar("SELECT t.id FROM tasks t WHERE t.status='completed' AND t.completed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM journal_task_completions c WHERE c.task_id=t.id AND c.task_created_at=t.created_at AND c.completed_at=t.completed_at)")
        .fetch_all(&mut *tx).await.map_err(|_| "JOURNAL_COMPLETION_READ_FAILED")?;
    for id in ids {
        capture(&mut tx, id).await?;
    }
    // A persisted revoked event must stay revoked, including after a restore.
    tx.commit().await.map_err(|_| "JOURNAL_COMMIT_FAILED")
}

#[cfg(test)]
mod tests;
