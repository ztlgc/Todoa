use super::*;
use sqlx::{
    migrate::{Migration, MigrationType, Migrator},
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use std::{borrow::Cow, process::Command};
use tempfile::TempDir;
const TIME: &str = "2026-10-04T01:02:03.004Z";

#[test]
fn journal_snapshots_survive_task_deletion_backup_and_restore() {
    tauri::async_runtime::block_on(async {
        let source = TempDir::new().unwrap();
        let target_root = TempDir::new().unwrap();
        let pool = database(source.path(), "Original task").await;
        let previous = database(target_root.path(), "Previous data").await;
        previous.close().await;
        sqlx::query("DELETE FROM tasks WHERE id=1")
            .execute(&pool)
            .await
            .unwrap();
        let target = source.path().join("journal-backup.db");
        backup(&pool, source.path(), &target, false).await.unwrap();
        validate(&target).await.unwrap();
        stage(target_root.path(), &target).await.unwrap();
        before_boot(target_root.path()).await.unwrap();
        let mut restored = SqliteConnection::connect_with(
            &SqliteConnectOptions::new().filename(target_root.path().join("todo.db")),
        )
        .await
        .unwrap();
        let snapshot: String =
            sqlx::query_scalar("SELECT items_json FROM journal_records WHERE kind='day'")
                .fetch_one(&mut restored)
                .await
                .unwrap();
        assert!(snapshot.contains("历史标题"));
        assert!(snapshot.contains("具体成果"));
        let tasks: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks")
            .fetch_one(&mut restored)
            .await
            .unwrap();
        assert_eq!(tasks, 0);
        restored.close().await.unwrap();
        commit(target_root.path()).await.unwrap();
        pool.close().await;
    });
}

#[test]
fn schema_four_backup_is_still_accepted() {
    tauri::async_runtime::block_on(async {
        let root = TempDir::new().unwrap();
        let pool = SqlitePoolOptions::new()
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(root.path().join("todo.db"))
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        let migrations = [
            (
                1,
                "initial_schema",
                include_str!("../../../migrations/0001_initial.sql"),
            ),
            (
                2,
                "natural_schedule",
                include_str!("../../../migrations/0002_natural_schedule.sql"),
            ),
            (
                3,
                "task_priority",
                include_str!("../../../migrations/0003_task_priority.sql"),
            ),
            (
                4,
                "task_trash",
                include_str!("../../../migrations/0004_task_trash.sql"),
            ),
        ]
        .into_iter()
        .map(|(version, name, sql)| {
            Migration::new(
                version,
                name.into(),
                MigrationType::ReversibleUp,
                sql.into(),
                false,
            )
        })
        .collect();
        Migrator {
            migrations: Cow::Owned(migrations),
            ..Migrator::DEFAULT
        }
        .run(&pool)
        .await
        .unwrap();
        let path = root.path().join("old-backup.db");
        snapshot(&pool, &path).await.unwrap();
        validate(&path).await.unwrap();
        pool.close().await;
    });
}

#[test]
fn previous_schema_backup_remains_valid_for_migration_on_restore() {
    tauri::async_runtime::block_on(async {
        let mut connection = SqliteConnection::connect("sqlite::memory:").await.unwrap();
        Migrator {
            migrations: Cow::Owned(vec![Migration::new(
                1,
                "initial_schema".into(),
                MigrationType::ReversibleUp,
                include_str!("../../../migrations/0001_initial.sql").into(),
                false,
            )]),
            ..Migrator::DEFAULT
        }
        .run(&mut connection)
        .await
        .unwrap();
        inspect(&mut connection).await.unwrap();
        connection.close().await.unwrap();
    });
}

async fn database(root: &Path, title: &str) -> SqlitePool {
    fs::create_dir_all(root).unwrap();
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(root.join("todo.db"))
                .create_if_missing(true)
                .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal),
        )
        .await
        .unwrap();
    Migrator {
        migrations: Cow::Owned(vec![
            Migration::new(
                1,
                "initial_schema".into(),
                MigrationType::ReversibleUp,
                include_str!("../../../migrations/0001_initial.sql").into(),
                false,
            ),
            Migration::new(
                2,
                "natural_schedule".into(),
                MigrationType::ReversibleUp,
                include_str!("../../../migrations/0002_natural_schedule.sql").into(),
                false,
            ),
            Migration::new(
                3,
                "task_priority".into(),
                MigrationType::ReversibleUp,
                include_str!("../../../migrations/0003_task_priority.sql").into(),
                false,
            ),
            Migration::new(
                4,
                "task_trash".into(),
                MigrationType::ReversibleUp,
                include_str!("../../../migrations/0004_task_trash.sql").into(),
                false,
            ),
            Migration::new(
                5,
                "journal".into(),
                MigrationType::ReversibleUp,
                include_str!("../../../migrations/0005_journal.sql").into(),
                false,
            ),
            Migration::new(
                6,
                "task_content".into(),
                MigrationType::ReversibleUp,
                include_str!("../../../migrations/0006_task_content.sql").into(),
                false,
            ),
        ]),
        ..Migrator::DEFAULT
    }
    .run(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO lists(id,name,created_at,updated_at) VALUES(1,'Work',?,?)")
        .bind(TIME)
        .bind(TIME)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO tasks(id,list_id,title,created_at,updated_at) VALUES(1,1,?,?,?)")
        .bind(title)
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
    sqlx::query("INSERT INTO settings(key,value,updated_at) VALUES('example','original',?)")
        .bind(TIME)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO journal_records(kind,period_start,period_end,title,body,items_json,created_at,updated_at) VALUES('day','2026-10-04','2026-10-04','工作记录','完成联调',?, ?, ?)")
        .bind(r#"[{"id":"snapshot","title":"历史标题","taskId":1,"notes":"具体成果","theme":"项目A","important":true,"completedAt":null}]"#)
        .bind(TIME)
        .bind(TIME)
        .execute(&pool).await.unwrap();
    pool
}
async fn title(path: &Path) -> String {
    let mut c =
        SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(path).read_only(true))
            .await
            .unwrap();
    let value = sqlx::query_scalar("SELECT title FROM tasks WHERE id=1")
        .fetch_one(&mut c)
        .await
        .unwrap();
    c.close().await.unwrap();
    value
}

#[test]
fn active_wal_snapshot_relations_and_concurrent_writer() {
    tauri::async_runtime::block_on(async {
        let dir = TempDir::new().unwrap();
        let pool = database(dir.path(), "Original").await;
        assert!(dir.path().join("todo.db-wal").metadata().unwrap().len() > 0);
        let writer_pool = pool.clone();
        let writer = tokio::spawn(async move {
            for n in 0..30 {
                sqlx::query("UPDATE settings SET value=? WHERE key='example'")
                    .bind(n.to_string())
                    .execute(&writer_pool)
                    .await
                    .unwrap();
            }
        });
        let target = dir.path().join("snapshot.db");
        backup(&pool, dir.path(), &target, false).await.unwrap();
        writer.await.unwrap();
        validate(&target).await.unwrap();
        let mut c = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(&target)
                .read_only(true),
        )
        .await
        .unwrap();
        for table in [
            "tasks",
            "lists",
            "tags",
            "task_tags",
            "reminders",
            "settings",
            "journal_records",
        ] {
            let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(&mut c)
                .await
                .unwrap();
            assert_eq!(count, 1, "{table}");
        }
        c.close().await.unwrap();
        pool.close().await;
    });
}

#[test]
fn rejects_corruption_identity_future_history_schema_foreign_keys_and_sidecars() {
    tauri::async_runtime::block_on(async {
        let dir = TempDir::new().unwrap();
        let pool = database(dir.path(), "Original").await;
        let pristine = dir.path().join("pristine.db");
        snapshot(&pool, &pristine).await.unwrap();
        for (sql, expected) in [
            ("PRAGMA application_id=1", "BACKUP_ID_MISMATCH"),
            ("PRAGMA user_version=7", "BACKUP_FUTURE_SCHEMA"),
            ("PRAGMA user_version=0", "BACKUP_UNSUPPORTED_SCHEMA"),
            ("DELETE FROM _sqlx_migrations", "BACKUP_MIGRATION_HISTORY"),
            (
                "UPDATE _sqlx_migrations SET checksum=X'00'",
                "BACKUP_MIGRATION_HISTORY",
            ),
            ("DROP INDEX idx_tasks_due", "BACKUP_SCHEMA_MISMATCH"),
            (
                "ALTER TABLE _sqlx_migrations DROP COLUMN installed_on",
                "BACKUP_SCHEMA_MISMATCH",
            ),
            (
                "ALTER TABLE tasks ADD COLUMN unknown_column TEXT",
                "BACKUP_SCHEMA_MISMATCH",
            ),
            (
                "PRAGMA foreign_keys=OFF; UPDATE tasks SET list_id=999",
                "BACKUP_FOREIGN_KEYS",
            ),
        ] {
            let path = dir.path().join("bad.db");
            fs::copy(&pristine, &path).unwrap();
            let mut c = SqliteConnection::connect_with(
                &SqliteConnectOptions::new()
                    .filename(&path)
                    .journal_mode(sqlx::sqlite::SqliteJournalMode::Delete),
            )
            .await
            .unwrap();
            sqlx::raw_sql(sql).execute(&mut c).await.unwrap();
            c.close().await.unwrap();
            assert!(
                validate(&path).await.unwrap_err().contains(expected),
                "{sql}"
            );
            assert!(stage(dir.path(), &path).await.is_err());
            assert!(read(dir.path()).unwrap().is_none());
        }
        let corrupt = dir.path().join("corrupt.db");
        fs::write(&corrupt, b"not SQLite").unwrap();
        assert!(validate(&corrupt).await.is_err());
        fs::write(dir.path().join("pristine.db-wal"), b"WAL").unwrap();
        assert_eq!(
            validate(&pristine).await.unwrap_err(),
            "BACKUP_HAS_EXTERNAL_JOURNAL"
        );
        assert!(protected(dir.path(), &dir.path().join("todo.db")).is_err());
        assert!(protected(dir.path(), &dir.path().join("todo.db-wal")).is_err());
        pool.close().await;
    });
}

#[test]
fn current_restore_ready_and_validated_before_restore_snapshot() {
    tauri::async_runtime::block_on(async {
        let dir = TempDir::new().unwrap();
        let source_dir = TempDir::new().unwrap();
        let old = database(dir.path(), "Original").await;
        let source = database(source_dir.path(), "Replacement").await;
        let backup = source_dir.path().join("backup.db");
        snapshot(&source, &backup).await.unwrap();
        source.close().await;
        stage(dir.path(), &backup).await.unwrap();
        old.close().await;
        assert!(before_boot(dir.path()).await.unwrap());
        // Same migration/Ready checks the production SQL plugin performs.
        super::super::prepare_wal(&dir.path().join("todo.db"))
            .await
            .unwrap();
        let new = SqlitePool::connect_with(
            SqliteConnectOptions::new().filename(dir.path().join("todo.db")),
        )
        .await
        .unwrap();
        super::super::verify_pool(&new, &dir.path().join("todo.db"))
            .await
            .unwrap();
        commit(dir.path()).await.unwrap();
        assert_eq!(title(&dir.path().join("todo.db")).await, "Replacement");
        let j = read(dir.path()).unwrap().unwrap();
        assert_eq!(j.phase, "committed");
        let original = dir.path().join("backups").join(j.history);
        validate(&original).await.unwrap();
        assert_eq!(title(&original).await, "Original");
        assert!(!before_boot(dir.path()).await.unwrap());
        new.close().await;
    });
}

#[test]
fn injected_disk_full_does_not_destroy_live_database_or_old_backup() {
    tauri::async_runtime::block_on(async {
        let dir = TempDir::new().unwrap();
        let pool = database(dir.path(), "Original").await;
        let target = dir.path().join("backup.db");
        snapshot(&pool, &target).await.unwrap();
        let old = fs::read(&target).unwrap();
        for fault in ["snapshot", "publish"] {
            FAULT.with(|v| *v.borrow_mut() = Some(fault.into()));
            assert!(backup(&pool, dir.path(), &target, true).await.is_err());
            FAULT.with(|v| *v.borrow_mut() = None);
            assert_eq!(fs::read(&target).unwrap(), old);
            assert_eq!(title(&dir.path().join("todo.db")).await, "Original");
        }
        for fault in ["copy", "journal"] {
            FAULT.with(|v| *v.borrow_mut() = Some(fault.into()));
            assert!(stage(dir.path(), &target).await.is_err());
            FAULT.with(|v| *v.borrow_mut() = None);
            assert!(read(dir.path()).unwrap().is_none());
            assert_eq!(fs::read(&target).unwrap(), old);
        }
        pool.close().await;
    });
}

#[cfg(windows)]
#[test]
fn actual_windows_file_locks_readonly_publish_and_rollback_retry() {
    tauri::async_runtime::block_on(async {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = TempDir::new().unwrap();
        let pool = database(dir.path(), "Original").await;
        let target = dir.path().join("backup.db");
        snapshot(&pool, &target).await.unwrap();
        let old = fs::read(&target).unwrap();
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&target)
            .unwrap();
        assert!(backup(&pool, dir.path(), &target, true).await.is_err());
        assert!(stage(dir.path(), &target).await.is_err());
        drop(locked);
        let original_permissions = fs::metadata(&target).unwrap().permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        fs::set_permissions(&target, permissions).unwrap();
        assert!(backup(&pool, dir.path(), &target, true).await.is_err());
        fs::set_permissions(&target, original_permissions).unwrap();
        assert_eq!(fs::read(&target).unwrap(), old);
        stage(dir.path(), &target).await.unwrap();
        pool.close().await;
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(dir.path().join("todo.db"))
            .unwrap();
        assert!(!before_boot(dir.path()).await.unwrap());
        drop(lock);
        assert_eq!(read(dir.path()).unwrap().unwrap().phase, "failed");
        stage(dir.path(), &target).await.unwrap();
        assert!(before_boot(dir.path()).await.unwrap());
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(dir.path().join("todo.db"))
            .unwrap();
        assert!(rollback(dir.path(), "simulated plugin initialization failure").is_err());
        drop(lock);
        assert!(!before_boot(dir.path()).await.unwrap());
        assert_eq!(title(&dir.path().join("todo.db")).await, "Original");
        assert_eq!(read(dir.path()).unwrap().unwrap().phase, "failed");
    });
}

fn child(test: &str, root: &Path, crash: Option<&str>) -> std::process::ExitStatus {
    let mut cmd = Command::new(std::env::current_exe().unwrap());
    cmd.args([test, "--exact", "--nocapture"])
        .env("TODOA_TEST_RESTORE_ROOT", root);
    if let Some(point) = crash {
        cmd.env("TODOA_TEST_RESTORE_CRASH", point);
    }
    cmd.status().unwrap()
}
#[test]
fn wal_fixture_child() {
    let Some(root) = std::env::var_os("TODOA_TEST_RESTORE_ROOT") else {
        return;
    };
    tauri::async_runtime::block_on(async {
        let _pool = database(Path::new(&root), "Original WAL").await;
        std::process::exit(0);
    });
}
#[test]
fn crash_child() {
    let Some(root) = std::env::var_os("TODOA_TEST_RESTORE_ROOT") else {
        return;
    };
    tauri::async_runtime::block_on(async {
        before_boot(Path::new(&root)).await.unwrap();
    });
}

#[test]
fn success_preserves_uncheckpointed_original_wal_in_before_restore_snapshot() {
    tauri::async_runtime::block_on(async {
        let original = TempDir::new().unwrap();
        assert!(child(
            "db::backup::tests::wal_fixture_child",
            original.path(),
            None
        )
        .success());
        let source_dir = TempDir::new().unwrap();
        let source = database(source_dir.path(), "Replacement").await;
        let target = source_dir.path().join("backup.db");
        snapshot(&source, &target).await.unwrap();
        source.close().await;
        stage(original.path(), &target).await.unwrap();
        assert!(before_boot(original.path()).await.unwrap());
        assert!(original.path().join(OLD[1]).metadata().unwrap().len() > 0);
        commit(original.path()).await.unwrap();
        let journal = read(original.path()).unwrap().unwrap();
        let previous = original.path().join("backups").join(journal.history);
        validate(&previous).await.unwrap();
        assert_eq!(title(&previous).await, "Original WAL");
        assert_eq!(title(&original.path().join("todo.db")).await, "Replacement");
    });
}

#[test]
fn journal_is_bounded_and_cannot_select_external_paths_or_invalid_stages() {
    let root = TempDir::new().unwrap();
    fs::create_dir(root.path().join(".restore")).unwrap();
    for bytes in [
        r#"{"version":1,"phase":"pending","moves":[],"history":"../outside.db","message":""}"#,
        r#"{"version":1,"phase":"failed","moves":[0],"history":"restore-before-1.db","message":""}"#,
        r#"{"version":1,"phase":"pending","moves":[],"history":"restore-before-1.db","message":"","path":"C:/outside.db"}"#,
        r#"{"version":1,"phase":"installed","moves":[3],"history":"restore-before-1.db","message":""}"#,
    ] {
        fs::write(root.path().join(JOURNAL), bytes).unwrap();
        assert!(read(root.path()).is_err());
    }
    fs::write(root.path().join(JOURNAL), vec![b' '; 9000]).unwrap();
    assert!(read(root.path()).is_err());
}
#[test]
fn real_process_crashes_before_after_every_group_move_and_during_rollback() {
    tauri::async_runtime::block_on(async {
        let source_dir = TempDir::new().unwrap();
        let source = database(source_dir.path(), "Replacement").await;
        let target = source_dir.path().join("backup.db");
        snapshot(&source, &target).await.unwrap();
        source.close().await;
        let mut points = vec!["installed".to_string()];
        for n in 0..4 {
            points.push(format!("before-{n}"));
            points.push(format!("after-{n}"));
            points.push(format!("reverse-before-{n}"));
            points.push(format!("reverse-after-{n}"));
        }
        for point in points {
            let dir = TempDir::new().unwrap();
            assert!(child("db::backup::tests::wal_fixture_child", dir.path(), None).success());
            assert!(dir.path().join("todo.db-wal").metadata().unwrap().len() > 0);
            stage(dir.path(), &target).await.unwrap();
            if point.starts_with("reverse-") {
                assert!(!child(
                    "db::backup::tests::crash_child",
                    dir.path(),
                    Some("installed")
                )
                .success());
            }
            assert!(
                !child("db::backup::tests::crash_child", dir.path(), Some(&point)).success(),
                "{point}"
            );
            assert!(!before_boot(dir.path()).await.unwrap(), "{point}");
            assert_eq!(
                title(&dir.path().join("todo.db")).await,
                "Original WAL",
                "{point}"
            );
            assert_eq!(
                read(dir.path()).unwrap().unwrap().phase,
                "failed",
                "{point}"
            );
            assert!(!before_boot(dir.path()).await.unwrap());
        }
    });
}

#[test]
fn rich_content_images_revision_and_backup_round_trip() {
    tauri::async_runtime::block_on(async {
        let source=TempDir::new().unwrap(); let restored=TempDir::new().unwrap();
        let pool=database(source.path(),"Original").await;
        let asset=sqlx::query("INSERT INTO task_assets(mime,data) VALUES('image/png',?)").bind(vec![137u8,80,78,71,13,10,26,10]).execute(&pool).await.unwrap().last_insert_rowid();
        sqlx::query("INSERT INTO task_asset_refs(task_id,asset_id) VALUES(1,?)").bind(asset).execute(&pool).await.unwrap();
        let doc=serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"重点内容","marks":[{"type":"bold"}]}]},{"type":"image","attrs":{"src":format!("todoa-asset:{asset}"),"alt":"本地图片"}}]}).to_string();
        assert_eq!(crate::commands::content::save(&pool,1,"标题".into(),doc.clone(),0).await.unwrap(),1);
        assert_eq!(crate::commands::content::save(&pool,1,"旧草稿".into(),doc.clone(),0).await,Err("CONTENT_CONFLICT"));
        let missing=doc.replace(&format!("todoa-asset:{asset}"),"todoa-asset:999");
        assert_eq!(crate::commands::content::save(&pool,1,"草稿".into(),missing,1).await,Err("IMAGE_NOT_FOUND"));
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT notes FROM tasks WHERE id=1").fetch_one(&pool).await.unwrap(),"重点内容");
        let path=source.path().join("rich-backup.db"); backup(&pool,source.path(),&path,false).await.unwrap();validate(&path).await.unwrap();
        let old=database(restored.path(),"Previous").await;old.close().await;
        stage(restored.path(),&path).await.unwrap();before_boot(restored.path()).await.unwrap();
        let read=SqlitePoolOptions::new().max_connections(1).connect_with(SqliteConnectOptions::new().filename(restored.path().join("todo.db"))).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_,String>("SELECT content_json FROM tasks WHERE id=1").fetch_one(&read).await.unwrap(),doc);
        assert_eq!(sqlx::query_scalar::<_,Vec<u8>>("SELECT data FROM task_assets").fetch_one(&read).await.unwrap(),vec![137u8,80,78,71,13,10,26,10]);
        sqlx::query("UPDATE tasks SET due_date='2027-10-22',repeat_rule='day:1' WHERE id=1").execute(&read).await.unwrap();
        let mut tx=read.begin().await.unwrap();crate::services::schedule::create_next(&mut tx,1,crate::services::reminders::now()).await.unwrap();tx.commit().await.unwrap();
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM task_asset_refs").fetch_one(&read).await.unwrap(),2);
        sqlx::query("DELETE FROM tasks WHERE id=1").execute(&read).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM task_assets").fetch_one(&read).await.unwrap(),1);
        sqlx::query("DELETE FROM tasks").execute(&read).await.unwrap();
        assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM task_assets").fetch_one(&read).await.unwrap(),0);
        read.close().await;pool.close().await;
    });
}
