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
    ] {
        sqlx::raw_sql(sql).execute(&pool).await.unwrap();
    }
    pool
}

#[test]
fn normalized_utf16_limits_match_browser_and_rejections_leave_saved_content_intact() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        for text in [
            "字".repeat(199_999),
            "字".repeat(200_000),
            "😀".repeat(100_000),
            format!("{}\u{feff}\n  ", "字".repeat(200_000)),
        ] {
            let doc = serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]}).to_string();
            let revision: i64 =
                sqlx::query_scalar("SELECT coalesce(max(content_revision),0) FROM journal_records")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(
                save(&pool, "day", "2026-10-24", &doc, revision).await,
                Ok(revision + 1)
            );
        }
        let revision: i64 = sqlx::query_scalar("SELECT content_revision FROM journal_records")
            .fetch_one(&pool)
            .await
            .unwrap();
        let multi_paragraph = serde_json::json!({"type":"doc","content":[
            {"type":"paragraph","content":[{"type":"text","text":"字".repeat(100_000)}]},
            {"type":"paragraph","content":[{"type":"text","text":"字".repeat(99_999)}]}
        ]})
        .to_string();
        assert_eq!(
            save(&pool, "day", "2026-10-24", &multi_paragraph, revision).await,
            Ok(revision + 1)
        );
        let before: String = sqlx::query_scalar("SELECT content_json FROM journal_records")
            .fetch_one(&pool)
            .await
            .unwrap();
        let too_long = serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"字".repeat(200_001)}]}]}).to_string();
        assert_eq!(
            save(&pool, "day", "2026-10-24", &too_long, revision + 1).await,
            Err("CONTENT_TOO_LONG")
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT content_json FROM journal_records")
                .fetch_one(&pool)
                .await
                .unwrap(),
            before
        );
        assert_eq!(normalized_text("text\u{0085}\u{feff}\n"), "text\u{0085}");
    });
}

#[test]
fn image_collection_preserves_saved_trashed_and_draft_images_and_aborts_on_bad_content() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        let mut ids = Vec::new();
        for _ in 0..4 {
            ids.push(
                import_image(
                    &pool,
                    "day",
                    "2026-10-24",
                    "image/png",
                    b"\x89PNG\r\n\x1a\nfixture",
                )
                .await
                .unwrap(),
            );
        }
        let doc = serde_json::json!({"type":"doc","content":[{"type":"image","attrs":{"src":format!("todoa-asset:{}",ids[0])}}]}).to_string();
        save(&pool, "day", "2026-10-24", &doc, 0).await.unwrap();
        sqlx::query("UPDATE journal_records SET deleted_at='2026-10-24T01:00:00.000Z'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(prune_images(&pool, vec![ids[1]]).await, Ok(2));
        for id in &ids[..2] {
            assert!(read_image(&pool, "day", "2026-10-24", *id).await.is_ok());
        }
        assert_eq!(
            read_image(&pool, "day", "2026-10-24", ids[2]).await,
            Err("IMAGE_NOT_FOUND")
        );
        sqlx::query("UPDATE journal_records SET content_json='{\"type\":\"unsupported\"}'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(prune_images(&pool, vec![]).await.is_err());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM journal_assets")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2
        );
        assert!(prune_images(&pool, vec![-1]).await.is_err());
        sqlx::query("UPDATE journal_records SET content_json=NULL")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(prune_images(&pool, vec![]).await, Ok(2));
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM journal_records WHERE deleted_at IS NOT NULL"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
    });
}

#[test]
fn rich_content_is_independent_and_conflicts_preserve_the_last_saved_document() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        let doc = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"完整日记补充","marks":[{"type":"bold"}]}]}]}"#;
        assert_eq!(save(&pool, "day", "2026-10-18", doc, 0).await, Ok(1));
        assert_eq!(
            save(
                &pool,
                "day",
                "2026-10-18",
                r#"{"type":"doc","content":[]}"#,
                0
            )
            .await,
            Err("JOURNAL_CONTENT_CONFLICT")
        );
        let saved: (String, String, i64) =
            sqlx::query_as("SELECT body,content_json,content_revision FROM journal_records")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(saved, ("完整日记补充".into(), doc.into(), 1));
        sqlx::query("UPDATE journal_records SET title='旧日记标题',items_json='[{\"id\":\"legacy\",\"title\":\"旧手写记录\"}]'").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO tasks(title,created_at,updated_at) VALUES('自动归档任务','2026-10-18T01:00:00.000Z','2026-10-18T01:00:00.000Z')").execute(&pool).await.unwrap();
        crate::services::reminders::update_status(&pool, 1, "completed", 1792285200000)
            .await
            .unwrap();
        assert_eq!(save(&pool, "day", "2026-10-18", doc, 1).await, Ok(2));
        let unchanged:(String,String,String)=sqlx::query_as("SELECT title,items_json,content_json FROM journal_records WHERE period_start='2026-10-18'").fetch_one(&pool).await.unwrap();
        assert_eq!(unchanged.0, "旧日记标题");
        assert!(unchanged.1.contains("旧手写记录"));
        assert_eq!(unchanged.2, doc);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM journal_task_completions")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        sqlx::query("DELETE FROM tasks")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM tasks")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
        sqlx::query("UPDATE journal_records SET deleted_at='2026-10-18T10:00:00.000Z'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            save(&pool, "day", "2026-10-18", doc, 2).await,
            Err("JOURNAL_IN_TRASH")
        );
    });
}

#[test]
fn images_are_owned_by_the_journal_and_survive_soft_delete_without_cross_date_access() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        let image = b"\x89PNG\r\n\x1a\nlocal-image";
        let id = import_image(&pool, "day", "2026-10-18", "image/png", image)
            .await
            .unwrap();
        let doc=serde_json::json!({"type":"doc","content":[{"type":"image","attrs":{"src":format!("todoa-asset:{id}"),"alt":"回访截图"}}]}).to_string();
        assert_eq!(save(&pool, "day", "2026-10-18", &doc, 0).await, Ok(1));
        assert_eq!(
            read_image(&pool, "day", "2026-10-17", id).await,
            Err("IMAGE_NOT_FOUND")
        );
        assert_eq!(
            save(&pool, "day", "2026-10-17", &doc, 0).await,
            Err("IMAGE_NOT_FOUND")
        );
        assert_eq!(
            read_image(&pool, "day", "2026-10-18", id).await.unwrap().1,
            image
        );
        assert_eq!(
            import_image(&pool, "day", "2026-10-18", "image/png", b"invalid").await,
            Err("INVALID_IMAGE")
        );
        assert_eq!(
            save(&pool, "week", "2026-10-18", &doc, 0).await,
            Err("INVALID_JOURNAL_DATE")
        );
    });
}
