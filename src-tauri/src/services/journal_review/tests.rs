use super::*;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
async fn database() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .in_memory(true)
                .foreign_keys(true),
        )
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
        include_str!("../../../migrations/0008_journal_content.sql"),
        include_str!("../../../migrations/0009_journal_review.sql"),
    ] {
        sqlx::raw_sql(sql).execute(&pool).await.unwrap();
    }
    pool
}
fn note(id: &str) -> HighlightInput {
    HighlightInput {
        id: id.into(),
        date: "2026-10-18".into(),
        summary: "  确认方案  ".into(),
        result: "形成结论".into(),
        theme: " 项目 ".into(),
        source_type: "note".into(),
        source_id: id.into(),
        source_revision: 0,
    }
}
#[test]
fn revisions_idempotency_and_source_lifecycle() {
    tauri::async_runtime::block_on(async {
        let p = database().await;
        save(&p, note("h"), 0).await.unwrap();
        assert_eq!(
            list(&p, "2026-10-01", "2026-10-31", false).await.unwrap()[0]
                .input
                .summary,
            "确认方案"
        );
        assert_eq!(save(&p, note("h"), 0).await, Err("HIGHLIGHT_CONFLICT"));
        assert_eq!(
            add_material(&p, "month", "2026-10-01", "highlight", "h", 1).await,
            Err("JOURNAL_CONTENT_CONFLICT")
        );
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM journal_records WHERE kind='month'")
                .fetch_one(&p)
                .await
                .unwrap();
        assert_eq!(count, 0);
        add_material(&p, "month", "2026-10-01", "highlight", "h", 0)
            .await
            .unwrap();
        add_material(&p, "month", "2026-10-01", "highlight", "h", 0)
            .await
            .unwrap();
        let revision: i64 =
            sqlx::query_scalar("SELECT content_revision FROM journal_records WHERE kind='month'")
                .fetch_one(&p)
                .await
                .unwrap();
        assert_eq!(revision, 1);
        let before: String =
            sqlx::query_scalar("SELECT body FROM journal_records WHERE kind='month'")
                .fetch_one(&p)
                .await
                .unwrap();
        let doc = plain_doc("原文更新").to_string();
        super::super::journal_content::save(&p, "day", "2026-10-18", &doc, 0)
            .await
            .unwrap();
        assert!(list(&p, "2026-10-01", "2026-10-31", false).await.unwrap()[0].source_changed);
        // Editing the target document alone must not mark an unchanged material as changed.
        assert!(materials(&p, "month", "2026-10-01").await.unwrap()[0].source_changed);
        sqlx::query("UPDATE journal_records SET deleted_at='trash' WHERE kind='day'")
            .execute(&p)
            .await
            .unwrap();
        assert!(list(&p, "2026-10-01", "2026-10-31", false)
            .await
            .unwrap()
            .is_empty());
        assert!(materials(&p, "month", "2026-10-01").await.unwrap()[0].source_deleted);
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT body FROM journal_records WHERE kind='month'")
                .fetch_one(&p)
                .await
                .unwrap(),
            before
        );
        remove(&p, "h", 1).await.unwrap();
        assert!(list(&p, "2026-10-01", "2026-10-31", true)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(remove(&p, "h", 1).await, Err("HIGHLIGHT_CONFLICT"));
    });
}
#[test]
fn month_legacy_content_overlap_both_directions_and_no_image_copy() {
    tauri::async_runtime::block_on(async {
        let p = database().await;
        save(&p, note("h"), 0).await.unwrap();
        sqlx::query("INSERT INTO journal_records(kind,period_start,period_end,title,body,created_at,updated_at) VALUES('month','2026-10-01','2026-10-31','旧标题','旧正文','now','now')").execute(&p).await.unwrap();
        add_material(&p, "month", "2026-10-01", "highlight", "h", 0)
            .await
            .unwrap();
        let text: String =
            sqlx::query_scalar("SELECT body FROM journal_records WHERE kind='month'")
                .fetch_one(&p)
                .await
                .unwrap();
        assert!(text.starts_with("旧标题\n\n旧正文"));
        add_material(&p, "year", "2026-01-01", "month", "2026-10-01", 0)
            .await
            .unwrap();
        assert_eq!(
            add_material(&p, "year", "2026-01-01", "highlight", "h", 1).await,
            Err("REVIEW_SOURCE_OVERLAP_USE_HIGHLIGHTS")
        );
        sqlx::query("DELETE FROM journal_review_sources WHERE review_kind='year'")
            .execute(&p)
            .await
            .unwrap();
        add_material(&p, "year", "2026-01-01", "highlight", "h", 1)
            .await
            .unwrap();
        assert_eq!(
            add_material(&p, "year", "2026-01-01", "month", "2026-10-01", 2).await,
            Err("REVIEW_SOURCE_OVERLAP_USE_HIGHLIGHTS")
        );
        let doc = plain_doc("手写改动").to_string();
        super::super::journal_content::save(&p, "year", "2026-01-01", &doc, 2)
            .await
            .unwrap();
        assert!(!materials(&p, "year", "2026-01-01").await.unwrap()[0].source_changed);
    });
}
#[test]
fn tasks_match_exact_day_deduplicate_and_report_cross_day_revocation() {
    tauri::async_runtime::block_on(async {
        let p = database().await;
        sqlx::query("INSERT INTO journal_task_completions(id,day,task_id,task_created_at,completed_at,title) VALUES('task','2026-10-18',1,'created','completed','快照')").execute(&p).await.unwrap();
        let mut task = note("h");
        task.source_type = "task".into();
        task.source_id = "task".into();
        let mut wrong = task.clone();
        wrong.date = "2026-10-19".into();
        assert_eq!(
            save(&p, wrong, 0).await,
            Err("HIGHLIGHT_SOURCE_UNAVAILABLE")
        );
        save(&p, task.clone(), 0).await.unwrap();
        task.id = "duplicate".into();
        assert_eq!(save(&p, task, 0).await, Err("HIGHLIGHT_ALREADY_EXISTS"));
        add_material(&p, "month", "2026-10-01", "highlight", "h", 0)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE journal_task_completions SET revoked_at='revoked',revoked_day='2026-10-19'",
        )
        .execute(&p)
        .await
        .unwrap();
        assert!(list(&p, "2026-10-01", "2026-10-31", false)
            .await
            .unwrap()
            .is_empty());
        assert!(list(&p, "2026-10-01", "2026-10-31", true).await.unwrap()[0].source_revoked);
        assert!(materials(&p, "month", "2026-10-01").await.unwrap()[0].source_revoked);
    });
}
#[test]
fn append_limit_failure_rolls_back_both_body_and_link() {
    tauri::async_runtime::block_on(async {
        let p = database().await;
        save(&p, note("h"), 0).await.unwrap();
        let doc = plain_doc(&"字".repeat(200000)).to_string();
        super::super::journal_content::save(&p, "month", "2026-10-01", &doc, 0)
            .await
            .unwrap();
        assert_eq!(
            add_material(&p, "month", "2026-10-01", "highlight", "h", 1).await,
            Err("CONTENT_TOO_LONG")
        );
        assert!(materials(&p, "month", "2026-10-01")
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT content_json FROM journal_records WHERE kind='month'"
            )
            .fetch_one(&p)
            .await
            .unwrap(),
            doc
        );
    });
}
