// Compile the actual journal service. Only the clock is fixed in this harness.
mod commands {
    pub mod content { include!("document.inc.rs"); }
}
mod services {
    pub mod reminders {
        pub fn now() -> i64 { 1792814400000 }
        pub fn timestamp(value: i64) -> String {
            chrono::DateTime::from_timestamp_millis(value).unwrap().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        }
    }
    pub mod journal_content {
        include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../src-tauri/src/services/journal_content.rs"));
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new().max_connections(1)
        .connect_with(sqlx::sqlite::SqliteConnectOptions::new().in_memory(true).foreign_keys(true))
        .await.unwrap();
    for name in ["0001_initial.sql", "0002_natural_schedule.sql", "0003_task_priority.sql", "0004_task_trash.sql", "0005_journal.sql", "0006_task_content.sql", "0007_journal_task_completions.sql", "0008_journal_content.sql"] {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../src-tauri/migrations").join(name);
        sqlx::raw_sql(&std::fs::read_to_string(path).unwrap()).execute(&pool).await.unwrap();
    }
    let image = services::journal_content::import_image(&pool, "day", "2026-10-24", "image/png", b"\x89PNG\r\n\x1a\nfixture").await.unwrap();
    let with_image = serde_json::json!({"type":"doc","content":[{"type":"image","attrs":{"src":format!("todoa-asset:{image}")}}]}).to_string();
    assert_eq!(services::journal_content::save(&pool, "day", "2026-10-24", &with_image, 0).await, Ok(1));
    let without_image = r#"{"type":"doc","content":[{"type":"paragraph"}]}"#;
    assert_eq!(services::journal_content::save(&pool, "day", "2026-10-24", without_image, 1).await, Ok(2));
    let retained: i64 = sqlx::query_scalar("SELECT count(*) FROM journal_assets").fetch_one(&pool).await.unwrap();
    assert_eq!(retained, 1);
    assert!(services::journal_content::read_image(&pool, "day", "2026-10-24", image).await.is_ok());
    println!("{}", serde_json::json!({"probe":"native-removed-image-retention","documentImages":0,"retainedAssets":retained,"oldImageStillReadable":true}));
    let exact_limit = serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"字".repeat(200000)}]}]}).to_string();
    let result = services::journal_content::save(&pool, "day", "2026-10-23", &exact_limit, 0).await;
    assert_eq!(result, Err("CONTENT_TOO_LONG"));
    println!("{}", serde_json::json!({"probe":"native-length-limit","visibleUtf16Characters":200000,"actual":result,"reason":"paragraph newline counted before trim"}));
    let valid = serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"字".repeat(199999)}]}]}).to_string();
    assert_eq!(services::journal_content::save(&pool, "day", "2026-10-23", &valid, 0).await, Ok(1));
    println!("native control: 199999 characters saved successfully");
    pool.close().await;
}
