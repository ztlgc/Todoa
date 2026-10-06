use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn available(app: &AppHandle) -> bool {
    app.tray_by_id("todoa-main-tray")
        .and_then(|tray| tray.rect().ok().flatten())
        .is_some()
}

pub fn initialize(app: &AppHandle) -> Result<(), &'static str> {
    if cfg!(all(feature = "test-tray-failure", debug_assertions)) {
        return Err("TRAY_TEST_FAILURE");
    }
    let show = MenuItem::with_id(app, "show-main", "显示主窗口", true, None::<&str>)
        .map_err(|_| "TRAY_MENU_FAILED")?;
    let quick = MenuItem::with_id(app, "quick-add", "快速添加", true, None::<&str>)
        .map_err(|_| "TRAY_MENU_FAILED")?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)
        .map_err(|_| "TRAY_MENU_FAILED")?;
    let menu = Menu::with_items(app, &[&show, &quick, &quit]).map_err(|_| "TRAY_MENU_FAILED")?;
    #[cfg(windows)]
    let icon = tauri::image::Image::from_app_icon_resource(32).map_err(|_| "TRAY_ICON_MISSING")?;
    #[cfg(not(windows))]
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("TRAY_ICON_MISSING")?;
    let tray = TrayIconBuilder::with_id("todoa-main-tray")
        .icon(icon)
        .tooltip("Todoa")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                crate::lifecycle::activate_main(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show-main" => crate::lifecycle::activate_main(app),
            "quick-add" => {
                if crate::commands::quick_add::show_existing(app).is_err() {
                    eprintln!("TRAY_QUICK_ADD_FAILED");
                }
            }
            "quit" => crate::lifecycle::request_quit(app),
            _ => {}
        })
        .build(app)
        .map_err(|_| "TRAY_CREATE_FAILED")?;
    // The Windows backend can return Ok while Explorer has not accepted the icon.
    // Do not hide Main until the Shell actually exposes this tray icon.
    if !matches!(tray.rect(), Ok(Some(_))) {
        return Err("TRAY_PENDING");
    }
    app.state::<crate::lifecycle::Lifecycle>().set_tray_ready();
    Ok(())
}

pub fn finish_startup(app: &AppHandle, outcome: Result<(), &'static str>) {
    if outcome != Err("TRAY_PENDING") {
        if let Err(error) = outcome {
            eprintln!("{error}");
        }
        crate::window_state::finish_startup(app);
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        for _ in 0..30 {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            if app.state::<crate::lifecycle::Lifecycle>().is_quitting() {
                return;
            }
            if available(&app) {
                app.state::<crate::lifecycle::Lifecycle>().set_tray_ready();
                crate::window_state::finish_startup(&app);
                return;
            }
        }
        app.remove_tray_by_id("todoa-main-tray");
        eprintln!("TRAY_READY_TIMEOUT");
        crate::window_state::finish_startup(&app);
    });
}
