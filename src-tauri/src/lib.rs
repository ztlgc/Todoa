mod db;

use tauri::{Manager, State, WebviewWindow};

#[tauri::command]
fn database_boot_status(
    window: WebviewWindow,
    status: State<'_, db::BootState>,
) -> Result<i64, String> {
    if window.label() != "main" {
        return Err("WINDOW_NOT_ALLOWED".into());
    }
    match *status {
        db::BootState::Ready => Ok(db::SCHEMA_VERSION),
        db::BootState::Failed(code) => Err(format!("数据库初始化失败（{code}）。请重启应用。")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![database_boot_status])
        .setup(|app| {
            let handle = app.handle();
            let preflight = tauri::async_runtime::block_on(db::preflight(handle));
            let outcome = match preflight {
                Err(code) => Err(code),
                Ok(()) => match handle.plugin(db::plugin()) {
                    Err(_) => Err("SQL_PLUGIN_START_FAILED"),
                    Ok(()) => tauri::async_runtime::block_on(db::verify(handle)),
                },
            };
            let status = match outcome {
                Ok(()) => db::BootState::Ready,
                Err(code) => db::BootState::Failed(code),
            };
            app.manage(status);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
