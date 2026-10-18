use super::*;
use crate::services::reminders;
use chrono::{Local, NaiveDate, TimeZone};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

async fn database() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().in_memory(true))
        .await
        .unwrap();
    for sql in [
        include_str!("../../../migrations/0001_initial.sql"),
        include_str!("../../../migrations/0002_natural_schedule.sql"),
        include_str!("../../../migrations/0003_task_priority.sql"),
        include_str!("../../../migrations/0004_task_trash.sql"),
        include_str!("../../../migrations/0005_journal.sql"),
        include_str!("../../../migrations/0006_task_content.sql"),
        include_str!("../../../migrations/0007_journal_task_completions.sql"),
    ] {
        sqlx::raw_sql(sql).execute(&pool).await.unwrap();
    }
    pool
}
fn time(day: u32, hour: u32, minute: u32) -> i64 {
    Local
        .from_local_datetime(
            &NaiveDate::from_ymd_opt(2026, 10, day)
                .unwrap()
                .and_hms_opt(hour, minute, 0)
                .unwrap(),
        )
        .earliest()
        .unwrap()
        .timestamp_millis()
}
async fn task(pool: &SqlitePool, id: i64) {
    sqlx::query("INSERT INTO tasks(id,title,notes,created_at,updated_at) VALUES(?,'提交甲公司授信材料','只记录提交，不推断授信获批',?,?)")
        .bind(id).bind(reminders::timestamp(time(17,9,0))).bind(reminders::timestamp(time(17,9,0)))
        .execute(pool).await.unwrap();
}

#[test]
fn completion_uses_local_actual_date_and_preserves_snapshots_and_manual_revision() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        task(&pool, 1).await;
        let now = time(18, 0, 1);
        sqlx::query("UPDATE tasks SET due_at=? WHERE id=1")
            .bind(reminders::timestamp(time(17, 9, 0)))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO journal_records(kind,period_start,period_end,body,revision,created_at,updated_at) VALUES('day','2026-10-18','2026-10-18','不能覆盖的手写总结',3,?,?)")
            .bind(reminders::timestamp(now)).bind(reminders::timestamp(now)).execute(&pool).await.unwrap();
        reminders::update_status(&pool, 1, "completed", now)
            .await
            .unwrap();
        reminders::update_status(&pool, 1, "completed", now + 1000)
            .await
            .unwrap();
        let row = sqlx::query("SELECT day,completed_at,title FROM journal_task_completions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.get::<String, _>("day"), "2026-10-18");
        assert_eq!(
            row.get::<String, _>("completed_at"),
            reminders::timestamp(now)
        );
        let manual: (String, i64) = sqlx::query_as("SELECT body,revision FROM journal_records")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(manual, ("不能覆盖的手写总结".into(), 3));
        sqlx::query("UPDATE tasks SET title='改名',notes='修改后' WHERE id=1")
            .execute(&pool)
            .await
            .unwrap();
        reconcile(&pool).await.unwrap();
        sqlx::query("DELETE FROM tasks WHERE id=1")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT title FROM journal_task_completions")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "提交甲公司授信材料"
        );
    });
}

#[test]
fn undo_and_recompletion_keep_cross_day_history_without_reviving_same_day_entries() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        task(&pool, 1).await;
        reminders::update_status(&pool, 1, "completed", time(18, 10, 0))
            .await
            .unwrap();
        reminders::update_status(&pool, 1, "todo", time(18, 11, 0))
            .await
            .unwrap();
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM journal_task_completions WHERE revoked_day IS NULL OR revoked_day<>day").fetch_one(&pool).await.unwrap(),0);
        reminders::update_status(&pool, 1, "completed", time(19, 10, 0))
            .await
            .unwrap();
        reminders::update_status(&pool, 1, "todo", time(20, 10, 0))
            .await
            .unwrap();
        reconcile(&pool).await.unwrap();
        let visible: (String, String) = sqlx::query_as(
            "SELECT day,revoked_day FROM journal_task_completions WHERE revoked_day<>day",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(visible, ("2026-10-19".into(), "2026-10-20".into()));
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM journal_task_completions")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2
        );
    });
}

#[test]
fn automatic_write_failure_rolls_back_completion_reminders_and_recurrence() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        task(&pool, 1).await;
        let now = time(18, 10, 0);
        sqlx::query("UPDATE tasks SET due_at=?,repeat_rule='day:1' WHERE id=1")
            .bind(reminders::timestamp(now + 3600000))
            .execute(&pool)
            .await
            .unwrap();
        reminders::create(&pool, 1, &reminders::timestamp(now + 3600000), now)
            .await
            .unwrap();
        sqlx::raw_sql("CREATE TRIGGER fail_capture BEFORE INSERT ON journal_task_completions BEGIN SELECT RAISE(ABORT,'injected failure'); END;")
            .execute(&pool).await.unwrap();
        assert_eq!(
            reminders::update_status(&pool, 1, "completed", now).await,
            Err("JOURNAL_COMPLETION_WRITE_FAILED")
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM tasks WHERE id=1")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "todo"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM reminders")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM tasks")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    });
}

#[test]
fn reconciliation_captures_available_legacy_and_trashed_tasks_once_without_touching_tombstones() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        task(&pool, 1).await;
        task(&pool, 2).await;
        let stamp = reminders::timestamp(time(18, 10, 0));
        sqlx::query("UPDATE tasks SET status='completed',completed_at=?,deleted_at=CASE WHEN id=2 THEN ? ELSE NULL END")
            .bind(&stamp).bind(&stamp).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO journal_records(kind,period_start,period_end,deleted_at,created_at,updated_at) VALUES('day','2026-10-18','2026-10-18',?,?,?)")
            .bind(&stamp).bind(&stamp).bind(&stamp).execute(&pool).await.unwrap();
        reconcile(&pool).await.unwrap();
        reconcile(&pool).await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM journal_task_completions")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM journal_records WHERE deleted_at IS NOT NULL AND revision=1"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
    });
}

#[test]
fn concurrent_completion_and_recurring_instances_are_deduplicated() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        task(&pool, 1).await;
        let now = time(18, 10, 0);
        sqlx::query("UPDATE tasks SET due_at=?,repeat_rule='day:1',notes=? WHERE id=1")
            .bind(reminders::timestamp(now + 3600000))
            .bind("长".repeat(100000))
            .execute(&pool)
            .await
            .unwrap();
        let (a, b) = tokio::join!(
            reminders::update_status(&pool, 1, "completed", now),
            reminders::update_status(&pool, 1, "completed", now + 1000)
        );
        a.unwrap();
        b.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM tasks")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM journal_task_completions")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT length(notes) FROM journal_task_completions")
                .fetch_one(&pool)
                .await
                .unwrap(),
            100000
        );
        let next: i64 = sqlx::query_scalar("SELECT id FROM tasks WHERE status='todo'")
            .fetch_one(&pool)
            .await
            .unwrap();
        reminders::update_status(&pool, next, "completed", time(19, 10, 0))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM journal_task_completions")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2
        );
    });
}
