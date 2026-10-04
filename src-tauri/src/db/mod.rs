use std::path::Path;

use sqlx::{Connection, Row, SqliteConnection, SqlitePool};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

pub mod backup;

pub const DATABASE_URL: &str = "sqlite:todo.db";
pub const SCHEMA_VERSION: i64 = 1;
const APPLICATION_ID: i64 = 0x5754_4431;

#[derive(Clone, Copy)]
pub enum BootState {
    Ready,
    Failed(&'static str),
}

pub fn plugin<R: Runtime>(
    fail_migration: bool,
) -> tauri::plugin::TauriPlugin<R, Option<tauri_plugin_sql::PluginConfig>> {
    tauri_plugin_sql::Builder::new()
        .add_migrations(
            DATABASE_URL,
            vec![Migration {
                version: SCHEMA_VERSION,
                description: "initial_schema",
                sql: if fail_migration
                    && cfg!(all(
                        debug_assertions,
                        feature = "test-restore-startup-failure"
                    )) {
                    "SELECT todoa_invalid_restore_migration;"
                } else {
                    include_str!("../../migrations/0001_initial.sql")
                },
                kind: MigrationKind::Up,
            }],
        )
        .build()
}

pub async fn preflight<R: Runtime>(app: &AppHandle<R>) -> Result<(), &'static str> {
    let dir = app.path().app_config_dir().map_err(|_| "APP_CONFIG_PATH")?;
    let path = dir.join("todo.db");
    check_existing_database(&path).await?;
    prepare_wal(&path).await
}

async fn prepare_wal(path: &Path) -> Result<(), &'static str> {
    let parent = path.parent().ok_or("APP_CONFIG_PATH")?;
    std::fs::create_dir_all(parent).map_err(|_| "APP_CONFIG_PATH")?;
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|_| "DATABASE_UNWRITABLE")?;
    let modes: Vec<String> = sqlx::query_scalar("PRAGMA journal_mode=WAL")
        .fetch_all(&mut connection)
        .await
        .map_err(|_| "WAL_SETUP_FAILED")?;
    if modes.len() != 1 || !modes[0].eq_ignore_ascii_case("wal") {
        return Err("WAL_SETUP_FAILED");
    }
    connection
        .close()
        .await
        .map_err(|_| "DATABASE_CLOSE_FAILED")?;
    Ok(())
}

async fn check_existing_database(path: &Path) -> Result<(), &'static str> {
    if !path.exists() {
        return Ok(());
    }

    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .read_only(true);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|_| "DATABASE_UNREADABLE")?;
    let result = inspect_existing_connection(&mut connection).await;
    connection
        .close()
        .await
        .map_err(|_| "DATABASE_CLOSE_FAILED")?;
    result
}

async fn inspect_existing_connection(
    connection: &mut SqliteConnection,
) -> Result<(), &'static str> {
    let application_id: i64 = sqlx::query_scalar("PRAGMA application_id")
        .fetch_one(&mut *connection)
        .await
        .map_err(|_| "DATABASE_UNREADABLE")?;
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&mut *connection)
        .await
        .map_err(|_| "DATABASE_UNREADABLE")?;

    if application_id == 0 && version == 0 {
        let object_count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM sqlite_master WHERE type IN ('table', 'view', 'trigger', 'index') AND name NOT LIKE 'sqlite_%' AND name != '_sqlx_migrations'",
        )
        .fetch_one(&mut *connection)
        .await
        .map_err(|_| "DATABASE_UNREADABLE")?;
        if object_count != 0 {
            return Err("UNKNOWN_DATABASE");
        }
        let history_table: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
        )
        .fetch_one(&mut *connection)
        .await
        .map_err(|_| "DATABASE_UNREADABLE")?;
        if history_table == 1 {
            let history_count: i64 = sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations")
                .fetch_one(&mut *connection)
                .await
                .map_err(|_| "UNKNOWN_DATABASE")?;
            if history_count != 0 {
                return Err("UNKNOWN_DATABASE");
            }
        }
        return Ok(());
    }

    if application_id != APPLICATION_ID {
        return Err("DATABASE_ID_MISMATCH");
    }
    if version > SCHEMA_VERSION {
        return Err("FUTURE_SCHEMA");
    }
    if version < 1 {
        return Err("UNSUPPORTED_SCHEMA");
    }
    Ok(())
}

pub async fn shared_pool<R: Runtime>(app: &AppHandle<R>) -> Result<SqlitePool, &'static str> {
    let instances = app
        .try_state::<DbInstances>()
        .ok_or("SQL_PLUGIN_NOT_READY")?;
    let pool = {
        let locked = instances.0.read().await;
        match locked.get(DATABASE_URL) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("SQL_POOL_NOT_READY"),
        }
    };
    Ok(pool)
}

pub async fn verify<R: Runtime>(app: &AppHandle<R>) -> Result<(), &'static str> {
    let pool = shared_pool(app).await?;

    let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(&pool)
        .await
        .map_err(|_| "WAL_SETUP_FAILED")?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        return Err("WAL_SETUP_FAILED");
    }

    let expected = app
        .path()
        .app_config_dir()
        .map_err(|_| "APP_CONFIG_PATH")?
        .join("todo.db");
    verify_pool(&pool, &expected).await
}

async fn verify_pool(pool: &SqlitePool, expected_path: &Path) -> Result<(), &'static str> {
    let mut first = pool.acquire().await.map_err(|_| "SQL_POOL_UNAVAILABLE")?;
    let mut second = pool.acquire().await.map_err(|_| "SQL_POOL_UNAVAILABLE")?;
    verify_connection(&mut first, expected_path).await?;
    verify_connection(&mut second, expected_path).await?;
    drop(first);
    drop(second);

    let application_id: i64 = sqlx::query_scalar("PRAGMA application_id")
        .fetch_one(pool)
        .await
        .map_err(|_| "SCHEMA_CHECK_FAILED")?;
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(pool)
        .await
        .map_err(|_| "SCHEMA_CHECK_FAILED")?;
    if application_id != APPLICATION_ID || version != SCHEMA_VERSION {
        return Err("SCHEMA_ID_MISMATCH");
    }

    let migration_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM _sqlx_migrations WHERE version = 1 AND success = 1",
    )
    .fetch_one(pool)
    .await
    .map_err(|_| "MIGRATION_HISTORY_MISSING")?;
    if migration_count != 1 {
        return Err("MIGRATION_HISTORY_MISSING");
    }

    for (kind, name) in [
        ("table", "lists"),
        ("table", "tasks"),
        ("table", "tags"),
        ("table", "task_tags"),
        ("table", "reminders"),
        ("table", "settings"),
        ("index", "idx_tasks_list"),
        ("index", "idx_tasks_status"),
        ("index", "idx_tasks_due"),
        ("index", "idx_task_tags_tag"),
        ("index", "idx_reminders_pending"),
        ("index", "idx_reminders_task"),
        ("trigger", "trg_tasks_list_changed_at"),
    ] {
        let count: i64 =
            sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type = ? AND name = ?")
                .bind(kind)
                .bind(name)
                .fetch_one(pool)
                .await
                .map_err(|_| "SCHEMA_CHECK_FAILED")?;
        if count != 1 {
            return Err("SCHEMA_OBJECT_MISSING");
        }
    }

    let foreign_key_errors = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .map_err(|_| "FOREIGN_KEY_CHECK_FAILED")?;
    if !foreign_key_errors.is_empty() {
        return Err("FOREIGN_KEY_CHECK_FAILED");
    }
    let integrity: String = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_one(pool)
        .await
        .map_err(|_| "INTEGRITY_CHECK_FAILED")?;
    if integrity != "ok" {
        return Err("INTEGRITY_CHECK_FAILED");
    }
    Ok(())
}

async fn verify_connection(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    expected_path: &Path,
) -> Result<(), &'static str> {
    let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&mut **connection)
        .await
        .map_err(|_| "CONNECTION_CONFIG_FAILED")?;
    let busy_timeout: i64 = sqlx::query_scalar("PRAGMA busy_timeout")
        .fetch_one(&mut **connection)
        .await
        .map_err(|_| "CONNECTION_CONFIG_FAILED")?;
    let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(&mut **connection)
        .await
        .map_err(|_| "CONNECTION_CONFIG_FAILED")?;
    let synchronous: i64 = sqlx::query_scalar("PRAGMA synchronous")
        .fetch_one(&mut **connection)
        .await
        .map_err(|_| "CONNECTION_CONFIG_FAILED")?;
    if foreign_keys != 1
        || busy_timeout != 5000
        || !journal_mode.eq_ignore_ascii_case("wal")
        || synchronous == 0
    {
        return Err("CONNECTION_CONFIG_FAILED");
    }

    let rows = sqlx::query("PRAGMA database_list")
        .fetch_all(&mut **connection)
        .await
        .map_err(|_| "DATABASE_PATH_CHECK_FAILED")?;
    let main = rows
        .iter()
        .find(|row| matches!(row.try_get::<&str, _>("name"), Ok("main")))
        .ok_or("DATABASE_PATH_CHECK_FAILED")?;
    let actual = main
        .try_get::<String, _>("file")
        .map_err(|_| "DATABASE_PATH_CHECK_FAILED")?;
    let actual = Path::new(&actual)
        .canonicalize()
        .map_err(|_| "DATABASE_PATH_CHECK_FAILED")?;
    let expected = expected_path
        .canonicalize()
        .map_err(|_| "DATABASE_PATH_CHECK_FAILED")?;
    if actual != expected {
        return Err("DATABASE_PATH_MISMATCH");
    }
    Ok(())
}

#[cfg(test)]
mod tests;
