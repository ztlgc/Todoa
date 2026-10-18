use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use serde_json::Value;
use sqlx::{Row, SqlitePool};

pub async fn create_follow_up(
    pool: &SqlitePool,
    date: &str,
    item_id: &str,
    now: i64,
) -> Result<i64, &'static str> {
    if NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|value| value.to_string())
        .as_deref()
        != Ok(date)
        || item_id.is_empty()
        || item_id.chars().count() > 100
        || item_id.contains('\0')
    {
        return Err("INVALID_JOURNAL_SOURCE");
    }
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|_| "JOURNAL_TRANSACTION_FAILED")?;
    let row = sqlx::query("SELECT items_json,revision FROM journal_records WHERE kind='day' AND period_start=? AND deleted_at IS NULL")
        .bind(date).fetch_optional(&mut *tx).await.map_err(|_| "JOURNAL_READ_FAILED")?.ok_or("JOURNAL_NOT_FOUND")?;
    let mut items: Vec<Value> = serde_json::from_str(&row.get::<String, _>("items_json"))
        .map_err(|_| "INVALID_JOURNAL_SOURCE")?;
    let item = items
        .iter_mut()
        .find(|value| value["id"].as_str() == Some(item_id))
        .ok_or("JOURNAL_ITEM_NOT_FOUND")?;
    if let (Some(id), Some(created)) = (
        item["followUpTaskId"].as_i64(),
        item["followUpTaskCreatedAt"].as_str(),
    ) {
        let task = sqlx::query("SELECT deleted_at FROM tasks WHERE id=? AND created_at=?")
            .bind(id)
            .bind(created)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| "TASK_READ_FAILED")?;
        if let Some(task) = task {
            if task.get::<Option<String>, _>("deleted_at").is_some() {
                return Err("FOLLOW_UP_IN_TRASH");
            }
            tx.commit().await.map_err(|_| "JOURNAL_COMMIT_FAILED")?;
            return Ok(id);
        }
    }
    let action = item["nextAction"].as_str().unwrap_or("").trim();
    let client = item["client"].as_str().unwrap_or("").trim();
    let original = item["title"].as_str().unwrap_or("");
    let business = item["business"].as_str().unwrap_or("");
    let notes = item["notes"].as_str().unwrap_or("");
    if action.is_empty()
        || action.chars().count() > 500
        || client.chars().count() > 200
        || original.chars().count() > 500
        || notes.chars().count() > 20000
        || [action, client, original, business, notes]
            .iter()
            .any(|text| text.contains('\0'))
    {
        return Err("INVALID_FOLLOW_UP");
    }
    let title: String = if client.is_empty() {
        action.to_string()
    } else {
        format!("{client} · {action}")
    }
    .chars()
    .take(500)
    .collect();
    let notes = format!("来源：工作日记 {date}\n原事项：{original}\n客户：{client}\n业务：{business}\n沟通与进展：{notes}");
    let due = item["followUpAt"]
        .as_str()
        .map(|value| {
            DateTime::parse_from_rfc3339(value)
                .map(|time| {
                    time.with_timezone(&Utc)
                        .to_rfc3339_opts(SecondsFormat::Millis, true)
                })
                .map_err(|_| "INVALID_FOLLOW_UP_TIME")
        })
        .transpose()?;
    let created = crate::services::reminders::timestamp(now);
    let result = sqlx::query(
        "INSERT INTO tasks(title,notes,due_at,priority,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    )
    .bind(title)
    .bind(notes)
    .bind(due)
    .bind(if item["important"].as_bool() == Some(true) {
        "high"
    } else {
        "none"
    })
    .bind(&created)
    .bind(&created)
    .execute(&mut *tx)
    .await
    .map_err(|_| "FOLLOW_UP_CREATE_FAILED")?;
    let id = result.last_insert_rowid();
    item["followUpTaskId"] = id.into();
    item["followUpTaskCreatedAt"] = created.clone().into();
    sqlx::query("UPDATE journal_records SET items_json=?,revision=revision+1,updated_at=? WHERE kind='day' AND period_start=? AND revision=?")
        .bind(serde_json::to_string(&items).map_err(|_| "INVALID_JOURNAL_SOURCE")?).bind(created).bind(date).bind(row.get::<i64, _>("revision"))
        .execute(&mut *tx).await.map_err(|_| "FOLLOW_UP_LINK_FAILED")?;
    tx.commit().await.map_err(|_| "JOURNAL_COMMIT_FAILED")?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    async fn database() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::new().in_memory(true))
            .await
            .unwrap();
        for sql in [
            include_str!("../../migrations/0001_initial.sql"),
            include_str!("../../migrations/0002_natural_schedule.sql"),
            include_str!("../../migrations/0003_task_priority.sql"),
            include_str!("../../migrations/0004_task_trash.sql"),
            include_str!("../../migrations/0005_journal.sql"),
            include_str!("../../migrations/0006_task_content.sql"),
            include_str!("../../migrations/0007_journal_task_completions.sql"),
        ] {
            sqlx::raw_sql(sql).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO journal_records(kind,period_start,period_end,title,body,items_json,created_at,updated_at) VALUES('day','2026-10-17','2026-10-17','既有标题','既有正文',?,'2026-10-17T01:00:00.000Z','2026-10-17T01:00:00.000Z')")
            .bind(serde_json::json!([{"id":"one","title":"确认续贷资料","client":"华兴制造","business":"续贷管理","status":"waiting_client","notes":"尚缺财报","nextAction":"催收季度财报","followUpAt":"2026-10-20T09:00:00+08:00"}]).to_string()).execute(&pool).await.unwrap();
        pool
    }
    #[test]
    fn follow_up_is_atomic_idempotent_and_survives_task_edits() {
        tauri::async_runtime::block_on(async {
            let pool = database().await;
            let (one, two) = tokio::join!(
                create_follow_up(&pool, "2026-10-17", "one", 1792198800000),
                create_follow_up(&pool, "2026-10-17", "one", 1792198800001)
            );
            let id = one.unwrap();
            assert_eq!(two.unwrap(), id);
            sqlx::query("UPDATE tasks SET title='修改后的跟进',notes='整理过的备注' WHERE id=?")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
            assert_eq!(
                create_follow_up(&pool, "2026-10-17", "one", 1792198800002)
                    .await
                    .unwrap(),
                id
            );
            let row = sqlx::query("SELECT due_at FROM tasks WHERE id=?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(row.get::<String, _>("due_at"), "2026-10-20T01:00:00.000Z");
            let record = sqlx::query("SELECT title,body,items_json FROM journal_records")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(record.get::<String, _>("body"), "既有正文");
            assert!(record
                .get::<String, _>("items_json")
                .contains("waiting_client"));
            sqlx::query("UPDATE tasks SET deleted_at='2026-10-17T02:00:00.000Z' WHERE id=?")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
            assert_eq!(
                create_follow_up(&pool, "2026-10-17", "one", 1792198800003).await,
                Err("FOLLOW_UP_IN_TRASH")
            );
            pool.close().await;
        });
    }
    #[test]
    fn failed_link_rolls_back_task_and_invalid_sources_cannot_create_tasks() {
        tauri::async_runtime::block_on(async {
            let pool = database().await;
            assert_eq!(
                create_follow_up(&pool, "2026-02-30", "one", 1792198800000).await,
                Err("INVALID_JOURNAL_SOURCE")
            );
            assert_eq!(
                create_follow_up(&pool, "2026-10-17", "missing", 1792198800000).await,
                Err("JOURNAL_ITEM_NOT_FOUND")
            );
            sqlx::raw_sql("CREATE TRIGGER fail_journal_link BEFORE UPDATE ON journal_records BEGIN SELECT RAISE(ABORT,'injected'); END;").execute(&pool).await.unwrap();
            assert_eq!(
                create_follow_up(&pool, "2026-10-17", "one", 1792198800000).await,
                Err("FOLLOW_UP_LINK_FAILED")
            );
            let count: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 0);
            pool.close().await;
        });
    }
}
