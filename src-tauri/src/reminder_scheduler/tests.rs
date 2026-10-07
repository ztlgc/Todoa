use super::*;
use std::sync::{atomic::AtomicI64, Mutex as StdMutex};
use tempfile::TempDir;
struct FakeClock(AtomicI64);
impl Clock for FakeClock {
    fn now(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}
struct FakeNotification {
    calls: StdMutex<Vec<(i64, String)>>,
    fail: AtomicBool,
}
impl Notification for FakeNotification {
    fn send(&self, row: &Pending) -> Result<(), &'static str> {
        self.calls.lock().unwrap().push((row.id, row.title.clone()));
        if self.fail.load(Ordering::SeqCst) {
            Err("FAKE_API_FAILED")
        } else {
            Ok(())
        }
    }
}
const NOW: i64 = 1_791_072_000_000;
async fn fixture() -> (
    TempDir,
    SqlitePool,
    Arc<FakeClock>,
    Arc<FakeNotification>,
    Arc<Scheduler>,
    i64,
) {
    // No AppHandle, identifier, env override, or formal path. Fake only exists in cfg(test).
    let dir = tempfile::tempdir().unwrap();
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(dir.path().join("reminder-test.db"))
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../migrations/0001_initial.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../migrations/0002_natural_schedule.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../migrations/0003_task_priority.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../migrations/0004_task_trash.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../migrations/0005_journal.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../migrations/0006_task_content.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let task = crate::services::quick_add::create(&pool, "fresh title")
        .await
        .unwrap();
    let clock = Arc::new(FakeClock(AtomicI64::new(NOW)));
    let notification = Arc::new(FakeNotification {
        calls: StdMutex::new(vec![]),
        fail: AtomicBool::new(false),
    });
    let scheduler = Scheduler::new(pool.clone(), clock.clone(), notification.clone());
    (dir, pool, clock, notification, scheduler, task)
}
async fn add(pool: &SqlitePool, task: i64, offset: i64) -> i64 {
    reminders::create(pool, task, &reminders::timestamp(NOW + offset), NOW)
        .await
        .unwrap()
}
async fn marked(pool: &SqlitePool, id: i64) -> bool {
    sqlx::query_scalar::<_, Option<String>>("SELECT triggered_at FROM reminders WHERE id=?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
        .is_some()
}
#[test]
fn exact_due_catchup_order_throttle_concurrent_reconcile_and_stop() {
    tauri::async_runtime::block_on(async {
        let (_dir, pool, clock, n, s, task) = fixture().await;
        let first = add(&pool, task, 1000).await;
        let second = add(&pool, task, 2000).await;
        assert_eq!(s.reconcile().await.unwrap(), (1000, false));
        clock.0.store(NOW + 999, Ordering::SeqCst);
        assert_eq!(s.reconcile().await.unwrap().0, 1);
        assert!(n.calls.lock().unwrap().is_empty());
        clock.0.store(NOW + 5000, Ordering::SeqCst);
        let a = s.clone();
        let b = s.clone();
        let (x, y) = tokio::join!(a.reconcile(), b.reconcile());
        x.unwrap();
        y.unwrap();
        assert_eq!(
            n.calls.lock().unwrap().as_slice(),
            &[(first, "fresh title".into())]
        );
        assert!(marked(&pool, first).await);
        assert!(!marked(&pool, second).await);
        clock.0.store(NOW + 5999, Ordering::SeqCst);
        assert_eq!(s.reconcile().await.unwrap().0, 1);
        clock.0.store(NOW + 6000, Ordering::SeqCst);
        s.reconcile().await.unwrap();
        assert!(marked(&pool, second).await);
        let third = add(&pool, task, 9000).await;
        s.stop().await;
        clock.0.store(NOW + 20_000, Ordering::SeqCst);
        s.reconcile().await.unwrap();
        assert!(!marked(&pool, third).await);
        assert_eq!(n.calls.lock().unwrap().len(), 2);
        pool.close().await;
    });
}
#[test]
fn edit_delete_completion_undo_and_restart_persistence() {
    tauri::async_runtime::block_on(async {
        let (dir, pool, clock, n, s, task) = fixture().await;
        let moved = add(&pool, task, 1000).await;
        let deleted = add(&pool, task, 1000).await;
        reminders::edit(&pool, moved, &reminders::timestamp(NOW + 10_000), NOW)
            .await
            .unwrap();
        reminders::delete(&pool, deleted).await.unwrap();
        clock.0.store(NOW + 2000, Ordering::SeqCst);
        s.reconcile().await.unwrap();
        assert!(n.calls.lock().unwrap().is_empty());
        assert_eq!(s.reconcile().await.unwrap().0, 8000);
        sqlx::query("UPDATE tasks SET title='updated title' WHERE id=?")
            .bind(task)
            .execute(&pool)
            .await
            .unwrap();
        clock.0.store(NOW + 10_000, Ordering::SeqCst);
        s.reconcile().await.unwrap();
        assert_eq!(n.calls.lock().unwrap()[0].1, "updated title");
        assert_eq!(
            reminders::edit(&pool, moved, &reminders::timestamp(NOW + 30_000), NOW).await,
            Err("REMINDER_NOT_EDITABLE")
        );
        add(&pool, task, 20_000).await;
        reminders::update_status(&pool, task, "completed", NOW + 10_001)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM reminders WHERE task_id=?")
                .bind(task)
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            reminders::create(&pool, task, &reminders::timestamp(NOW + 30_000), NOW).await,
            Err("TASK_NOT_TODO")
        );
        reminders::update_status(&pool, task, "todo", NOW + 10_002)
            .await
            .unwrap();
        assert!(reminders::pending(&pool).await.unwrap().is_empty());
        let keep = add(&pool, task, 30_000).await;
        s.stop().await;
        pool.close().await;
        let reopened = SqlitePool::connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(dir.path().join("reminder-test.db"))
                .foreign_keys(true),
        )
        .await
        .unwrap();
        assert_eq!(reminders::pending(&reopened).await.unwrap()[0].id, keep);
        let resumed = Scheduler::new(reopened.clone(), clock.clone(), n.clone());
        clock.0.store(NOW + 40_000, Ordering::SeqCst);
        resumed.reconcile().await.unwrap();
        assert!(marked(&reopened, keep).await);
        sqlx::query("DELETE FROM tasks WHERE id=?")
            .bind(task)
            .execute(&reopened)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM reminders")
                .fetch_one(&reopened)
                .await
                .unwrap(),
            0
        );
        reopened.close().await;
    });
}
#[test]
fn transaction_rolls_back_status_when_cancel_fails_and_validates_inputs() {
    tauri::async_runtime::block_on(async {
        let (_dir, pool, _clock, _n, _s, task) = fixture().await;
        let r = add(&pool, task, 1000).await;
        sqlx::raw_sql("CREATE TRIGGER fail_cancel BEFORE DELETE ON reminders BEGIN SELECT RAISE(ABORT,'test'); END;").execute(&pool).await.unwrap();
        assert_eq!(
            reminders::update_status(&pool, task, "completed", NOW).await,
            Err("REMINDER_CANCEL_FAILED")
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM tasks WHERE id=?")
                .bind(task)
                .fetch_one(&pool)
                .await
                .unwrap(),
            "todo"
        );
        assert!(!marked(&pool, r).await);
        assert_eq!(
            reminders::future("2026-02-30T00:00:00Z", NOW),
            Err("INVALID_REMINDER_TIME")
        );
        assert!(reminders::future(&reminders::timestamp(NOW), NOW).is_err());
        assert!(reminders::id(0).is_err());
        assert!(reminders::id(9_007_199_254_740_992).is_err());
        assert_eq!(
            reminders::update_status(&pool, task, "bogus", NOW).await,
            Err("INVALID_STATUS")
        );
        assert_eq!(
            reminders::update_status(&pool, 999, "completed", NOW).await,
            Err("TASK_NOT_FOUND")
        );
        pool.close().await;
    });
}
#[test]
fn failure_backoff_and_successful_notification_failed_mark_does_not_resend() {
    tauri::async_runtime::block_on(async {
        let (_dir, pool, clock, n, s, task) = fixture().await;
        let r = add(&pool, task, 1000).await;
        n.fail.store(true, Ordering::SeqCst);
        clock.0.store(NOW + 1000, Ordering::SeqCst);
        s.reconcile().await.unwrap();
        assert!(!marked(&pool, r).await);
        assert_eq!(s.status(), "FAKE_API_FAILED");
        clock.0.store(NOW + 2999, Ordering::SeqCst);
        s.reconcile().await.unwrap();
        assert_eq!(n.calls.lock().unwrap().len(), 1);
        n.fail.store(false, Ordering::SeqCst);
        sqlx::raw_sql("CREATE TRIGGER fail_mark BEFORE UPDATE OF triggered_at ON reminders BEGIN SELECT RAISE(ABORT,'test'); END;").execute(&pool).await.unwrap();
        clock.0.store(NOW + 3000, Ordering::SeqCst);
        s.reconcile().await.unwrap();
        assert_eq!(n.calls.lock().unwrap().len(), 2);
        assert!(!marked(&pool, r).await);
        assert_eq!(s.status(), "REMINDER_MARK_FAILED");
        sqlx::raw_sql("DROP TRIGGER fail_mark")
            .execute(&pool)
            .await
            .unwrap();
        clock.0.store(NOW + 7000, Ordering::SeqCst);
        s.reconcile().await.unwrap();
        assert!(marked(&pool, r).await);
        assert_eq!(n.calls.lock().unwrap().len(), 2);
        let plan = s.plan.lock().await;
        assert!(plan.retry.is_empty());
        drop(plan);
        pool.close().await;
    });
}
#[test]
fn disabled_outlet_never_consumes_any_due_reminder() {
    tauri::async_runtime::block_on(async {
        let (_dir, pool, clock, _n, _s, task) = fixture().await;
        let r = add(&pool, task, 1000).await;
        clock.0.store(NOW + 5000, Ordering::SeqCst);
        let disabled = Scheduler::new(pool.clone(), clock, Arc::new(Disabled));
        assert_eq!(disabled.status(), "notification-not-enabled");
        assert_eq!(disabled.reconcile().await.unwrap(), (30_000, false));
        assert!(!marked(&pool, r).await);
        pool.close().await;
    });
}

#[test]
fn worker_wakes_for_changes_stops_and_backoff_is_capped() {
    tauri::async_runtime::block_on(async {
        let (_dir, pool, clock, n, s, task) = fixture().await;
        let r = add(&pool, task, 1000).await;
        let events = Arc::new(AtomicI64::new(0));
        let e = events.clone();
        let worker = tauri::async_runtime::spawn(s.clone().run(move || {
            e.fetch_add(1, Ordering::SeqCst);
        }));
        *s.worker.lock().await = Some(worker);
        clock.0.store(NOW + 1000, Ordering::SeqCst);
        s.changed();
        tokio::time::timeout(Duration::from_secs(3), async {
            while events.load(Ordering::SeqCst) == 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        assert!(marked(&pool, r).await);
        s.stop().await;
        let next = add(&pool, task, 2000).await;
        clock.0.store(NOW + 5000, Ordering::SeqCst);
        s.changed();
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!marked(&pool, next).await);
        assert_eq!(n.calls.lock().unwrap().len(), 1);
        let retry = Scheduler::new(pool.clone(), clock.clone(), n.clone());
        n.fail.store(true, Ordering::SeqCst);
        for attempt in 1..=12 {
            retry.reconcile().await.unwrap();
            let plan = retry.plan.lock().await;
            let r = plan.retry.get(&next).unwrap();
            let delay = r.due - clock.now();
            assert_eq!(r.attempts, attempt);
            assert!(delay <= 300_000);
            if attempt >= 9 {
                assert_eq!(delay, 300_000);
            }
            clock.0.store(r.due, Ordering::SeqCst);
        }
        assert!(!marked(&pool, next).await);
        pool.close().await;
    });
}

#[test]
fn clock_changes_and_reschedule_invalidate_retry_and_old_accepted_plan() {
    tauri::async_runtime::block_on(async {
        let (_dir, pool, clock, n, s, task) = fixture().await;
        let r = add(&pool, task, 1000).await;
        clock.0.store(NOW - 5000, Ordering::SeqCst);
        assert_eq!(s.reconcile().await.unwrap().0, 6000);
        clock.0.store(NOW + 1000, Ordering::SeqCst);
        sqlx::raw_sql("CREATE TRIGGER mark_failure BEFORE UPDATE OF triggered_at ON reminders BEGIN SELECT RAISE(ABORT,'test'); END;").execute(&pool).await.unwrap();
        s.reconcile().await.unwrap();
        assert_eq!(n.calls.lock().unwrap().len(), 1);
        reminders::edit(&pool, r, &reminders::timestamp(NOW + 20_000), NOW + 1000)
            .await
            .unwrap();
        sqlx::raw_sql("DROP TRIGGER mark_failure")
            .execute(&pool)
            .await
            .unwrap();
        clock.0.store(NOW + 5000, Ordering::SeqCst);
        assert_eq!(s.reconcile().await.unwrap().0, 15_000);
        assert!(!marked(&pool, r).await);
        clock.0.store(NOW + 30_000, Ordering::SeqCst);
        s.reconcile().await.unwrap();
        assert!(marked(&pool, r).await);
        assert_eq!(n.calls.lock().unwrap().len(), 2);
        pool.close().await;
    });
}

#[test]
fn clock_rollback_cannot_break_monotonic_delivery_throttle() {
    tauri::async_runtime::block_on(async {
        struct DualClock {
            wall: AtomicI64,
            steady: AtomicI64,
        }
        impl Clock for DualClock {
            fn now(&self) -> i64 {
                self.wall.load(Ordering::SeqCst)
            }
            fn steady(&self) -> i64 {
                self.steady.load(Ordering::SeqCst)
            }
        }
        let (_dir, pool, _clock, n, _s, task) = fixture().await;
        let first = add(&pool, task, 1000).await;
        let second = add(&pool, task, 1000).await;
        let clock = Arc::new(DualClock {
            wall: AtomicI64::new(NOW + 20_000),
            steady: AtomicI64::new(1000),
        });
        let s = Scheduler::new(pool.clone(), clock.clone(), n.clone());
        s.reconcile().await.unwrap();
        assert!(marked(&pool, first).await);
        clock.wall.store(NOW + 2000, Ordering::SeqCst);
        clock.steady.store(1999, Ordering::SeqCst);
        assert_eq!(s.reconcile().await.unwrap().0, 1);
        assert!(!marked(&pool, second).await);
        clock.steady.store(2000, Ordering::SeqCst);
        s.reconcile().await.unwrap();
        assert!(marked(&pool, second).await);
        pool.close().await;
    });
}
