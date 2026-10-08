mod commands;
mod db;
mod global_shortcut;
mod lifecycle;
mod reminder_scheduler;
mod services;
mod tray;
mod window_state;
mod preferences;

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
    let context = tauri::generate_context!();
    let autostart_name = autostart_entry_name(&context.config().identifier);
    tauri::Builder::default()
        .manage(lifecycle::Lifecycle::default())
        .manage(commands::backup::BackupState::default())
        // First plugin: a secondary process exits before SQL, shortcut or tray setup.
        .plugin(
            tauri_plugin_single_instance::Builder::new()
                .callback(|app, args, _cwd| {
                    if !window_state::autostart(args) {
                        lifecycle::activate_main(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .with_filter(|label| label == "main")
                .build(),
        )
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg("--autostart")
                .app_name(autostart_name)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            database_boot_status,
            commands::preferences::get_app_preferences,
            commands::preferences::set_app_preferences,
            commands::preferences::test_system_notification,
            commands::content::save_task_content,
            commands::content::import_task_image,
            commands::content::read_task_image,
            window_state::autostart_status,
            window_state::set_autostart,
            commands::backup::backup_database,
            commands::backup::restore_database,
            commands::backup::restore_status,
            commands::journal::export_journal_markdown,
            commands::quick_add::show_quick_add,
            commands::quick_add::hide_quick_add,
            commands::quick_add::create_quick_task,
            commands::quick_add::create_quick_scheduled_task,
            global_shortcut::global_shortcut_status,
            lifecycle::lifecycle_status,
            lifecycle::begin_main_write,
            lifecycle::finish_main_write,
            commands::reminders::create_reminder,
            commands::reminders::create_scheduled_task,
            commands::reminders::update_task_schedule,
            commands::reminders::edit_reminder,
            commands::reminders::delete_reminder,
            commands::reminders::update_task_status,
            commands::reminders::reconcile_reminders,
            commands::reminders::reminder_scheduler_status,
        ])
        .setup(|app| {
            let handle = app.handle();
            let root = handle.path().app_config_dir()?;
            let restoring = tauri::async_runtime::block_on(db::backup::before_boot(&root));
            let preflight = match &restoring {
                Ok(_) => tauri::async_runtime::block_on(db::preflight(handle)),
                Err(error) => {
                    eprintln!("{error}");
                    Err("RESTORE_RECOVERY_FAILED")
                }
            };
            let mut outcome = match preflight {
                Err(code) => Err(code),
                Ok(()) => match handle.plugin(db::plugin(
                    restoring == Ok(true)
                        && handle.config().identifier == "com.todoa.desktop.test.step18"
                        && root.join(".restore/test-fail-sql-preload").exists(),
                )) {
                    Err(_) => Err("SQL_PLUGIN_START_FAILED"),
                    Ok(()) => tauri::async_runtime::block_on(db::verify(handle)),
                },
            };
            if restoring == Ok(true) {
                if outcome.is_ok() {
                    if let Err(error) = tauri::async_runtime::block_on(db::backup::commit(&root)) {
                        eprintln!("{error}");
                        outcome = Err("RESTORE_COMMIT_FAILED");
                    }
                }
                if let Err(code) = outcome {
                    tauri::async_runtime::block_on(async {
                        if let Ok(pool) = db::shared_pool(handle).await {
                            pool.close().await;
                        }
                    });
                    if let Err(error) = db::backup::rollback(&root, code) {
                        eprintln!("{error}");
                        outcome = Err("RESTORE_ROLLBACK_FAILED");
                    }
                }
            }
            let status = match outcome {
                Ok(()) => db::BootState::Ready,
                Err(code) => db::BootState::Failed(code),
            };
            app.manage(status);
            if matches!(status, db::BootState::Ready) {
                tauri::async_runtime::block_on(reminder_scheduler::initialize(handle));
            }
            // Built once, then reused. Quick Add has its own entry and no SQL capability.
            tauri::WebviewWindowBuilder::new(
                app,
                "quick-add",
                tauri::WebviewUrl::App("quick-add.html".into()),
            )
            .title("Todoa · 快速添加")
            .inner_size(560.0, 280.0)
            .resizable(false)
            .visible(false)
            .focused(false)
            .build()?;
            app.manage(global_shortcut::ShortcutStatus::default());
            global_shortcut::initialize(app.handle());
            tray::finish_startup(app.handle(), tray::initialize(app.handle()));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<lifecycle::Lifecycle>();
                if state.is_quitting() {
                    return;
                }
                if window.label() == "main" {
                    api.prevent_close();
                    if state.tray_ready() && tray::available(window.app_handle()) {
                        if window.hide().is_err() {
                            eprintln!("MAIN_HIDE_FAILED");
                        }
                    } else {
                        lifecycle::request_quit(window.app_handle());
                    }
                } else if window.label() == "quick-add" {
                    api.prevent_close();
                    if window.hide().is_err() {
                        eprintln!("QUICK_ADD_HIDE_FAILED");
                    }
                }
            }
        })
        .build(context)
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<lifecycle::Lifecycle>().ready_to_exit() {
                    api.prevent_exit();
                    lifecycle::request_quit(app);
                }
            } else if matches!(event, tauri::RunEvent::Exit) {
                global_shortcut::shutdown(app);
            }
        });
}

fn autostart_entry_name(identifier: &str) -> String {
    // Config identifier keeps isolated native builds out of the production Run value.
    if identifier == "com.todoa.desktop" {
        "Todoa".into()
    } else {
        format!("TodoaTest ({identifier})")
    }
}
