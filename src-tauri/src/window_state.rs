use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_autostart::ManagerExt;

pub fn autostart(args: impl IntoIterator<Item = impl AsRef<str>>) -> bool {
    args.into_iter().any(|arg| arg.as_ref() == "--autostart")
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
    x: i64,
    y: i64,
    width: i64,
    height: i64,
}
fn intersects(a: Rect, b: Rect) -> bool {
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}
fn repaired(window: Rect, areas: &[Rect]) -> Option<Rect> {
    if areas.is_empty() || areas.iter().any(|area| intersects(window, *area)) {
        return None;
    }
    let area = areas[0];
    let width = window.width.min(area.width).max(1);
    let height = window.height.min(area.height).max(1);
    Some(Rect {
        x: area.x + (area.width - width) / 2,
        y: area.y + (area.height - height) / 2,
        width,
        height,
    })
}

pub fn repair(app: &AppHandle) -> Result<(), tauri::Error> {
    let Some(main) = app.get_webview_window("main") else {
        return Ok(());
    };
    if main.is_minimized()? {
        return Ok(());
    }
    let pos = main.outer_position()?;
    let outer = main.outer_size()?;
    let window = Rect {
        x: pos.x as i64,
        y: pos.y as i64,
        width: outer.width as i64,
        height: outer.height as i64,
    };
    let mut monitors = main.available_monitors()?;
    // Prefer the primary work area as the fallback. All rectangles are physical pixels.
    if let Some(primary) = main.primary_monitor()? {
        if let Some(index) = monitors
            .iter()
            .position(|m| m.position() == primary.position())
        {
            monitors.swap(0, index);
        }
    }
    let areas: Vec<_> = monitors
        .iter()
        .map(|m| {
            let a = m.work_area();
            Rect {
                x: a.position.x as i64,
                y: a.position.y as i64,
                width: a.size.width as i64,
                height: a.size.height as i64,
            }
        })
        .collect();
    let Some(target) = repaired(window, &areas) else {
        return Ok(());
    };
    let maximized = main.is_maximized()?;
    if maximized {
        main.unmaximize()?;
    }
    let inner = main.inner_size()?;
    let outer = main.outer_size()?;
    let border_w = outer.width.saturating_sub(inner.width) as i64;
    let border_h = outer.height.saturating_sub(inner.height) as i64;
    main.set_size(PhysicalSize::new(
        (target.width - border_w).max(1) as u32,
        (target.height - border_h).max(1) as u32,
    ))?;
    main.set_position(PhysicalPosition::new(target.x as i32, target.y as i32))?;
    if maximized {
        main.maximize()?;
    }
    Ok(())
}

pub fn finish_startup(app: &AppHandle) {
    if let Err(error) = repair(app) {
        eprintln!("WINDOW_BOUNDS_REPAIR_FAILED: {error}");
    }
    let background = autostart(std::env::args())
        && !app
            .state::<crate::lifecycle::Lifecycle>()
            .visible_requested()
        && app.state::<crate::lifecycle::Lifecycle>().tray_ready()
        && crate::tray::available(app);
    if background {
        if let Some(main) = app.get_webview_window("main") {
            if main.hide().is_err() {
                crate::lifecycle::activate_main(app);
            }
        }
    } else {
        crate::lifecycle::activate_main(app);
    }
    crate::lifecycle::complete_startup(app);
    app.state::<crate::lifecycle::Lifecycle>()
        .mark_startup_complete();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Monitor removal need not emit a move event for a hidden window.
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            if app.state::<crate::lifecycle::Lifecycle>().is_quitting() {
                break;
            }
            if let Err(error) = repair(&app) {
                eprintln!("WINDOW_BOUNDS_REPAIR_FAILED: {error}");
            }
        }
    });
}

#[tauri::command]
pub fn autostart_status(window: tauri::WebviewWindow, app: AppHandle) -> Result<bool, String> {
    crate::commands::quick_add::source(window.label(), "main")?;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("AUTOSTART_READ_FAILED: {e}"))
}
#[tauri::command]
pub fn set_autostart(
    window: tauri::WebviewWindow,
    app: AppHandle,
    enabled: bool,
) -> Result<bool, String> {
    crate::commands::quick_add::source(window.label(), "main")?;
    if app.state::<crate::lifecycle::Lifecycle>().is_quitting() {
        return Err("APP_QUITTING".into());
    }
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|e| format!("AUTOSTART_UPDATE_FAILED: {e}"))?;
    // Return the observed OS state, never the requested value.
    manager
        .is_enabled()
        .map_err(|e| format!("AUTOSTART_READ_FAILED: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_autostart_parameter_distinguishes_secondary_launches() {
        assert!(autostart(["todoa.exe", "--autostart"]));
        assert!(!autostart(["todoa.exe", "--not-autostart"]));
        assert!(!autostart(["todoa.exe"]));
    }
    #[test]
    fn physical_workareas_negative_monitors_removal_and_dpi() {
        for scale in [1, 2, 3] {
            let main = Rect {
                x: 0,
                y: 0,
                width: 1920 * scale,
                height: 1040 * scale,
            };
            let left = Rect {
                x: -1920 * scale,
                ..main
            };
            let window = Rect {
                x: -1700 * scale,
                y: 100 * scale,
                width: 800 * scale,
                height: 600 * scale,
            };
            assert_eq!(repaired(window, &[main, left]), None);
            let fixed = repaired(window, &[main]).unwrap();
            assert!(intersects(fixed, main));
            assert_eq!(fixed.width, window.width);
            assert_eq!(fixed.height, window.height);
            let enormous = Rect {
                x: 9000,
                y: 9000,
                width: 6000,
                height: 6000,
            };
            let fixed = repaired(enormous, &[main]).unwrap();
            assert!(fixed.width <= main.width && fixed.height <= main.height);
            assert_eq!(repaired(fixed, &[main]), None);
        }
    }
}
