use std::io::Write;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[tauri::command]
pub async fn export_journal_markdown(
    window: WebviewWindow,
    app: AppHandle,
    content: String,
    filename: String,
) -> Result<&'static str, String> {
    super::quick_add::source(window.label(), "main")?;
    if content.len() > 32 * 1024 * 1024
        || filename.len() > 200
        || filename.contains(['/', '\\'])
        || !filename.ends_with(".md")
    {
        return Err("EXPORT_INPUT_INVALID".into());
    }
    let _lease = app.state::<crate::lifecycle::Lifecycle>().write()?;
    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("导出工作回顾")
            .add_filter("Markdown", &["md"])
            .set_file_name(filename)
            .blocking_save_file()
    })
    .await
    .map_err(|_| "DIALOG_FAILED")?;
    let Some(file) = selected else {
        return Ok("cancelled");
    };
    let target = file.into_path().map_err(|_| "INVALID_FILE_PATH")?;
    if target
        .extension()
        .and_then(|value| value.to_str())
        .is_none_or(|value| !value.eq_ignore_ascii_case("md"))
    {
        return Err("请选择 .md 文件。".into());
    }
    // Never allow an export to replace the live database through a hard link.
    let root = app.path().app_config_dir().map_err(|_| "APP_CONFIG_PATH")?;
    for name in ["todo.db", "todo.db-wal", "todo.db-shm"] {
        let protected = root.join(name);
        if protected.exists()
            && target.exists()
            && same_file::is_same_file(&target, &protected).map_err(|_| "INVALID_FILE_PATH")?
        {
            return Err("PROTECTED_DATABASE_PATH".into());
        }
    }
    if target.exists() {
        let dialog_app = app.clone();
        let overwrite = tauri::async_runtime::spawn_blocking(move || {
            dialog_app
                .dialog()
                .message("目标文件已存在，是否替换？")
                .title("覆盖导出文件")
                .buttons(MessageDialogButtons::YesNo)
                .blocking_show()
        })
        .await
        .map_err(|_| "DIALOG_FAILED")?;
        if !overwrite {
            return Ok("cancelled");
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "EXPORT_CLOCK")?
            .as_nanos();
        let temporary =
            target.with_file_name(format!(".todoa-journal-{}-{stamp}.tmp", std::process::id()));
        let result: Result<&'static str, &'static str> = (|| {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|_| "EXPORT_WRITE")?;
            file.write_all(content.as_bytes())
                .map_err(|_| "EXPORT_WRITE")?;
            file.sync_all().map_err(|_| "EXPORT_WRITE")?;
            drop(file);
            std::fs::rename(&temporary, &target).map_err(|_| "EXPORT_REPLACE")?;
            Ok("exported")
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result
    })
    .await
    .map_err(|_| "EXPORT_FAILED")?
    .map_err(String::from)
}
