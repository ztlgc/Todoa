use crate::services::reminders::{self, Pending};
use sqlx::SqlitePool;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::sync::{Mutex, Notify};

pub trait Clock: Send + Sync {
    fn now(&self) -> i64;
    fn steady(&self) -> i64 {
        self.now()
    }
}
struct SystemClock(std::time::Instant);
impl Clock for SystemClock {
    fn now(&self) -> i64 {
        reminders::now()
    }
    fn steady(&self) -> i64 {
        self.0.elapsed().as_millis().min(i64::MAX as u128) as i64
    }
}
pub trait Notification: Send + Sync {
    fn enabled(&self) -> bool {
        true
    }
    fn availability(&self) -> &'static str {
        "ready"
    }
    fn send(&self, reminder: &Pending) -> Result<(), &'static str>;
}
#[cfg(test)]
struct Disabled;
#[cfg(test)]
impl Notification for Disabled {
    fn enabled(&self) -> bool {
        false
    }
    fn send(&self, reminder: &Pending) -> Result<(), &'static str> {
        let _ = &reminder.title; // STEP 17 will pass this title to the OS outlet.
        Err("NOTIFICATION_NOT_ENABLED")
    }
}
struct SystemNotification(tauri::AppHandle);
impl Notification for SystemNotification {
    fn availability(&self) -> &'static str {
        use tauri_plugin_notification::{NotificationExt, PermissionState};
        match self.0.notification().permission_state() {
            Ok(PermissionState::Granted) => "ready",
            Ok(
                tauri_plugin_notification::PermissionState::Prompt
                | tauri_plugin_notification::PermissionState::PromptWithRationale,
            ) => "notification-setting-unknown",
            Ok(_) => "NOTIFICATION_DENIED",
            Err(error) => {
                eprintln!("NOTIFICATION_AVAILABILITY_FAILED: {error}");
                "NOTIFICATION_AVAILABILITY_FAILED"
            }
        }
    }
    fn send(&self, reminder: &Pending) -> Result<(), &'static str> {
        use tauri_plugin_notification::NotificationExt;
        match self.availability() {
            "ready" | "notification-setting-unknown" => {}
            code => return Err(code),
        }
        self.0
            .notification()
            .builder()
            .title(&reminder.title)
            .show()
            .map_err(|_| "NOTIFICATION_API_FAILED")
    }
}
struct Retry {
    time: String,
    attempts: u32,
    due: i64,
    accepted: Option<String>,
    error: &'static str,
}
#[derive(Default)]
struct Plan {
    retry: HashMap<i64, Retry>,
    last_send: Option<i64>,
}

pub struct Scheduler {
    pool: SqlitePool,
    clock: Arc<dyn Clock>,
    notification: Arc<dyn Notification>,
    plan: Mutex<Plan>,
    wake: Notify,
    stopping: AtomicBool,
    error: std::sync::Mutex<Option<&'static str>>,
    worker: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}
impl Scheduler {
    fn new(
        pool: SqlitePool,
        clock: Arc<dyn Clock>,
        notification: Arc<dyn Notification>,
    ) -> Arc<Self> {
        Arc::new(Self {
            pool,
            clock,
            notification,
            plan: Mutex::new(Plan::default()),
            wake: Notify::new(),
            stopping: AtomicBool::new(false),
            error: std::sync::Mutex::new(None),
            worker: Mutex::new(None),
        })
    }
    pub fn changed(&self) {
        self.wake.notify_one();
    }
    pub fn request_stop(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        self.changed();
    }
    pub async fn stop(&self) {
        self.request_stop();
        if let Some(worker) = self.worker.lock().await.take() {
            let _ = worker.await;
        }
    }
    pub fn status(&self) -> &'static str {
        if self.stopping.load(Ordering::SeqCst) {
            "stopped"
        } else if !self.notification.enabled() {
            "notification-not-enabled"
        } else {
            self.error
                .lock()
                .unwrap()
                .unwrap_or_else(|| self.notification.availability())
        }
    }
    // All reconciles share this gate; one loop and one plan, no per-reminder tasks.
    async fn reconcile(&self) -> Result<(u64, bool), sqlx::Error> {
        let mut plan = self.plan.lock().await;
        if self.stopping.load(Ordering::SeqCst) || !self.notification.enabled() {
            return Ok((30_000, false));
        }
        let now = self.clock.now();
        let steady = self.clock.steady();
        let rows = reminders::pending(&self.pool).await?;
        plan.retry
            .retain(|id, r| rows.iter().any(|row| row.id == *id && row.time == r.time));
        *self.error.lock().unwrap() = plan.retry.values().next().map(|r| r.error);
        let mut delay = 30_000i64;
        let mut changed = false;
        for row in rows {
            if self.stopping.load(Ordering::SeqCst) {
                break;
            }
            let at = chrono::DateTime::parse_from_rfc3339(&row.time)
                .map(|t| t.timestamp_millis())
                .unwrap_or(i64::MAX);
            let retry = plan.retry.get(&row.id);
            let accepted = retry.and_then(|r| r.accepted.clone());
            let wall_wait = if accepted.is_some() {
                0
            } else {
                at.saturating_sub(now).max(0)
            };
            let retry_wait = retry.map_or(0, |r| r.due.saturating_sub(steady).max(0));
            let throttle = if accepted.is_some() {
                0
            } else {
                plan.last_send
                    .map_or(0, |t| t.saturating_add(1000).saturating_sub(steady).max(0))
            };
            let wait = wall_wait.max(retry_wait).max(throttle);
            if wait > 0 {
                delay = delay.min(wait);
                continue;
            }
            // Fresh DB truth immediately before API, not a stale plan title/state.
            let fresh = reminders::pending(&self.pool)
                .await?
                .into_iter()
                .find(|r| r.id == row.id && r.time == row.time);
            let Some(fresh) = fresh else {
                plan.retry.remove(&row.id);
                continue;
            };
            if self.stopping.load(Ordering::SeqCst) {
                break;
            }
            let sent = if accepted.is_some() {
                Ok(())
            } else {
                plan.last_send = Some(steady);
                let outlet = self.notification.clone();
                tauri::async_runtime::spawn_blocking(move || outlet.send(&fresh))
                    .await
                    .unwrap_or(Err("NOTIFICATION_WORKER_FAILED"))
            };
            let stamp = accepted.unwrap_or_else(|| reminders::timestamp(self.clock.now()));
            let outcome = match sent {
                Err(code) => Err(code),
                Ok(()) => sqlx::query("UPDATE reminders SET triggered_at=?,updated_at=? WHERE id=? AND remind_at=? AND triggered_at IS NULL AND EXISTS(SELECT 1 FROM tasks WHERE tasks.id=reminders.task_id AND status='todo' AND deleted_at IS NULL)")
                    .bind(&stamp).bind(&stamp).bind(row.id).bind(&row.time).execute(&self.pool).await.map(|_| ()).map_err(|_| "REMINDER_MARK_FAILED"),
            };
            match outcome {
                Ok(()) => {
                    plan.retry.remove(&row.id);
                    *self.error.lock().unwrap() = plan.retry.values().next().map(|r| r.error);
                    changed = true;
                }
                Err(code) => {
                    let attempts = plan
                        .retry
                        .get(&row.id)
                        .map_or(1, |r| r.attempts.saturating_add(1));
                    let backoff = (1000i64 * (1i64 << attempts.min(9))).min(300_000);
                    let accepted = if code == "REMINDER_MARK_FAILED" {
                        Some(stamp)
                    } else {
                        None
                    };
                    plan.retry.insert(
                        row.id,
                        Retry {
                            time: row.time,
                            attempts,
                            due: steady.saturating_add(backoff),
                            accepted,
                            error: code,
                        },
                    );
                    *self.error.lock().unwrap() = Some(code);
                    delay = delay.min(backoff);
                }
            }
        }
        // Re-read after marks; successful catch-up keeps the 1/sec limit and exact timer.
        for row in reminders::pending(&self.pool).await? {
            let at = chrono::DateTime::parse_from_rfc3339(&row.time)
                .map(|t| t.timestamp_millis())
                .unwrap_or(i64::MAX);
            let retry = plan.retry.get(&row.id);
            let accepted = retry.is_some_and(|r| r.accepted.is_some());
            let wall_wait = if accepted {
                0
            } else {
                at.saturating_sub(now).max(0)
            };
            let retry_wait = retry.map_or(0, |r| r.due.saturating_sub(steady).max(0));
            let throttle = if accepted {
                0
            } else {
                plan.last_send
                    .map_or(0, |t| t.saturating_add(1000).saturating_sub(steady).max(0))
            };
            delay = delay.min(wall_wait.max(retry_wait).max(throttle).max(1));
        }
        Ok((delay.clamp(1, 30_000) as u64, changed))
    }
    async fn run(self: Arc<Self>, changed_event: impl Fn() + Send + 'static) {
        while !self.stopping.load(Ordering::SeqCst) {
            let old_status = self.status();
            let delay = match self.reconcile().await {
                Ok((delay, changed)) => {
                    if changed {
                        changed_event();
                    }
                    delay
                }
                Err(_) => {
                    *self.error.lock().unwrap() = Some("REMINDER_RECONCILE_FAILED");
                    30_000
                }
            };
            if self.status() != old_status {
                changed_event();
            }
            tokio::select! { _=tokio::time::sleep(Duration::from_millis(delay))=>{}, _=self.wake.notified()=>{} }
        }
    }
}
pub async fn initialize(app: &tauri::AppHandle) {
    if let Ok(pool) = crate::db::shared_pool(app).await {
        let scheduler = Scheduler::new(
            pool,
            Arc::new(SystemClock(std::time::Instant::now())),
            Arc::new(SystemNotification(app.clone())),
        );
        app.manage(scheduler.clone());
        let handle = app.clone();
        let worker = tauri::async_runtime::spawn(scheduler.clone().run(move || {
            let _ = handle.emit_to("main", "reminders-changed", ());
        }));
        *scheduler.worker.lock().await = Some(worker);
    }
}
#[cfg(test)]
mod tests;
