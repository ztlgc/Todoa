use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub v: u8,
    pub basis: String,
    pub frequency: String,
    pub interval: u32,
    pub anchor: String,
    pub weekdays: Vec<u32>,
    pub month_mode: String,
    pub month_days: Vec<i32>,
    pub ordinal: i32,
    pub weekday: u32,
    pub workday: String,
    pub month: u32,
    pub dates: Vec<String>,
    pub skip_weekends: bool,
    pub end: String,
    pub end_date: Option<String>,
    pub count: u32,
}
fn date(value: &str) -> Option<NaiveDate> {
    let parsed = NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()?;
    (parsed.year() >= 1 && parsed.year() <= 9999 && parsed.format("%Y-%m-%d").to_string() == value)
        .then_some(parsed)
}
fn unique<T: PartialEq>(items: &[T]) -> bool {
    items
        .iter()
        .enumerate()
        .all(|(i, v)| !items[..i].contains(v))
}
pub fn parse(value: &str) -> Option<Rule> {
    let r: Rule = serde_json::from_str(value).ok()?;
    let anchor = date(&r.anchor)?;
    let valid = r.v == 1
        && matches!(r.basis.as_str(), "due" | "completion" | "dates")
        && matches!(r.frequency.as_str(), "day" | "week" | "month" | "year")
        && (1..=999).contains(&r.interval)
        && !r.weekdays.is_empty()
        && r.weekdays.len() <= 7
        && unique(&r.weekdays)
        && r.weekdays.iter().all(|n| (1..=7).contains(n))
        && matches!(r.month_mode.as_str(), "dates" | "ordinal" | "workday")
        && !r.month_days.is_empty()
        && r.month_days.len() <= 32
        && unique(&r.month_days)
        && r.month_days
            .iter()
            .all(|n| *n == -1 || (1..=31).contains(n))
        && (r.ordinal == -1 || (1..=5).contains(&r.ordinal))
        && (1..=7).contains(&r.weekday)
        && matches!(r.workday.as_str(), "first" | "last")
        && (1..=12).contains(&r.month)
        && r.dates.len() <= 366
        && unique(&r.dates)
        && r.dates.iter().all(|s| date(s).is_some())
        && (r.basis != "dates"
            || (!r.dates.is_empty()
                && r.dates.iter().all(|s| date(s).is_some_and(|d| d >= anchor))))
        && matches!(r.end.as_str(), "never" | "date" | "count")
        && r.end_date.as_deref().is_none_or(|s| date(s).is_some())
        && (r.end != "date"
            || r.end_date
                .as_deref()
                .and_then(date)
                .is_some_and(|d| d >= anchor))
        && (1..=9999).contains(&r.count);
    valid.then_some(r)
}
pub fn advance(value: &str) -> String {
    if let Some(mut r) = parse(value) {
        if r.end == "count" {
            r.count = r.count.saturating_sub(1).max(1);
            return serde_json::to_string(&r).unwrap_or_else(|_| value.into());
        }
    }
    value.into()
}
fn last_day(year: i32, month: u32) -> Option<NaiveDate> {
    (28..=31)
        .rev()
        .find_map(|d| NaiveDate::from_ymd_opt(year, month, d))
}
fn workday(d: NaiveDate) -> bool {
    d.weekday().number_from_monday() <= 5
}
fn month_candidates(r: &Rule, year: i32, month: u32) -> Vec<NaiveDate> {
    if !(1..=9999).contains(&year) {
        return vec![];
    }
    let Some(first) = NaiveDate::from_ymd_opt(year, month, 1) else {
        return vec![];
    };
    let last = last_day(year, month).unwrap();
    match r.month_mode.as_str() {
        "dates" => {
            let mut days: Vec<NaiveDate> = r
                .month_days
                .iter()
                .filter_map(|n| {
                    NaiveDate::from_ymd_opt(
                        year,
                        month,
                        if *n == -1 { last.day() } else { *n as u32 },
                    )
                })
                .filter(|d| !r.skip_weekends || workday(*d))
                .collect();
            days.sort();
            days.dedup();
            days
        }
        "workday" => {
            let mut d = if r.workday == "first" { first } else { last };
            while !workday(d) {
                d = if r.workday == "first" {
                    d.succ_opt().unwrap()
                } else {
                    d.pred_opt().unwrap()
                };
            }
            vec![d]
        }
        "ordinal" => {
            let n = if r.ordinal == -1 {
                last.day() as i32
                    - (last.weekday().number_from_monday() as i32 - r.weekday as i32 + 7) % 7
            } else {
                1 + (r.weekday as i32 - first.weekday().number_from_monday() as i32 + 7) % 7
                    + (r.ordinal - 1) * 7
            };
            NaiveDate::from_ymd_opt(year, month, n as u32)
                .into_iter()
                .collect()
        }
        _ => vec![],
    }
}
pub fn next(prior: DateTime<Utc>, r: &Rule, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
    if r.end == "count" && r.count <= 1 {
        return None;
    }
    let anchor = date(&r.anchor)?;
    let cutoff = if r.basis == "completion" {
        after
    } else {
        prior.max(after)
    };
    let clock = if r.basis == "completion" {
        after
    } else {
        prior
    }
    .with_timezone(&Local)
    .time();
    let accept = |d: NaiveDate| -> Option<DateTime<Utc>> {
        if !(1..=9999).contains(&d.year())
            || (r.basis != "completion" && d < anchor)
            || (r.end == "date" && d > date(r.end_date.as_deref()?)?)
        {
            return None;
        }
        let next = super::schedule::local_time(d.and_time(clock));
        (next > cutoff).then_some(next)
    };
    if r.basis == "completion" {
        let current = after.with_timezone(&Local).date_naive();
        let d = if r.frequency == "day" || r.frequency == "week" {
            current.checked_add_signed(Duration::days(
                r.interval as i64 * if r.frequency == "week" { 7 } else { 1 },
            ))?
        } else {
            let index = current.year() * 12
                + current.month0() as i32
                + r.interval as i32 * if r.frequency == "year" { 12 } else { 1 };
            let (year, month) = (index.div_euclid(12), index.rem_euclid(12) as u32 + 1);
            if year > 9999 {
                return None;
            }
            NaiveDate::from_ymd_opt(year, month, current.day().min(last_day(year, month)?.day()))?
        };
        return accept(d);
    }
    if r.basis == "dates" {
        let mut dates = r.dates.clone();
        dates.sort();
        return dates.iter().filter_map(|s| date(s).and_then(accept)).next();
    }
    let current = cutoff.with_timezone(&Local).date_naive();
    if r.frequency == "month" || r.frequency == "year" {
        let step = r.interval as i32 * if r.frequency == "year" { 12 } else { 1 };
        let mut index = anchor.year() * 12
            + if r.frequency == "year" {
                r.month as i32 - 1
            } else {
                anchor.month0() as i32
            };
        index += ((current.year() * 12 + current.month0() as i32 - index).div_euclid(step)).max(0)
            * step;
        while index.div_euclid(12) <= 9999 {
            if r.end == "date" {
                let end = date(r.end_date.as_deref()?)?;
                if index > end.year() * 12 + end.month0() as i32 {
                    return None;
                }
            }
            for d in month_candidates(r, index.div_euclid(12), index.rem_euclid(12) as u32 + 1) {
                if let Some(next) = accept(d) {
                    return Some(next);
                }
            }
            index += step;
        }
        return None;
    }
    if r.frequency == "day" {
        let steps = ((current - anchor).num_days().div_euclid(r.interval as i64)).max(0);
        let mut d = anchor.checked_add_signed(Duration::days(steps * r.interval as i64))?;
        for _ in 0..2 {
            if let Some(next) = accept(d) {
                return Some(next);
            }
            d = d.checked_add_signed(Duration::days(r.interval as i64))?;
        }
        return None;
    }
    let monday = anchor.checked_sub_signed(Duration::days(
        anchor.weekday().number_from_monday() as i64 - 1,
    ))?;
    let mut d = current.max(anchor);
    for _ in 0..=r.interval * 7 + 7 {
        if (d - monday).num_days().div_euclid(7) % r.interval as i64 == 0
            && r.weekdays.contains(&d.weekday().number_from_monday())
        {
            if let Some(next) = accept(d) {
                return Some(next);
            }
        }
        d = d.succ_opt()?;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{NaiveDateTime, TimeZone};
    #[derive(Deserialize)]
    struct Case {
        name: String,
        prior: String,
        after: String,
        expected: Option<String>,
        rule: Rule,
    }
    fn local(value: &str) -> DateTime<Utc> {
        let d = NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S").unwrap();
        Local
            .from_local_datetime(&d)
            .earliest()
            .unwrap()
            .with_timezone(&Utc)
    }
    #[test]
    fn shared_calendar_cases() {
        let cases: Vec<Case> = serde_json::from_str(include_str!(
            "../../../src/domain/__fixtures__/recurrence.json"
        ))
        .unwrap();
        for case in cases {
            let raw = serde_json::to_string(&case.rule).unwrap();
            let rule = parse(&raw).expect(&case.name);
            assert_eq!(
                next(local(&case.prior), &rule, local(&case.after)),
                case.expected.as_deref().map(local),
                "{}",
                case.name
            );
        }
    }
    #[test]
    fn validates_and_advances_count() {
        let cases: Vec<Case> = serde_json::from_str(include_str!(
            "../../../src/domain/__fixtures__/recurrence.json"
        ))
        .unwrap();
        let mut value = serde_json::to_value(&cases[0].rule).unwrap();
        value["end"] = serde_json::json!("count");
        value["count"] = serde_json::json!(2);
        let raw = value.to_string();
        assert_eq!(parse(&advance(&raw)).unwrap().count, 1);
        for (key, invalid) in [
            ("interval", serde_json::json!(0)),
            ("weekdays", serde_json::json!([])),
            ("monthDays", serde_json::json!([32])),
            ("count", serde_json::json!(0)),
            ("anchor", serde_json::json!("2026-02-30")),
        ] {
            let mut bad = value.clone();
            bad[key] = invalid;
            assert!(parse(&bad.to_string()).is_none(), "{key}");
        }
    }
    #[test]
    fn persists_advanced_rule_and_stops_atomically() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            for migration in [
                include_str!("../../migrations/0001_initial.sql"),
                include_str!("../../migrations/0002_natural_schedule.sql"),
                include_str!("../../migrations/0003_task_priority.sql"),
                include_str!("../../migrations/0004_task_trash.sql"),
                include_str!("../../migrations/0005_journal.sql"),
                include_str!("../../migrations/0006_task_content.sql"),
            ] {
                sqlx::raw_sql(migration).execute(&pool).await.unwrap();
            }
            let cases: Vec<Case> = serde_json::from_str(include_str!(
                "../../../src/domain/__fixtures__/recurrence.json"
            ))
            .unwrap();
            let mut rule = cases[0].rule.clone();
            rule.end = "count".into();
            rule.count = 2;
            let due = local("2026-10-05T09:00:00");
            let now = local("2026-10-05T08:00:00").timestamp_millis();
            let id = super::super::schedule::create(
                &pool,
                super::super::schedule::ScheduledInput {
                    title: "每周一三".into(),
                    list_id: None,
                    notes: "正文".into(),
                    due_at: Some(due.to_rfc3339()),
                    repeat_rule: Some(serde_json::to_string(&rule).unwrap()),
                    remind_at: vec![due.to_rfc3339()],
                    reminder_offsets: vec![0],
                    priority: Some("high".into()),
                },
                now,
            )
            .await
            .unwrap();
            super::super::reminders::update_status(&pool, id, "completed", now)
                .await
                .unwrap();
            let (next_id, next_due, next_rule): (i64, String, String) =
                sqlx::query_as("SELECT id,due_at,repeat_rule FROM tasks WHERE status='todo'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(
                DateTime::parse_from_rfc3339(&next_due)
                    .unwrap()
                    .with_timezone(&Utc),
                local("2026-10-07T09:00:00")
            );
            assert_eq!(parse(&next_rule).unwrap().count, 1);
            let count: i64 = sqlx::query_scalar("SELECT count(*) FROM reminders WHERE task_id=?")
                .bind(next_id)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 1);
            super::super::reminders::update_status(&pool, next_id, "completed", now)
                .await
                .unwrap();
            let count: i64 = sqlx::query_scalar("SELECT count(*) FROM tasks WHERE status='todo'")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 0);
            pool.close().await;
        });
    }
}
