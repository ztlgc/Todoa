use chrono::{
    DateTime, Datelike, Duration, Local, LocalResult, NaiveDate, NaiveDateTime, SecondsFormat,
    TimeZone, Timelike, Utc,
};
use serde::Deserialize;
use sqlx::{Row, SqlitePool};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledInput {
    pub title: String,
    pub list_id: Option<i64>,
    pub notes: String,
    pub due_at: Option<String>,
    pub repeat_rule: Option<String>,
    pub remind_at: Vec<String>,
    pub reminder_offsets: Vec<i64>,
    pub priority: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledUpdate {
    #[serde(default)]
    pub has_date: bool,
    pub due_date: Option<String>,
    #[serde(default)]
    pub has_repeat: bool,
    pub repeat_rule: Option<String>,
    pub reminder_offsets: Option<Vec<i64>>,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub list_id: Option<i64>,
    pub due_at: Option<String>,
    pub has_list: bool,
    pub has_due: bool,
    #[serde(default)]
    pub clear_repeat: bool,
    pub priority: Option<String>,
}
fn valid_priority(value: &str) -> bool {
    matches!(value, "high" | "medium" | "low" | "none")
}
fn stamp(date: DateTime<Utc>) -> String {
    date.to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn valid_rule(rule: &str) -> bool {
    if rule.starts_with('{') { return super::recurrence::parse(rule).is_some(); }
    if matches!(rule, "week-monday" | "weekday" | "weekend" | "month-last") {
        return true;
    }
    let parts: Vec<&str> = rule.split(':').collect();
    match parts.as_slice() {
        [unit, amount] if matches!(*unit, "day" | "week" | "month" | "year") => {
            amount.parse::<u32>().is_ok_and(|n| (1..=999).contains(&n))
        }
        ["month-day", day] => day.parse::<u32>().is_ok_and(|n| (1..=31).contains(&n)),
        ["year-date", month, day] => month
            .parse::<u32>()
            .ok()
            .zip(day.parse::<u32>().ok())
            .is_some_and(|(m, d)| NaiveDate::from_ymd_opt(2024, m, d).is_some()),
        _ => false,
    }
}
pub async fn create(
    pool: &SqlitePool,
    input: ScheduledInput,
    now: i64,
) -> Result<i64, &'static str> {
    if input
        .priority
        .as_deref()
        .is_some_and(|value| !valid_priority(value))
    {
        return Err("INVALID_PRIORITY");
    }
    if input.title.trim().is_empty()
        || input.title.chars().count() > 500
        || input.title.contains('\0')
        || input.notes.chars().count() > 100_000
    {
        return Err("INVALID_TASK");
    }
    if input
        .list_id
        .is_some_and(|id| id <= 0 || id > 9_007_199_254_740_991)
    {
        return Err("INVALID_LIST");
    }
    let due = input
        .due_at
        .as_ref()
        .map(|value| {
            DateTime::parse_from_rfc3339(value)
                .map(|date| stamp(date.with_timezone(&Utc)))
                .map_err(|_| "INVALID_DUE_TIME")
        })
        .transpose()?;
    if input
        .repeat_rule
        .as_deref()
        .is_some_and(|rule| !valid_rule(rule))
        || (input.repeat_rule.is_some() && due.is_none())
    {
        return Err("INVALID_REPEAT_RULE");
    }
    if input.remind_at.len() > 16
        || input.reminder_offsets.len() > 16
        || input
            .reminder_offsets
            .iter()
            .any(|n| !(0..=525_600).contains(n))
    {
        return Err("INVALID_REMINDER_RULE");
    }
    let reminders = input
        .remind_at
        .iter()
        .map(|value| {
            DateTime::parse_from_rfc3339(value)
                .map(|date| date.with_timezone(&Utc))
                .map_err(|_| "INVALID_REMINDER_TIME")
        })
        .collect::<Result<Vec<_>, _>>()?;
    if reminders.len() != input.reminder_offsets.len() {
        return Err("INVALID_REMINDER_RULE");
    }
    if !reminders.is_empty() {
        let due_time = DateTime::parse_from_rfc3339(due.as_deref().ok_or("INVALID_DUE_TIME")?)
            .map_err(|_| "INVALID_DUE_TIME")?
            .with_timezone(&Utc);
        if reminders
            .iter()
            .zip(&input.reminder_offsets)
            .any(|(remind, offset)| *remind != due_time - Duration::minutes(*offset))
        {
            return Err("INVALID_REMINDER_RULE");
        }
    }
    if reminders.iter().any(|date| date.timestamp_millis() <= now) {
        return Err("REMINDER_MUST_BE_FUTURE");
    }
    let mut tx = pool.begin().await.map_err(|_| "TASK_TRANSACTION_FAILED")?;
    let created = crate::services::reminders::timestamp(now);
    let offsets =
        serde_json::to_string(&input.reminder_offsets).map_err(|_| "INVALID_REMINDER_RULE")?;
    let result = sqlx::query("INSERT INTO tasks(title,list_id,notes,due_at,repeat_rule,reminder_offsets,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(input.title.trim()).bind(input.list_id).bind(input.notes).bind(due).bind(input.repeat_rule).bind(offsets).bind(input.priority.unwrap_or_else(|| "none".into())).bind(&created).bind(&created)
        .execute(&mut *tx).await.map_err(|_| "TASK_CREATE_FAILED")?;
    let id = result.last_insert_rowid();
    for date in reminders {
        sqlx::query("INSERT INTO reminders(task_id,remind_at,generated,created_at,updated_at) VALUES(?,?,1,?,?)")
            .bind(id).bind(stamp(date)).bind(&created).bind(&created)
            .execute(&mut *tx).await.map_err(|_| "REMINDER_CREATE_FAILED")?;
    }
    tx.commit().await.map_err(|_| "TASK_COMMIT_FAILED")?;
    Ok(id)
}
pub async fn update(
    pool: &SqlitePool,
    id: i64,
    input: ScheduledUpdate,
    now: i64,
) -> Result<(), &'static str> {
    if input
        .priority
        .as_deref()
        .is_some_and(|value| !valid_priority(value))
    {
        return Err("INVALID_PRIORITY");
    }
    crate::services::reminders::id(id)?;
    if input.title.as_ref().is_some_and(|title| {
        title.trim().is_empty() || title.chars().count() > 500 || title.contains('\0')
    }) || input
        .notes
        .as_ref()
        .is_some_and(|notes| notes.chars().count() > 100_000)
    {
        return Err("INVALID_TASK");
    }
    if input.has_list
        && input
            .list_id
            .is_some_and(|list| list <= 0 || list > 9_007_199_254_740_991)
    {
        return Err("INVALID_LIST");
    }
    let due = input
        .due_at
        .as_ref()
        .map(|value| {
            DateTime::parse_from_rfc3339(value)
                .map(|date| stamp(date.with_timezone(&Utc)))
                .map_err(|_| "INVALID_DUE_TIME")
        })
        .transpose()?;
    let mut tx = pool.begin().await.map_err(|_| "TASK_TRANSACTION_FAILED")?;
    let row = sqlx::query(
        "SELECT status,due_at,due_date,repeat_rule,reminder_offsets FROM tasks WHERE id=? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| "TASK_UPDATE_FAILED")?
    .ok_or("TASK_NOT_FOUND")?;
    let previous: Option<String> = row.get("due_at");
    let next_due_time = if input.has_due {
        due.clone()
    } else {
        previous.clone()
    };
    let next_date = if input.has_date {
        input.due_date.clone()
    } else {
        row.get::<Option<String>, _>("due_date")
    };
    if next_due_time.is_some() && next_date.is_some() {
        return Err("INVALID_DUE_TIME");
    }
    if let Some(date) = &next_date {
        if NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() {
            return Err("INVALID_DUE_TIME");
        }
    }
    let next_rule = if input.has_repeat {
        input.repeat_rule.clone()
    } else if input.clear_repeat {
        None
    } else {
        row.get::<Option<String>, _>("repeat_rule")
    };
    if next_rule.as_deref().is_some_and(|r| !valid_rule(r))
        || (next_rule.is_some() && next_due_time.is_none() && next_date.is_none())
    {
        return Err("INVALID_REPEAT_RULE");
    }
    let offsets = if next_due_time.is_none() { vec![] } else { input.reminder_offsets.clone().unwrap_or(
        serde_json::from_str::<Vec<i64>>(&row.get::<String, _>("reminder_offsets"))
            .map_err(|_| "INVALID_REMINDER_RULE")?,
    ) };
    if offsets.len() > 16
        || offsets.iter().any(|n| !(0..=525600).contains(n))
        || (next_due_time.is_none() && !offsets.is_empty())
    {
        return Err("INVALID_REMINDER_RULE");
    }
    if input.reminder_offsets.is_some()
        && offsets.iter().any(|offset| {
            DateTime::parse_from_rfc3339(next_due_time.as_deref().unwrap_or("")).map_or(true, |d| {
                (d - Duration::minutes(*offset)).timestamp_millis() <= now
            })
        })
    {
        return Err("REMINDER_MUST_BE_FUTURE");
    }
    let changed = (input.has_due && due != previous) || input.reminder_offsets.is_some();
    let stamp_now = crate::services::reminders::timestamp(now);
    sqlx::query("UPDATE tasks SET title=COALESCE(?,title),notes=COALESCE(?,notes),list_id=CASE WHEN ? THEN ? ELSE list_id END,due_at=CASE WHEN ? THEN ? ELSE due_at END,repeat_rule=CASE WHEN ? OR (? AND ? IS NULL) THEN NULL ELSE repeat_rule END,reminder_offsets=CASE WHEN ? AND ? IS NULL THEN '[]' ELSE reminder_offsets END,priority=COALESCE(?,priority),updated_at=? WHERE id=? AND deleted_at IS NULL")
        .bind(input.title.map(|s| s.trim().to_string())).bind(input.notes).bind(input.has_list).bind(input.list_id)
        .bind(input.has_due).bind(&due).bind(input.clear_repeat).bind(input.has_due).bind(&due).bind(input.has_due).bind(&due)
        .bind(input.priority).bind(&stamp_now).bind(id).execute(&mut *tx).await.map_err(|_| "TASK_UPDATE_FAILED")?;
    sqlx::query("UPDATE tasks SET due_date=?,repeat_rule=?,reminder_offsets=? WHERE id=?")
        .bind(&next_date)
        .bind(if next_due_time.is_none() && next_date.is_none() {
            None
        } else {
            next_rule.as_deref()
        })
        .bind(serde_json::to_string(&offsets).map_err(|_| "INVALID_REMINDER_RULE")?)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|_| "TASK_UPDATE_FAILED")?;
    if changed {
        sqlx::query(
            "DELETE FROM reminders WHERE task_id=? AND generated=1 AND triggered_at IS NULL",
        )
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|_| "REMINDER_CANCEL_FAILED")?;
        if let Some(due) = next_due_time {
            if row.get::<String, _>("status") == "todo" {
                let parsed = DateTime::parse_from_rfc3339(&due)
                    .map_err(|_| "INVALID_DUE_TIME")?
                    .with_timezone(&Utc);
                for minutes in offsets {
                    let remind = parsed - Duration::minutes(minutes);
                    if remind.timestamp_millis() <= now {
                        continue;
                    }
                    sqlx::query("INSERT INTO reminders(task_id,remind_at,generated,created_at,updated_at) VALUES(?,?,1,?,?)")
                        .bind(id).bind(stamp(remind)).bind(&stamp_now).bind(&stamp_now)
                        .execute(&mut *tx).await.map_err(|_| "REMINDER_CREATE_FAILED")?;
                }
            }
        }
    }
    tx.commit().await.map_err(|_| "TASK_COMMIT_FAILED")
}
fn days_in_month(year: i32, month: u32) -> u32 {
    let next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    };
    next.expect("supported calendar date")
        .pred_opt()
        .expect("previous day")
        .day()
}
pub(super) fn local_time(naive: NaiveDateTime) -> DateTime<Utc> {
    let resolved = match Local.from_local_datetime(&naive) {
        LocalResult::Single(date) => date,
        LocalResult::Ambiguous(earlier, _) => earlier,
        LocalResult::None => {
            let shifted = naive + Duration::hours(1);
            Local
                .from_local_datetime(&shifted)
                .earliest()
                .expect("valid shifted local time")
        }
    };
    resolved.with_timezone(&Utc)
}
pub fn next_due(prior: DateTime<Utc>, rule: &str, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
    if rule.starts_with('{') { return super::recurrence::next(prior, &super::recurrence::parse(rule)?, after); }
    let local = prior.with_timezone(&Local);
    let mut date = local.date_naive();
    let clock = local.time();
    for _ in 0..10_000 {
        let parts: Vec<&str> = rule.split(':').collect();
        date = match parts.as_slice() {
            ["day", n] => date.checked_add_signed(Duration::days(n.parse::<i64>().ok()?))?,
            ["week", n] => date.checked_add_signed(Duration::days(n.parse::<i64>().ok()? * 7))?,
            ["month", n] | ["year", n] => {
                let months = n.parse::<i32>().ok()? * if parts[0] == "year" { 12 } else { 1 };
                let index = date.year() * 12 + date.month0() as i32 + months;
                let year = index.div_euclid(12);
                let month = index.rem_euclid(12) as u32 + 1;
                NaiveDate::from_ymd_opt(year, month, date.day().min(days_in_month(year, month)))?
            }
            ["week-monday"] => date.checked_add_signed(Duration::days(
                8 - date.weekday().number_from_monday() as i64,
            ))?,
            ["weekday"] => {
                let mut next = date.succ_opt()?;
                while next.weekday().number_from_monday() > 5 {
                    next = next.succ_opt()?;
                }
                next
            }
            ["weekend"] => {
                let mut next = date.succ_opt()?;
                while next.weekday().number_from_monday() < 6 {
                    next = next.succ_opt()?;
                }
                next
            }
            ["month-last"] | ["month-day", _] => {
                let (year, month) = if date.month() == 12 {
                    (date.year() + 1, 1)
                } else {
                    (date.year(), date.month() + 1)
                };
                let day = if parts[0] == "month-last" {
                    days_in_month(year, month)
                } else {
                    parts[1]
                        .parse::<u32>()
                        .ok()?
                        .min(days_in_month(year, month))
                };
                NaiveDate::from_ymd_opt(year, month, day)?
            }
            ["year-date", month, day] => {
                let month = month.parse::<u32>().ok()?;
                let day = day.parse::<u32>().ok()?;
                let mut year = date.year();
                loop {
                    if let Some(candidate) = NaiveDate::from_ymd_opt(year, month, day) {
                        if candidate > date {
                            break candidate;
                        }
                    }
                    year += 1;
                }
            }
            _ => return None,
        };
        let next = local_time(date.and_hms_opt(clock.hour(), clock.minute(), clock.second())?);
        if next > after {
            return Some(next);
        }
    }
    None
}
pub async fn create_next(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    task_id: i64,
    now: i64,
) -> Result<(), &'static str> {
    let row = sqlx::query("SELECT title,list_id,notes,due_at,due_date,content_json,repeat_rule,reminder_offsets,priority,sort_order FROM tasks WHERE id=?")
        .bind(task_id).fetch_one(&mut **tx).await.map_err(|_| "TASK_NOT_FOUND")?;
    let Some(rule) = row.get::<Option<String>, _>("repeat_rule") else {
        return Ok(());
    };
    let date_only = row.get::<Option<String>, _>("due_date");
    let due: String = match row.get::<Option<String>, _>("due_at") {
        Some(time) => time,
        None => {
            let date = NaiveDate::parse_from_str(
                date_only.as_deref().ok_or("INVALID_REPEAT_RULE")?,
                "%Y-%m-%d",
            )
            .map_err(|_| "INVALID_DUE_TIME")?;
            Local
                .from_local_datetime(&date.and_hms_opt(12, 0, 0).unwrap())
                .earliest()
                .ok_or("INVALID_DUE_TIME")?
                .to_rfc3339()
        }
    };
    let prior = DateTime::parse_from_rfc3339(&due)
        .map_err(|_| "INVALID_DUE_TIME")?
        .with_timezone(&Utc);
    let after = DateTime::from_timestamp_millis(now).ok_or("INVALID_DUE_TIME")?;
    let next = match next_due(prior, &rule, after) {
        Some(next) => next,
        None if super::recurrence::parse(&rule).is_some() => return Ok(()),
        None => return Err("INVALID_REPEAT_RULE"),
    };
    let next_rule = super::recurrence::advance(&rule);
    let created = crate::services::reminders::timestamp(now);
    let offsets: String = row.get("reminder_offsets");
    let result = sqlx::query("INSERT INTO tasks(title,list_id,notes,due_at,repeat_rule,reminder_offsets,priority,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(row.get::<String,_>("title")).bind(row.get::<Option<i64>,_>("list_id")).bind(row.get::<String,_>("notes"))
        .bind(if date_only.is_some() {None} else {Some(stamp(next))}).bind(&next_rule).bind(&offsets).bind(row.get::<String,_>("priority")).bind(row.get::<i64,_>("sort_order")).bind(&created).bind(&created)
        .execute(&mut **tx).await.map_err(|_| "TASK_CREATE_FAILED")?;
    let new_id = result.last_insert_rowid();
    sqlx::query("UPDATE tasks SET content_json=?,due_date=? WHERE id=?")
        .bind(row.get::<Option<String>, _>("content_json"))
        .bind(date_only.map(|_| next.with_timezone(&Local).format("%Y-%m-%d").to_string()))
        .bind(new_id)
        .execute(&mut **tx)
        .await
        .map_err(|_| "TASK_CREATE_FAILED")?;
    sqlx::query("INSERT INTO task_asset_refs(task_id,asset_id) SELECT ?,asset_id FROM task_asset_refs WHERE task_id=?").bind(new_id).bind(task_id).execute(&mut **tx).await.map_err(|_|"TASK_CREATE_FAILED")?;
    sqlx::query(
        "INSERT INTO task_tags(task_id,tag_id) SELECT ?,tag_id FROM task_tags WHERE task_id=?",
    )
    .bind(new_id)
    .bind(task_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| "TASK_TAG_COPY_FAILED")?;
    let minutes: Vec<i64> = serde_json::from_str(&offsets).map_err(|_| "INVALID_REMINDER_RULE")?;
    for offset in minutes {
        let remind = next - Duration::minutes(offset);
        if remind.timestamp_millis() <= now {
            continue;
        }
        sqlx::query("INSERT INTO reminders(task_id,remind_at,generated,created_at,updated_at) VALUES(?,?,1,?,?)")
            .bind(new_id).bind(stamp(remind)).bind(&created).bind(&created)
            .execute(&mut **tx).await.map_err(|_| "REMINDER_CREATE_FAILED")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn advances_calendar_rules() {
        let prior = DateTime::parse_from_rfc3339("2026-10-02T15:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let after = prior;
        assert!(next_due(prior, "weekday", after).unwrap() > after);
        assert!(next_due(prior, "month-last", after).unwrap() > after);
        assert!(next_due(prior, "year-date:3:6", after).unwrap() > after);
    }
    #[test]
    fn creates_reminders_and_next_occurrence_atomically() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
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

            let now = DateTime::parse_from_rfc3339("2026-10-05T01:00:00Z")
                .unwrap()
                .timestamp_millis();
            let input = ScheduledInput {
                title: "开会".into(),
                list_id: None,
                notes: "".into(),
                due_at: Some("2026-10-05T07:00:00.000Z".into()),
                repeat_rule: Some("day:1".into()),
                remind_at: vec!["2026-10-05T06:55:00.000Z".into()],
                reminder_offsets: vec![5],
                priority: Some("high".into()),
            };
            let id = create(&pool, input, now).await.unwrap();
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT count(*) FROM reminders WHERE task_id=?")
                    .bind(id)
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                1
            );
            crate::services::reminders::create(&pool, id, "2026-10-05T06:30:00.000Z", now)
                .await
                .unwrap();
            update(
                &pool,
                id,
                ScheduledUpdate {
                    has_date: false,
                    due_date: None,
                    has_repeat: false,
                    repeat_rule: None,
                    reminder_offsets: None,
                    title: None,
                    notes: None,
                    list_id: None,
                    due_at: Some("2026-10-05T08:00:00.000Z".into()),
                    has_list: false,
                    has_due: true,
                    clear_repeat: false,
                    priority: None,
                },
                now,
            )
            .await
            .unwrap();
            let moved: String = sqlx::query_scalar(
                "SELECT remind_at FROM reminders WHERE task_id=? AND generated=1",
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(moved, "2026-10-05T07:55:00.000Z");
            assert_eq!(
                sqlx::query_scalar::<_, i64>(
                    "SELECT count(*) FROM reminders WHERE task_id=? AND generated=0"
                )
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap(),
                1
            );
            crate::services::reminders::update_status(&pool, id, "completed", now + 1000)
                .await
                .unwrap();
            let next: (i64, String) = sqlx::query_as("SELECT id,due_at FROM tasks WHERE id<>?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert!(next.1 > "2026-10-05T07:00:00.000Z".to_string());
            let next_priority: String = sqlx::query_scalar("SELECT priority FROM tasks WHERE id=?")
                .bind(next.0)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(next_priority, "high");
            assert_eq!(
                sqlx::query_scalar::<_, i64>("SELECT count(*) FROM reminders WHERE task_id=?")
                    .bind(next.0)
                    .fetch_one(&pool)
                    .await
                    .unwrap(),
                1
            );
            crate::services::reminders::update_status(&pool, id, "completed", now + 2000)
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
}
