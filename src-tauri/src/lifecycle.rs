use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

#[derive(Default)]
struct Writes {
    quitting: bool,
    next: i64,
    active: HashMap<i64, &'static str>,
}

#[derive(Default)]
struct Inner {
    writes: Mutex<Writes>,
    changed: Condvar,
    ready_to_exit: AtomicBool,
    tray_ready: AtomicBool,
    pending_activation: AtomicBool,
    startup_complete: AtomicBool,
    visible_requested: AtomicBool,
}

#[derive(Clone, Default)]
pub struct Lifecycle(Arc<Inner>);

pub struct WriteGuard {
    lifecycle: Lifecycle,
    id: i64,
    owner: &'static str,
}
impl Drop for WriteGuard {
    fn drop(&mut self) {
        let _ = self.lifecycle.finish(self.id, self.owner);
    }
}

impl Lifecycle {
    pub fn is_quitting(&self) -> bool {
        self.0.writes.lock().unwrap().quitting
    }
    pub fn ready_to_exit(&self) -> bool {
        self.0.ready_to_exit.load(Ordering::SeqCst)
    }
    pub fn tray_ready(&self) -> bool {
        self.0.tray_ready.load(Ordering::SeqCst)
    }
    pub fn set_tray_ready(&self) {
        self.0.tray_ready.store(true, Ordering::SeqCst);
    }
    pub fn mark_startup_complete(&self) {
        self.0.startup_complete.store(true, Ordering::SeqCst);
    }
    pub fn visible_requested(&self) -> bool {
        self.0.visible_requested.load(Ordering::SeqCst)
    }
    fn begin(&self, owner: &'static str) -> Result<i64, &'static str> {
        let mut state = self.0.writes.lock().unwrap();
        if state.quitting {
            return Err("APP_QUITTING");
        }
        let id = state
            .next
            .checked_add(1)
            .filter(|id| *id <= 9_007_199_254_740_991)
            .ok_or("WRITE_LEASE_EXHAUSTED")?;
        state.next = id;
        state.active.insert(id, owner);
        Ok(id)
    }
    fn finish(&self, id: i64, owner: &'static str) -> Result<(), &'static str> {
        let mut state = self.0.writes.lock().unwrap();
        if state.active.get(&id) != Some(&owner) {
            return Err("INVALID_WRITE_LEASE");
        }
        state.active.remove(&id);
        self.0.changed.notify_all();
        Ok(())
    }
    pub fn write(&self) -> Result<WriteGuard, &'static str> {
        let id = self.begin("quick-add")?;
        Ok(WriteGuard {
            lifecycle: self.clone(),
            id,
            owner: "quick-add",
        })
    }
    fn start_quit(&self) -> bool {
        let mut state = self.0.writes.lock().unwrap();
        if state.quitting {
            return false;
        }
        state.quitting = true;
        true
    }
    fn drain(&self) -> bool {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut state = self.0.writes.lock().unwrap();
        while !state.active.is_empty() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            state = self.0.changed.wait_timeout(state, remaining).unwrap().0;
        }
        true
    }
    pub fn status(&self) -> &'static str {
        if self.is_quitting() {
            "quitting"
        } else if !self.0.startup_complete.load(Ordering::SeqCst) {
            "starting"
        } else if self.tray_ready() {
            "tray-ready"
        } else {
            "tray-unavailable"
        }
    }
}

pub fn activate_main(app: &AppHandle) {
    let state = app.state::<Lifecycle>();
    if state.is_quitting() {
        return;
    }
    state.0.pending_activation.store(true, Ordering::SeqCst);
    state.0.visible_requested.store(true, Ordering::SeqCst);
    if let Some(main) = app.get_webview_window("main") {
        if main
            .is_minimized()
            .and_then(|minimized| if minimized { main.unminimize() } else { Ok(()) })
            .and_then(|_| main.show())
            .and_then(|_| main.set_focus())
            .is_ok()
        {
            state.0.pending_activation.store(false, Ordering::SeqCst);
        } else {
            eprintln!("MAIN_ACTIVATION_FAILED");
        }
    }
}

pub fn complete_startup(app: &AppHandle) {
    if app
        .state::<Lifecycle>()
        .0
        .pending_activation
        .load(Ordering::SeqCst)
    {
        activate_main(app);
    }
}

pub fn request_quit(app: &AppHandle) {
    request_shutdown(app, false);
}

pub fn request_restart(app: &AppHandle) {
    request_shutdown(app, true);
}

fn request_shutdown(app: &AppHandle, restart: bool) {
    let state = app.state::<Lifecycle>().inner().clone();
    if !state.start_quit() {
        return;
    }
    let _ = app.emit_to("main", "app-quitting", ());
    let _ = app.emit_to("quick-add", "app-quitting", ());
    // Stop scheduled deliveries before draining writes.
    if let Some(scheduler) = app.try_state::<Arc<crate::reminder_scheduler::Scheduler>>() {
        scheduler.request_stop();
    }
    crate::global_shortcut::stop_events(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(scheduler) = app.try_state::<Arc<crate::reminder_scheduler::Scheduler>>() {
            scheduler.stop().await;
        }
        let waiter = state.clone();
        if !tauri::async_runtime::spawn_blocking(move || waiter.drain())
            .await
            .unwrap_or(false)
        {
            // A destroyed renderer may lose its lease acknowledgment. Pool.close still
            // waits for checked-out SQL connections; never kill an executing write.
            eprintln!("QUIT_WRITE_ACK_TIMEOUT");
        }
        crate::global_shortcut::shutdown(&app);
        if let Ok(pool) = crate::db::shared_pool(&app).await {
            pool.close().await;
        }
        state.0.ready_to_exit.store(true, Ordering::SeqCst);
        if restart {
            app.request_restart();
        } else {
            app.exit(0);
        }
    });
}

#[tauri::command]
pub fn lifecycle_status(
    window: WebviewWindow,
    state: State<'_, Lifecycle>,
) -> Result<&'static str, &'static str> {
    crate::commands::quick_add::source(window.label(), "main")?;
    Ok(state.status())
}

#[tauri::command]
pub fn begin_main_write(
    window: WebviewWindow,
    state: State<'_, Lifecycle>,
) -> Result<i64, &'static str> {
    crate::commands::quick_add::source(window.label(), "main")?;
    state.begin("main")
}

#[tauri::command]
pub fn finish_main_write(
    window: WebviewWindow,
    state: State<'_, Lifecycle>,
    id: i64,
) -> Result<(), &'static str> {
    crate::commands::quick_add::source(window.label(), "main")?;
    state.finish(id, "main")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quit_rejects_new_writes_and_drains_existing_without_intercepting_exit() {
        let state = Lifecycle::default();
        let guard = state.write().unwrap();
        let main_id = state.begin("main").unwrap();
        assert!(state.start_quit());
        assert!(!state.start_quit());
        assert_eq!(state.begin("main"), Err("APP_QUITTING"));
        assert!(state.write().is_err());
        assert_eq!(
            state.finish(main_id, "quick-add"),
            Err("INVALID_WRITE_LEASE")
        );
        state.finish(main_id, "main").unwrap();
        let copy = state.clone();
        let drain = std::thread::spawn(move || copy.drain());
        drop(guard);
        assert!(drain.join().unwrap());
        assert!(!state.ready_to_exit());
        state.0.ready_to_exit.store(true, Ordering::SeqCst);
        assert!(state.ready_to_exit());
    }
    #[test]
    fn only_a_successful_tray_allows_main_to_hide() {
        let state = Lifecycle::default();
        assert_eq!(state.status(), "starting");
        state.mark_startup_complete();
        assert_eq!(state.status(), "tray-unavailable");
        state.set_tray_ready();
        assert_eq!(state.status(), "tray-ready");
        state.start_quit();
        assert_eq!(state.status(), "quitting");
    }
}
