use std::{borrow::Cow, time::Instant};

use sqlx::{
    migrate::{Migration as SqlxMigration, MigrationType, Migrator},
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Executor, SqlitePool,
};
use tempfile::TempDir;

use super::{check_existing_database, prepare_wal, verify_connection, verify_pool};

const TIME: &str = "2026-10-04T01:02:03.004Z";

fn migrator(sql: &'static str) -> Migrator {
    Migrator {
        migrations: Cow::Owned(vec![SqlxMigration::new(
            1,
            "initial_schema".into(),
            MigrationType::ReversibleUp,
            sql.into(),
            false,
        )]),
        ..Migrator::DEFAULT
    }
}
fn current_migrator() -> Migrator {
    Migrator {
        migrations: Cow::Owned(vec![
            SqlxMigration::new(
                1,
                "initial_schema".into(),
                MigrationType::ReversibleUp,
                include_str!("../../migrations/0001_initial.sql").into(),
                false,
            ),
            SqlxMigration::new(
                2,
                "natural_schedule".into(),
                MigrationType::ReversibleUp,
                include_str!("../../migrations/0002_natural_schedule.sql").into(),
                false,
            ),
            SqlxMigration::new(
                3,
                "task_priority".into(),
                MigrationType::ReversibleUp,
                include_str!("../../migrations/0003_task_priority.sql").into(),
                false,
            ),
            SqlxMigration::new(
                4,
                "task_trash".into(),
                MigrationType::ReversibleUp,
                include_str!("../../migrations/0004_task_trash.sql").into(),
                false,
            ),
        ]),
        ..Migrator::DEFAULT
    }
}

async fn database() -> (TempDir, SqlitePool) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("todo.db");
    prepare_wal(&path).await.unwrap();
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .unwrap();
    (dir, pool)
}

async fn install(pool: &SqlitePool) {
    current_migrator().run(pool).await.unwrap();
    let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(mode, "wal");
}

#[test]
fn migration_schema_constraints_and_repeat() {
    tauri::async_runtime::block_on(async {
        let (dir, pool) = database().await;
        let path = dir.path().join("todo.db");
        assert_eq!(check_existing_database(&path).await, Ok(()));
        install(&pool).await;
        assert_eq!(check_existing_database(&path).await, Ok(()));
        verify_pool(&pool, &path).await.unwrap();

        current_migrator().run(&pool).await.unwrap();
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM _sqlx_migrations WHERE version=1 AND success=1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);

        sqlx::query("INSERT INTO lists(id,name,created_at,updated_at) VALUES(1,'Work',?,?)")
            .bind(TIME)
            .bind(TIME)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO tasks(id,list_id,title,created_at,updated_at) VALUES(1,1,'Task',?,?)",
        )
        .bind(TIME)
        .bind(TIME)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO tags(id,name,created_at,updated_at) VALUES(1,'Tag',?,?)")
            .bind(TIME)
            .bind(TIME)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO task_tags(task_id,tag_id) VALUES(1,1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO reminders(id,task_id,remind_at,created_at,updated_at) VALUES(1,1,?,?,?)",
        )
        .bind(TIME)
        .bind(TIME)
        .bind(TIME)
        .execute(&pool)
        .await
        .unwrap();

        assert!(sqlx::query(
            "INSERT INTO reminders(id,task_id,remind_at,created_at,updated_at) VALUES(2,999,?,?,?)"
        )
        .bind(TIME)
        .bind(TIME)
        .bind(TIME)
        .execute(&pool)
        .await
        .is_err());
        assert!(sqlx::query("INSERT INTO tasks(id,title,status,created_at,updated_at) VALUES(2,'Bad','completed',?,?)")
            .bind(TIME).bind(TIME).execute(&pool).await.is_err());
        assert!(sqlx::query("INSERT INTO tasks(id,title,due_at,created_at,updated_at) VALUES(2,'Bad','2026-10-04',?,?)")
            .bind(TIME).bind(TIME).execute(&pool).await.is_err());
        assert!(sqlx::query("INSERT INTO reminders(id,task_id,remind_at,created_at,updated_at) VALUES(2,1,'2026-10-04',?,?)")
            .bind(TIME).bind(TIME).execute(&pool).await.is_err());
        assert!(sqlx::query("INSERT INTO tasks(id,title,sort_order,created_at,updated_at) VALUES(2,'Bad',9007199254740992,?,?)")
            .bind(TIME).bind(TIME).execute(&pool).await.is_err());
        assert!(sqlx::query(
            "INSERT INTO tasks(id,title,created_at,updated_at) VALUES(9007199254740992,'Bad',?,?)"
        )
        .bind(TIME)
        .bind(TIME)
        .execute(&pool)
        .await
        .is_err());

        sqlx::query("DELETE FROM lists WHERE id=1")
            .execute(&pool)
            .await
            .unwrap();
        let (list_id, updated_at): (Option<i64>, String) =
            sqlx::query_as("SELECT list_id,updated_at FROM tasks WHERE id=1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(list_id, None);
        assert_ne!(updated_at, TIME);
        assert_eq!(updated_at.len(), 24);
        assert!(updated_at.ends_with('Z'));

        sqlx::query("DELETE FROM tags WHERE id=1")
            .execute(&pool)
            .await
            .unwrap();
        let tag_links: i64 = sqlx::query_scalar("SELECT count(*) FROM task_tags")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(tag_links, 0);

        sqlx::query("INSERT INTO tags(id,name,created_at,updated_at) VALUES(2,'Tag',?,?)")
            .bind(TIME)
            .bind(TIME)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO task_tags(task_id,tag_id) VALUES(1,2)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("DELETE FROM tasks WHERE id=1")
            .execute(&pool)
            .await
            .unwrap();
        let reminder_count: i64 = sqlx::query_scalar("SELECT count(*) FROM reminders")
            .fetch_one(&pool)
            .await
            .unwrap();
        let tag_count: i64 = sqlx::query_scalar("SELECT count(*) FROM task_tags")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!((reminder_count, tag_count), (0, 0));
        pool.close().await;
    });
}

#[test]
fn pool_config_new_connection_and_lock_timeout() {
    tauri::async_runtime::block_on(async {
        let (dir, pool) = database().await;
        let path = dir.path().join("todo.db");
        install(&pool).await;
        verify_pool(&pool, &path).await.unwrap();

        let old_connection = pool.acquire().await.unwrap();
        old_connection.close().await.unwrap();
        let mut replacement = pool.acquire().await.unwrap();
        verify_connection(&mut replacement, &path).await.unwrap();
        drop(replacement);

        let mut writer = pool.acquire().await.unwrap();
        writer.execute("BEGIN IMMEDIATE").await.unwrap();
        let started = Instant::now();
        let blocked =
            sqlx::query("INSERT INTO settings(key,value,updated_at) VALUES('locked','x',?)")
                .bind(TIME)
                .execute(&pool)
                .await;
        let elapsed = started.elapsed();
        writer.execute("ROLLBACK").await.unwrap();
        assert!(
            blocked.is_err(),
            "concurrent write must fail while lock is held"
        );
        assert!(
            elapsed.as_secs() >= 4 && elapsed.as_secs() <= 12,
            "busy timeout was {elapsed:?}"
        );
        pool.close().await;
    });
}

#[test]
fn preflight_rejects_unknown_future_and_bad_identity() {
    tauri::async_runtime::block_on(async {
        let (dir, pool) = database().await;
        let path = dir.path().join("todo.db");
        assert_eq!(check_existing_database(&path).await, Ok(()));
        pool.execute("CREATE TABLE unknown_data(id INTEGER)")
            .await
            .unwrap();
        assert_eq!(
            check_existing_database(&path).await,
            Err("UNKNOWN_DATABASE")
        );
        pool.execute("PRAGMA application_id=1234").await.unwrap();
        assert_eq!(
            check_existing_database(&path).await,
            Err("DATABASE_ID_MISMATCH")
        );
        pool.execute("PRAGMA application_id=0x57544431")
            .await
            .unwrap();
        pool.execute("PRAGMA user_version=5").await.unwrap();
        assert_eq!(check_existing_database(&path).await, Err("FUTURE_SCHEMA"));
        pool.execute("PRAGMA user_version=0").await.unwrap();
        assert_eq!(
            check_existing_database(&path).await,
            Err("UNSUPPORTED_SCHEMA")
        );
        pool.close().await;
    });
}

#[test]
fn preflight_rejects_corrupt_file() {
    tauri::async_runtime::block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("todo.db");
        std::fs::write(&path, b"not a sqlite database").unwrap();
        assert_eq!(
            check_existing_database(&path).await,
            Err("DATABASE_UNREADABLE")
        );
    });
}

#[test]
fn failed_migration_does_not_leave_partial_business_schema() {
    tauri::async_runtime::block_on(async {
        let (dir, pool) = database().await;
        let path = dir.path().join("todo.db");
        let broken =
            migrator("CREATE TABLE partial_data(id INTEGER); INSERT INTO absent_table VALUES(1);");
        assert!(broken.run(&pool).await.is_err());
        let partial: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE name='partial_data'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let version: i64 = sqlx::query_scalar("PRAGMA user_version")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!((partial, version), (0, 0));
        assert_eq!(check_existing_database(&path).await, Ok(()));
        pool.close().await;
    });
}

#[test]
fn upgrade_preserves_tasks_and_requires_complete_migration_history() {
    tauri::async_runtime::block_on(async {
        let (dir, pool) = database().await;
        let path = dir.path().join("todo.db");
        let mut previous = current_migrator();
        previous.migrations = Cow::Owned(
            previous
                .migrations
                .iter()
                .filter(|migration| migration.version <= 3)
                .cloned()
                .collect(),
        );
        previous.run(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO tasks(id,title,created_at,updated_at) VALUES(1,'Existing task',?,?)",
        )
        .bind(TIME)
        .bind(TIME)
        .execute(&pool)
        .await
        .unwrap();
        assert_eq!(check_existing_database(&path).await, Ok(()));
        install(&pool).await;
        verify_pool(&pool, &path).await.unwrap();
        let title: String = sqlx::query_scalar("SELECT title FROM tasks WHERE id=1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(title, "Existing task");
        sqlx::query("DELETE FROM _sqlx_migrations WHERE version=4")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            verify_pool(&pool, &path).await,
            Err("MIGRATION_HISTORY_MISSING")
        );
        pool.close().await;
    });
}
