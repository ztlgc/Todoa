use sqlx::SqlitePool;

pub fn title(value: &str) -> Result<&str, &'static str> {
    if value.contains('\0') {
        return Err("INVALID_TITLE");
    }
    // Match ECMAScript String.trim, including BOM, without stripping NEL.
    let value = value.trim_matches(|c| {
        matches!(c,
            '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
            '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
            '\u{205f}' | '\u{3000}' | '\u{feff}'
        )
    });
    if value.is_empty() || value.chars().count() > 500 {
        return Err("INVALID_TITLE");
    }
    Ok(value)
}

pub async fn create(pool: &SqlitePool, input: &str) -> Result<i64, &'static str> {
    let title = title(input)?;
    // One autocommitted statement on the existing pool; result belongs to this INSERT.
    let result = sqlx::query("INSERT INTO tasks (title, created_at, updated_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
        .bind(title)
        .execute(pool)
        .await
        .map_err(|_| "QUICK_ADD_CREATE_FAILED")?;
    Ok(result.last_insert_rowid())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{sqlite::SqlitePoolOptions, Row};

    #[test]
    fn validates_unicode_title_before_sql() {
        assert_eq!(title(" \u{feff}任务🦀\u{3000}"), Ok("任务🦀"));
        assert_eq!(title("\u{0085}title"), Ok("\u{0085}title"));
        assert!(title(&"🦀".repeat(500)).is_ok());
        for value in [
            "".into(),
            " \u{feff}".into(),
            "a\0b".into(),
            "🦀".repeat(501),
        ] {
            assert_eq!(title(&value), Err("INVALID_TITLE"));
        }
    }

    #[test]
    fn creates_only_inbox_with_committed_defaults_and_preserves_failures() {
        tauri::async_runtime::block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let pool = SqlitePoolOptions::new()
                .max_connections(2)
                .connect_with(
                    sqlx::sqlite::SqliteConnectOptions::new()
                        .filename(dir.path().join("todo.db"))
                        .create_if_missing(true),
                )
                .await
                .unwrap();
            sqlx::raw_sql(include_str!("../../migrations/0001_initial.sql"))
                .execute(&pool)
                .await
                .unwrap();
            let id = create(&pool, "  Inbox🦀  ").await.unwrap();
            let row = sqlx::query("SELECT * FROM tasks WHERE id=?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(row.get::<String, _>("title"), "Inbox🦀");
            assert_eq!(row.get::<Option<i64>, _>("list_id"), None);
            assert_eq!(row.get::<String, _>("notes"), "");
            assert_eq!(row.get::<String, _>("status"), "todo");
            assert_eq!(row.get::<Option<String>, _>("due_at"), None);
            assert_eq!(row.get::<Option<String>, _>("completed_at"), None);
            let created = row.get::<String, _>("created_at");
            assert_eq!(created.len(), 24);
            assert!(created.ends_with('Z'));
            assert_eq!(created, row.get::<String, _>("updated_at"));
            assert_eq!(create(&pool, "\0").await, Err("INVALID_TITLE"));
            let count: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 1);
            pool.close().await;
            assert_eq!(create(&pool, "valid").await, Err("QUICK_ADD_CREATE_FAILED"));
        });
    }
}
