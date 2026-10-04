use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[derive(Default)]
pub struct BackupState {
    busy: AtomicBool,
}
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub async fn backup_database(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, BackupState>,
) -> Result<&'static str, String> {
    super::quick_add::source(window.label(), "main")?;
    if !app
        .try_state::<crate::db::BootState>()
        .is_some_and(|s| matches!(*s, crate::db::BootState::Ready))
    {
        return Err("DATABASE_NOT_READY".into());
    }
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("BACKUP_RESTORE_BUSY".into());
    }
    let _busy = Busy(&state.busy);
    let _lease = app.state::<crate::lifecycle::Lifecycle>().write()?;
    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("备份 Todoa 数据（未加密）")
            .add_filter("SQLite 备份", &["db"])
            .set_file_name("todoa-backup.db")
            .blocking_save_file()
    })
    .await
    .map_err(|_| "DIALOG_FAILED")?;
    let Some(file) = selected else {
        return Ok("cancelled");
    };
    let target = file.into_path().map_err(|_| "INVALID_FILE_PATH")?;
    let overwrite = if target.exists() {
        let dialog_app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            dialog_app
                .dialog()
                .message("目标文件已存在。是否覆盖这份备份？原有备份会被替换。")
                .title("确认覆盖备份")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::YesNo)
                .blocking_show()
        })
        .await
        .map_err(|_| "DIALOG_FAILED")?
    } else {
        false
    };
    if target.exists() && !overwrite {
        return Ok("cancelled");
    }
    let root = app.path().app_config_dir().map_err(|_| "APP_CONFIG_PATH")?;
    let pool = crate::db::shared_pool(&app).await?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(crate::db::backup::backup(&pool, &root, &target, overwrite))
    })
    .await
    .map_err(|_| "BACKUP_WORKER_FAILED")??;
    Ok("completed")
}

#[tauri::command]
pub async fn restore_database(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, BackupState>,
    confirmed: bool,
) -> Result<&'static str, String> {
    super::quick_add::source(window.label(), "main")?;
    if !app
        .try_state::<crate::db::BootState>()
        .is_some_and(|s| matches!(*s, crate::db::BootState::Ready))
    {
        return Err("DATABASE_NOT_READY".into());
    }
    if !confirmed {
        return Err("RESTORE_CONFIRMATION_REQUIRED".into());
    }
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("BACKUP_RESTORE_BUSY".into());
    }
    let _busy = Busy(&state.busy);
    let lease = app.state::<crate::lifecycle::Lifecycle>().write()?;
    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("选择独立 SQLite 备份以替换全部数据")
            .add_filter("SQLite 备份", &["db"])
            .blocking_pick_file()
    })
    .await
    .map_err(|_| "DIALOG_FAILED")?;
    let Some(file) = selected else {
        return Ok("cancelled");
    };
    let source = file.into_path().map_err(|_| "INVALID_FILE_PATH")?;
    let root = app.path().app_config_dir().map_err(|_| "APP_CONFIG_PATH")?;
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(crate::db::backup::stage(&root, &source))
    })
    .await
    .map_err(|_| "RESTORE_WORKER_FAILED")??;
    drop(lease);
    crate::lifecycle::request_restart(&app);
    Ok("restarting")
}

#[tauri::command]
pub fn restore_status(window: WebviewWindow, app: AppHandle) -> Result<Option<String>, String> {
    super::quick_add::source(window.label(), "main")?;
    let root = app.path().app_config_dir().map_err(|_| "APP_CONFIG_PATH")?;
    Ok(crate::db::backup::read(&root)?.map(|j| j.message))
}
