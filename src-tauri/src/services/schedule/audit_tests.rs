use super::*;
use sqlx::sqlite::SqlitePoolOptions;

fn local(value: &str) -> DateTime<Utc> {
    local_time(NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.f").unwrap()).unwrap()
}

async fn database() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::query("PRAGMA foreign_keys=ON")
        .execute(&pool)
        .await
        .unwrap();
    for migration in [
        include_str!("../../../migrations/0001_initial.sql"),
        include_str!("../../../migrations/0002_natural_schedule.sql"),
        include_str!("../../../migrations/0003_task_priority.sql"),
        include_str!("../../../migrations/0004_task_trash.sql"),
        include_str!("../../../migrations/0005_journal.sql"),
        include_str!("../../../migrations/0006_task_content.sql"),
        include_str!("../../../migrations/0007_journal_task_completions.sql"),
        include_str!("../../../migrations/0008_journal_content.sql"),
        include_str!("../../../migrations/0009_journal_review.sql"),
        include_str!("../../../migrations/0010_recurrence_progress.sql"),
    ] {
        sqlx::raw_sql(migration).execute(&pool).await.unwrap();
    }
    pool
}

fn input(due: DateTime<Utc>) -> ScheduledInput {
    ScheduledInput {
        title: "日程审查样本".into(),
        list_id: None,
        notes: "原始备注".into(),
        due_at: Some(stamp(due)),
        repeat_rule: Some("day:1".into()),
        remind_at: vec![stamp(due)],
        reminder_offsets: vec![0],
        priority: None,
    }
}

fn update_input(value: serde_json::Value) -> ScheduledUpdate {
    serde_json::from_value(value).unwrap()
}

#[test]
fn shared_legacy_calendar_cases_preserve_precision_and_handle_exhaustion() {
    #[derive(Deserialize)]
    struct Case {
        rule: String,
        prior: String,
        after: String,
        expected: Option<String>,
    }
    let cases: Vec<Case> = serde_json::from_str(include_str!(
        "../../../../src/domain/__fixtures__/legacyRecurrence.json"
    ))
    .unwrap();
    for case in cases {
        assert_eq!(
            next_due(local(&case.prior), &case.rule, local(&case.after)),
            case.expected.as_deref().map(local),
            "{} / {}",
            case.rule,
            case.prior
        );
    }
    for invalid in ["year-date:2:30", "year-date:4:31", "day:0"] {
        assert!(next_due(
            local("2026-11-16T09:00:00"),
            invalid,
            local("2026-11-16T10:00:00")
        )
        .is_none());
    }
}

#[test]
fn timezone_gaps_and_overlaps_match_browser_resolution_without_panics() {
    for (zone, naive, expected) in [
        (
            chrono_tz::America::New_York,
            "2026-03-08T02:30:00",
            "2026-03-08T07:30:00.000Z",
        ),
        (
            chrono_tz::America::New_York,
            "2026-11-01T01:30:00",
            "2026-11-01T05:30:00.000Z",
        ),
        (
            chrono_tz::Australia::Lord_Howe,
            "2026-10-04T02:15:00",
            "2026-10-03T15:45:00.000Z",
        ),
        (
            chrono_tz::Pacific::Apia,
            "2011-12-30T12:00:00",
            "2011-12-30T22:00:00.000Z",
        ),
    ] {
        let value = NaiveDateTime::parse_from_str(naive, "%Y-%m-%dT%H:%M:%S").unwrap();
        assert_eq!(stamp(resolve_local(&zone, value).unwrap()), expected);
    }
    let beyond_utc =
        NaiveDateTime::parse_from_str("9999-12-31T23:30:00", "%Y-%m-%dT%H:%M:%S").unwrap();
    assert!(resolve_local(&chrono_tz::America::New_York, beyond_utc).is_none());
}

#[test]
fn recompletion_remains_idempotent_even_when_the_successor_was_deleted() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        let now = local("2026-11-16T09:00:00").timestamp_millis();
        let original = create(&pool, input(local("2026-11-16T10:00:00")), now)
            .await
            .unwrap();
        super::super::reminders::update_status(&pool, original, "completed", now)
            .await
            .unwrap();
        super::super::reminders::update_status(&pool, original, "todo", now + 1000)
            .await
            .unwrap();
        super::super::reminders::update_status(&pool, original, "completed", now + 2000)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM tasks")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2
        );
        sqlx::query("DELETE FROM tasks WHERE id<>?")
            .bind(original)
            .execute(&pool)
            .await
            .unwrap();
        super::super::reminders::update_status(&pool, original, "todo", now + 3000)
            .await
            .unwrap();
        super::super::reminders::update_status(&pool, original, "completed", now + 4000)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM tasks")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        pool.close().await;
    });
}

#[test]
fn undo_restores_only_future_scheduled_reminders_without_recreating_successors() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        let now = local("2026-11-16T09:00:00").timestamp_millis();
        let due = local("2026-11-16T11:00:00");
        let mut value = input(due);
        value.remind_at.push(stamp(local("2026-11-16T10:00:00")));
        value.reminder_offsets.push(60);
        let original = create(&pool, value, now).await.unwrap();
        super::super::reminders::update_status(&pool, original, "completed", now)
            .await
            .unwrap();
        let later = local("2026-11-16T10:30:00").timestamp_millis();
        for _ in 0..2 {
            super::super::reminders::update_status(&pool, original, "todo", later)
                .await
                .unwrap();
        }
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT remind_at FROM reminders WHERE task_id=?")
                .bind(original)
                .fetch_all(&pool)
                .await
                .unwrap(),
            vec![stamp(due)]
        );
        super::super::reminders::update_status(&pool, original, "completed", later)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM tasks")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2
        );
        super::super::reminders::update_status(
            &pool,
            original,
            "todo",
            local("2026-11-16T12:00:00").timestamp_millis(),
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM reminders WHERE task_id=?")
                .bind(original)
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
        pool.close().await;
    });
}

#[test]
fn failed_successor_rolls_back_completion_reminders_and_progress() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        let now = local("2026-11-16T09:00:00").timestamp_millis();
        let original = create(&pool, input(local("2026-11-16T10:00:00")), now)
            .await
            .unwrap();
        sqlx::query("CREATE TRIGGER fail_successor BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'test'); END").execute(&pool).await.unwrap();
        assert_eq!(
            super::super::reminders::update_status(&pool, original, "completed", now).await,
            Err("TASK_CREATE_FAILED")
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT status FROM tasks")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "todo"
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM reminders")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM task_recurrence_progress")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
        sqlx::query("DROP TRIGGER fail_successor")
            .execute(&pool)
            .await
            .unwrap();
        super::super::reminders::update_status(&pool, original, "completed", now)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM tasks")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2
        );
        pool.close().await;
    });
}

#[test]
fn unchanged_expired_reminders_do_not_block_or_rebuild_a_schedule() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        let now = local("2026-11-16T09:00:00").timestamp_millis();
        let due = local("2026-11-16T10:00:00");
        let original = create(&pool, input(due), now).await.unwrap();
        let reminders: Vec<(i64, String)> = sqlx::query_as("SELECT id,remind_at FROM reminders")
            .fetch_all(&pool)
            .await
            .unwrap();
        let later = local("2026-11-16T11:00:00").timestamp_millis();
        update(&pool, original, update_input(serde_json::json!({"hasDue":true,"dueAt":stamp(due),"hasRepeat":true,"repeatRule":null,"reminderOffsets":[0],"hasList":false})), later).await.unwrap();
        assert_eq!(
            sqlx::query_as::<_, (i64, String)>("SELECT id,remind_at FROM reminders")
                .fetch_all(&pool)
                .await
                .unwrap(),
            reminders
        );
        assert_eq!(
            update(
                &pool,
                original,
                update_input(
                    serde_json::json!({"reminderOffsets":[0,5],"hasDue":false,"hasList":false})
                ),
                later
            )
            .await,
            Err("REMINDER_MUST_BE_FUTURE")
        );
        assert_eq!(
            sqlx::query_as::<_, (i64, String)>("SELECT id,remind_at FROM reminders")
                .fetch_all(&pool)
                .await
                .unwrap(),
            reminders
        );
        update(
            &pool,
            original,
            update_input(serde_json::json!({"hasDue":true,"dueAt":null,"hasList":false})),
            later,
        )
        .await
        .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT count(*) FROM reminders")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
        pool.close().await;
    });
}

#[test]
fn invalid_calendar_values_leave_the_previous_schedule_intact() {
    tauri::async_runtime::block_on(async {
        let pool = database().await;
        let now = local("2026-11-16T09:00:00").timestamp_millis();
        let due = local("2026-11-16T10:00:00");
        let original = create(&pool, input(due), now).await.unwrap();
        for invalid in ["0000-01-01", "2026-02-30", "2026-1-1", "10000-01-01"] {
            assert_eq!(update(&pool, original, update_input(serde_json::json!({"hasDue":true,"dueAt":null,"hasDate":true,"dueDate":invalid,"hasList":false})), now).await, Err("INVALID_DUE_TIME"));
        }
        for invalid in [
            "0000-01-01T09:00:00Z",
            "9999-12-31T23:59:59-14:00",
            "2026-11-16T10:00:00+15:00",
        ] {
            let mut value = input(due);
            value.due_at = Some(invalid.into());
            assert_eq!(create(&pool, value, now).await, Err("INVALID_DUE_TIME"));
        }
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT due_at FROM tasks WHERE id=?")
                .bind(original)
                .fetch_one(&pool)
                .await
                .unwrap(),
            stamp(due)
        );
        pool.close().await;
    });
}
