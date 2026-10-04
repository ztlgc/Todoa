//! Full SQLite snapshots and a recoverable, deliberately conservative restore journal.
//! No path from the renderer or journal can select a live database destination.
use serde::{Deserialize, Serialize};
use sqlx::{Connection, Row, SqliteConnection, SqlitePool};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

type Result<T> = std::result::Result<T, String>;
const FILES: [&str; 3] = ["todo.db", "todo.db-wal", "todo.db-shm"];
const OLD: [&str; 3] = [
    ".restore/original.db",
    ".restore/original.db-wal",
    ".restore/original.db-shm",
];
const STAGED: &str = ".restore/staged.db";
const JOURNAL: &str = ".restore/journal.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Journal {
    version: u8,
    phase: String,
    // Only operation numbers, never arbitrary paths. 0..2 preserve the original group;
    // 3 installs the staged snapshot. An intent remains until its reverse is durable.
    moves: Vec<u8>,
    history: String,
    pub message: String,
}

fn error(code: &str, error: impl std::fmt::Display) -> String {
    format!("{code}: {error}")
}
pub fn nonce() -> String {
    format!(
        "{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        std::process::id()
    )
}

// Windows MoveFileEx WRITE_THROUGH supplies the durable rename boundary; replacing a
// journal/backup is one OS rename, and never unlink(old) followed by rename(new).
pub fn publish(source: &Path, target: &Path, replace: bool) -> io::Result<()> {
    fault_io("publish")?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
        }
        let a: Vec<_> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let b: Vec<_> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), 8 | u32::from(replace)) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        if !replace && target.exists() {
            return Err(io::ErrorKind::AlreadyExists.into());
        }
        fs::rename(source, target)
    }
}

fn persist(root: &Path, journal: &Journal) -> Result<()> {
    fs::create_dir_all(root.join(".restore")).map_err(|e| error("RESTORE_DIRECTORY", e))?;
    let temp = root.join(format!(".restore/journal-{}.tmp", nonce()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        fault_io("journal")?;
        file.write_all(&serde_json::to_vec(journal)?)?;
        file.sync_all()?;
        publish(&temp, &root.join(JOURNAL), true)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|e: io::Error| error("RESTORE_JOURNAL_WRITE", e))
}

pub fn read(root: &Path) -> Result<Option<Journal>> {
    if !root.join(JOURNAL).exists() {
        return Ok(None);
    }
    if fs::metadata(root.join(JOURNAL))
        .map_err(|e| error("RESTORE_JOURNAL_READ", e))?
        .len()
        > 8192
    {
        return Err("RESTORE_JOURNAL_INVALID".into());
    }
    let bytes = fs::read(root.join(JOURNAL)).map_err(|e| error("RESTORE_JOURNAL_READ", e))?;
    if bytes.len() > 8192 {
        return Err("RESTORE_JOURNAL_INVALID".into());
    }
    let j: Journal = serde_json::from_slice(&bytes).map_err(|_| "RESTORE_JOURNAL_INVALID")?;
    if j.version != 1
        || ![
            "pending",
            "moving",
            "installed",
            "rollback",
            "failed",
            "committed",
        ]
        .contains(&j.phase.as_str())
        || j.moves.len() > 4
        || !j.moves.windows(2).all(|w| w[0] < w[1])
        || j.moves.iter().any(|n| *n > 3)
        || (["pending", "failed"].contains(&j.phase.as_str()) && !j.moves.is_empty())
        || (["installed", "committed"].contains(&j.phase.as_str())
            && (!j.moves.contains(&0) || !j.moves.contains(&3)))
        || !j.history.starts_with("restore-before-")
        || !j.history.ends_with(".db")
        || j.history
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || c == '-' || c == '.'))
    {
        return Err("RESTORE_JOURNAL_INVALID".into());
    }
    Ok(Some(j))
}

pub fn protected(root: &Path, path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .ok_or("INVALID_FILE_PATH")?
        .canonicalize()
        .map_err(|e| error("INVALID_FILE_PATH", e))?;
    let resolved = parent.join(path.file_name().ok_or("INVALID_FILE_PATH")?);
    let root = root
        .canonicalize()
        .map_err(|e| error("INVALID_DATABASE_PATH", e))?;
    let folded = resolved.to_string_lossy().to_lowercase();
    let protected_dir = root.join(".restore").to_string_lossy().to_lowercase();
    if folded == protected_dir
        || folded.starts_with(&(protected_dir + std::path::MAIN_SEPARATOR_STR))
        || FILES
            .iter()
            .any(|name| folded == root.join(name).to_string_lossy().to_lowercase())
    {
        return Err("PROTECTED_DATABASE_PATH".into());
    }
    // Hard links must not be used to overwrite the live file either.
    if path.exists() {
        for name in FILES {
            if root.join(name).exists()
                && same_file::is_same_file(path, root.join(name))
                    .map_err(|e| error("INVALID_FILE_PATH", e))?
            {
                return Err("PROTECTED_DATABASE_PATH".into());
            }
        }
    }
    Ok(())
}

fn independent(path: &Path) -> Result<()> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let side = PathBuf::from(format!("{}{suffix}", path.display()));
        if side.exists() {
            return Err("BACKUP_HAS_EXTERNAL_JOURNAL".into());
        }
    }
    Ok(())
}

// Schema SQL and migration checksum are compared with the only supported migration,
// including CHECKs, foreign keys, indexes and triggers, not merely table names.
pub async fn validate(path: &Path) -> Result<()> {
    independent(path)?;
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .read_only(true);
    let mut c = SqliteConnection::connect_with(&options)
        .await
        .map_err(|e| error("BACKUP_UNREADABLE", e))?;
    let result = inspect(&mut c).await;
    c.close().await.map_err(|e| error("BACKUP_CLOSE", e))?;
    result
}

async fn inspect(c: &mut SqliteConnection) -> Result<()> {
    let id: i64 = sqlx::query_scalar("PRAGMA application_id")
        .fetch_one(&mut *c)
        .await
        .map_err(|e| error("BACKUP_INVALID", e))?;
    let version: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(&mut *c)
        .await
        .map_err(|e| error("BACKUP_INVALID", e))?;
    if id != super::APPLICATION_ID {
        return Err("BACKUP_ID_MISMATCH".into());
    }
    if version > super::SCHEMA_VERSION {
        return Err("BACKUP_FUTURE_SCHEMA".into());
    }
    if version != super::SCHEMA_VERSION {
        return Err("BACKUP_UNSUPPORTED_SCHEMA".into());
    }
    let integrity: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_all(&mut *c)
        .await
        .map_err(|e| error("BACKUP_INTEGRITY", e))?;
    if integrity != ["ok"] {
        return Err("BACKUP_INTEGRITY".into());
    }
    if !sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut *c)
        .await
        .map_err(|e| error("BACKUP_FOREIGN_KEYS", e))?
        .is_empty()
    {
        return Err("BACKUP_FOREIGN_KEYS".into());
    }
    let history =
        sqlx::query("SELECT version, success, checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&mut *c)
            .await
            .map_err(|e| error("BACKUP_MIGRATION_HISTORY", e))?;
    let expected = sqlx::migrate::Migration::new(
        1,
        "initial_schema".into(),
        sqlx::migrate::MigrationType::ReversibleUp,
        include_str!("../../migrations/0001_initial.sql").into(),
        false,
    );
    if history.len() != 1
        || history[0].try_get::<i64, _>("version").ok() != Some(1)
        || history[0].try_get::<bool, _>("success").ok() != Some(true)
        || history[0].try_get::<Vec<u8>, _>("checksum").ok().as_deref()
            != Some(expected.checksum.as_ref())
    {
        return Err("BACKUP_MIGRATION_HISTORY".into());
    }
    let mut reference = SqliteConnection::connect("sqlite::memory:")
        .await
        .map_err(|e| error("BACKUP_SCHEMA", e))?;
    sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(vec![expected]),
        ..sqlx::migrate::Migrator::DEFAULT
    }
    .run(&mut reference)
    .await
    .map_err(|e| error("BACKUP_SCHEMA", e))?;
    let query =
        "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";
    let actual = sqlx::query(query)
        .fetch_all(&mut *c)
        .await
        .map_err(|e| error("BACKUP_SCHEMA", e))?;
    let expected = sqlx::query(query)
        .fetch_all(&mut reference)
        .await
        .map_err(|e| error("BACKUP_SCHEMA", e))?;
    reference
        .close()
        .await
        .map_err(|e| error("BACKUP_CLOSE", e))?;
    let signature = |row: &sqlx::sqlite::SqliteRow| -> std::result::Result<_, sqlx::Error> {
        Ok((
            row.try_get::<String, _>("type")?,
            row.try_get::<String, _>("name")?,
            row.try_get::<String, _>("sql")?
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" "),
        ))
    };
    let actual = actual
        .iter()
        .map(signature)
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| error("BACKUP_SCHEMA", e))?;
    let expected = expected
        .iter()
        .map(signature)
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| error("BACKUP_SCHEMA", e))?;
    if actual != expected {
        return Err("BACKUP_SCHEMA_MISMATCH".into());
    }
    Ok(())
}

pub async fn snapshot(pool: &SqlitePool, target: &Path) -> Result<()> {
    if target.exists() {
        return Err("SNAPSHOT_TARGET_EXISTS".into());
    }
    fault_io("snapshot").map_err(|e| error("SNAPSHOT_WRITE", e))?;
    sqlx::query("VACUUM INTO ?")
        .bind(target.to_str().ok_or("INVALID_FILE_PATH")?)
        .execute(pool)
        .await
        .map_err(|e| error("SNAPSHOT_WRITE", e))?;
    validate(target).await?;
    fs::OpenOptions::new()
        .write(true)
        .open(target)
        .and_then(|f| f.sync_all())
        .map_err(|e| error("SNAPSHOT_FLUSH", e))
}

pub async fn backup(pool: &SqlitePool, root: &Path, target: &Path, overwrite: bool) -> Result<()> {
    protected(root, target)?;
    independent(target)?;
    if target.exists() && !overwrite {
        return Err("OVERWRITE_NOT_CONFIRMED".into());
    }
    let temp = target
        .parent()
        .ok_or("INVALID_FILE_PATH")?
        .join(format!(".todoa-backup-{}.tmp", nonce()));
    let result = async {
        snapshot(pool, &temp).await?;
        publish(&temp, target, overwrite).map_err(|e| error("BACKUP_PUBLISH", e))
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

pub async fn stage(root: &Path, source: &Path) -> Result<()> {
    protected(root, source)?;
    if read(root)?.is_some_and(|j| !["committed", "failed"].contains(&j.phase.as_str())) {
        return Err("RESTORE_ALREADY_PENDING".into());
    }
    validate(source).await?;
    fs::create_dir_all(root.join(".restore")).map_err(|e| error("RESTORE_DIRECTORY", e))?;
    // The private stage is rewritten only when there is no recoverable pending operation.
    let temp = root.join(format!(".restore/stage-{}.tmp", nonce()));
    let result = async {
        fault_io("copy").map_err(|e| error("RESTORE_COPY", e))?;
        fs::copy(source, &temp).map_err(|e| error("RESTORE_COPY", e))?;
        validate(&temp).await?;
        independent(source)?;
        fs::OpenOptions::new()
            .write(true)
            .open(&temp)
            .and_then(|f| f.sync_all())
            .map_err(|e| error("RESTORE_FLUSH", e))?;
        publish(&temp, &root.join(STAGED), true).map_err(|e| error("RESTORE_STAGE", e))?;
        persist(
            root,
            &Journal {
                version: 1,
                phase: "pending".into(),
                moves: vec![],
                history: format!("restore-before-{}.db", nonce()),
                message: "待恢复；应用将关闭并重启。".into(),
            },
        )
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

fn operation(root: &Path, n: u8) -> (PathBuf, PathBuf) {
    if n == 3 {
        (root.join(STAGED), root.join(FILES[0]))
    } else {
        (root.join(FILES[n as usize]), root.join(OLD[n as usize]))
    }
}

pub fn rollback(root: &Path, reason: &str) -> Result<()> {
    let mut j = read(root)?.ok_or("RESTORE_JOURNAL_MISSING")?;
    j.phase = "rollback".into();
    j.message = format!("恢复失败，回滚尚未完成，数据库不可用。原因：{reason}");
    persist(root, &j)?;
    // Only remove NEW sidecars, while the install operation is still reversible.
    // Original sidecars are restored later, in the reverse operation log.
    if j.moves.contains(&3) && !root.join(STAGED).exists() {
        for file in &FILES[1..] {
            if root.join(file).exists() {
                fs::remove_file(root.join(file))
                    .map_err(|e| error("RESTORE_ROLLBACK_LOCKED", e))?;
            }
        }
    }
    while let Some(n) = j.moves.last().copied() {
        let (source, dest) = operation(root, n);
        if dest.exists() {
            if source.exists() {
                return Err("RESTORE_ROLLBACK_AMBIGUOUS".into());
            }
            crash_point(&format!("reverse-before-{n}"));
            publish(&dest, &source, false).map_err(|e| error("RESTORE_ROLLBACK_MOVE", e))?;
            crash_point(&format!("reverse-after-{n}"));
        } else if !source.exists() {
            return Err("RESTORE_ROLLBACK_FILE_MISSING".into());
        }
        j.moves.pop();
        persist(root, &j)?;
    }
    j.phase = "failed".into();
    j.message = format!("恢复失败；原数据库已恢复。原因：{reason}");
    persist(root, &j)
}

// Called before any live SQLite connection. Any interrupted operation rolls back
// instead of guessing that an unchecked replacement is safe to finish.
pub async fn before_boot(root: &Path) -> Result<bool> {
    let Some(mut j) = read(root)? else {
        return Ok(false);
    };
    if ["moving", "installed", "rollback"].contains(&j.phase.as_str()) {
        rollback(root, "上次恢复在文件替换或启动校验期间中断")?;
        return Ok(false);
    }
    if j.phase != "pending" {
        if j.phase == "committed" {
            if let Err(error) = cleanup_committed(root) {
                eprintln!("{error}");
            }
        }
        return Ok(false);
    }
    if let Err(e) = validate(&root.join(STAGED)).await {
        rollback(root, &e)?;
        return Ok(false);
    }
    // No old recovery group may be overwritten. A previous incomplete cleanup blocks.
    if OLD.iter().any(|p| root.join(p).exists()) {
        return Err("RESTORE_OLD_GROUP_EXISTS".into());
    }
    j.phase = "moving".into();
    persist(root, &j)?;
    let result: Result<()> = (|| {
        for n in 0..=3u8 {
            let (source, dest) = operation(root, n);
            if !source.exists() {
                if n == 0 || n == 3 {
                    return Err("RESTORE_FILE_MISSING".into());
                }
                continue;
            }
            j.moves.push(n);
            persist(root, &j)?;
            crash_point(&format!("before-{n}"));
            publish(&source, &dest, false).map_err(|e| error("RESTORE_MOVE", e))?;
            crash_point(&format!("after-{n}"));
            persist(root, &j)?;
        }
        j.phase = "installed".into();
        persist(root, &j)?;
        crash_point("installed");
        Ok(())
    })();
    match result {
        Ok(()) => Ok(true),
        Err(e) => {
            rollback(root, &e)?;
            Ok(false)
        }
    }
}

// New pool Ready has been verified. The original WAL group is opened only here,
// at its own filename, and retained until a separately validated snapshot exists.
pub async fn commit(root: &Path) -> Result<()> {
    let mut j = read(root)?.ok_or("RESTORE_JOURNAL_MISSING")?;
    if j.phase != "installed" {
        return Err("RESTORE_STAGE_INVALID".into());
    }
    fs::create_dir_all(root.join("backups")).map_err(|e| error("RESTORE_HISTORY_DIRECTORY", e))?;
    let target = root.join("backups").join(&j.history);
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(root.join(OLD[0]))
        .read_only(true);
    let pool = SqlitePool::connect_with(options)
        .await
        .map_err(|e| error("RESTORE_ORIGINAL_OPEN", e))?;
    let result = snapshot(&pool, &target).await;
    pool.close().await;
    result?;
    j.phase = "committed".into();
    j.message = format!("恢复成功。恢复前快照：{}", target.display());
    persist(root, &j)?;
    // Commit is durable and the before-restore snapshot is valid. Cleanup failure
    // must not reverse a committed operation with a partly removed original group.
    if let Err(error) = cleanup_committed(root) {
        eprintln!("{error}");
    }
    Ok(())
}

pub fn cleanup_committed(root: &Path) -> Result<()> {
    if read(root)?.is_some_and(|j| j.phase == "committed") {
        for path in OLD {
            if root.join(path).exists() {
                fs::remove_file(root.join(path)).map_err(|e| error("RESTORE_OLD_CLEANUP", e))?;
            }
        }
    }
    Ok(())
}

fn crash_point(_point: &str) {
    // A real process abort, only in the test executable. No production env hook.
    #[cfg(test)]
    if std::env::var("TODOA_TEST_RESTORE_CRASH").as_deref() == Ok(_point) {
        std::process::abort();
    }
}

fn fault_io(_point: &str) -> io::Result<()> {
    // Thread-local fault injection cannot affect another test or a production process.
    #[cfg(test)]
    if FAULT.with(|fault| fault.borrow().as_deref() == Some(_point)) {
        return Err(io::Error::from_raw_os_error(112));
    }
    Ok(())
}
#[cfg(test)]
thread_local! { static FAULT: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) }; }

#[cfg(test)]
mod tests;
