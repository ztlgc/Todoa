use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Default)]
pub struct ShortcutStatus {
    initialized: AtomicBool,
    stopping: AtomicBool,
    pressed: AtomicBool,
    status: AtomicU8,
    registered: AtomicBool,
}

fn fixed() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
}

impl ShortcutStatus {
    fn accepts(&self, event: ShortcutState) -> bool {
        if self.stopping.load(Ordering::SeqCst) {
            return false;
        }
        match event {
            ShortcutState::Pressed => !self.pressed.swap(true, Ordering::SeqCst),
            ShortcutState::Released => {
                self.pressed.store(false, Ordering::SeqCst);
                false
            }
        }
    }
    fn text(&self) -> &'static str {
        match self.status.load(Ordering::SeqCst) {
            1 => "registered",
            2 => "registration-failed",
            3 => "plugin-failed",
            4 => "show-failed",
            5 => "stopped",
            6 => "unregister-failed",
            _ => "unavailable",
        }
    }
}

fn update(app: &AppHandle, value: u8) {
    let state = app.state::<ShortcutStatus>();
    state.status.store(value, Ordering::SeqCst);
    if app
        .emit_to("main", "global-shortcut-status", state.text())
        .is_err()
    {
        eprintln!("SHORTCUT_STATUS_EVENT_FAILED");
    }
}

pub fn initialize(app: &AppHandle) {
    let state = app.state::<ShortcutStatus>();
    if state.initialized.swap(true, Ordering::SeqCst) {
        return;
    }
    if app
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let state = app.state::<ShortcutStatus>();
                    if shortcut == &fixed()
                        && state.accepts(event.state())
                        && crate::commands::quick_add::show_existing(app).is_err()
                    {
                        update(app, 4);
                    }
                })
                .build(),
        )
        .is_err()
    {
        update(app, 3);
        return;
    }
    match app.global_shortcut().register(fixed()) {
        Ok(()) => {
            state.registered.store(true, Ordering::SeqCst);
            update(app, 1);
        }
        Err(_) => update(app, 2),
    }
}

pub fn shutdown(app: &AppHandle) {
    let state = app.state::<ShortcutStatus>();
    state.stopping.store(true, Ordering::SeqCst);
    if !state.registered.swap(false, Ordering::SeqCst) {
        return;
    }
    // Only the fixed Rust-owned shortcut, never another application's registration.
    match app.global_shortcut().unregister(fixed()) {
        Ok(()) => update(app, 5),
        Err(_) => update(app, 6),
    }
}

pub fn stop_events(app: &AppHandle) {
    app.state::<ShortcutStatus>()
        .stopping
        .store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn global_shortcut_status(
    window: WebviewWindow,
    status: State<'_, ShortcutStatus>,
) -> Result<&'static str, &'static str> {
    crate::commands::quick_add::source(window.label(), "main")?;
    Ok(status.text())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn one_press_ignores_repeat_and_release_and_stops_on_exit() {
        let state = ShortcutStatus::default();
        assert!(state.accepts(ShortcutState::Pressed));
        assert!(!state.accepts(ShortcutState::Pressed));
        assert!(!state.accepts(ShortcutState::Released));
        assert!(state.accepts(ShortcutState::Pressed));
        state.stopping.store(true, Ordering::SeqCst);
        assert!(!state.accepts(ShortcutState::Pressed));
        assert!(!state.accepts(ShortcutState::Released));
    }
}
