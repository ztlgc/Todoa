use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::RwLock;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub calendar_enabled: bool,
    pub journal_enabled: bool,
    pub notifications_enabled: bool,
    pub show_task_title: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            calendar_enabled: true,
            journal_enabled: true,
            notifications_enabled: true,
            show_task_title: true,
        }
    }
}
impl Preferences {
    pub fn delivery_enabled(&self) -> bool {
        self.notifications_enabled
    }
}
pub struct PreferencesState {
    value: RwLock<Preferences>,
    writer: tokio::sync::Mutex<()>,
}
impl PreferencesState {
    pub async fn load(pool: &SqlitePool) -> Result<Self, &'static str> {
        let raw: Option<String> =
            sqlx::query_scalar("SELECT value FROM settings WHERE key='app_preferences'")
                .fetch_optional(pool)
                .await
                .map_err(|_| "PREFERENCES_READ_FAILED")?;
        let value = raw
            .map(|s| serde_json::from_str::<Preferences>(&s).map_err(|_| "PREFERENCES_INVALID"))
            .transpose()?
            .unwrap_or_default();
        Ok(Self {
            value: RwLock::new(value),
            writer: tokio::sync::Mutex::new(()),
        })
    }
    pub fn snapshot(&self) -> Preferences {
        self.value.read().unwrap_or_else(|e| e.into_inner()).clone()
    }
    pub async fn save(
        &self,
        pool: &SqlitePool,
        input: Preferences,
    ) -> Result<Preferences, &'static str> {
        let _writer = self.writer.lock().await;
        let raw = serde_json::to_string(&input).map_err(|_| "PREFERENCES_INVALID")?;
        sqlx::query("INSERT INTO settings(key,value,updated_at) VALUES('app_preferences',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
            .bind(raw).bind(crate::services::reminders::timestamp(crate::services::reminders::now())).execute(pool).await.map_err(|_|"PREFERENCES_SAVE_FAILED")?;
        *self.value.write().unwrap_or_else(|e| e.into_inner()) = input.clone();
        Ok(input)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_quiet_preferences_are_ignored_and_cannot_pause_notifications() {
        let p: Preferences =
            serde_json::from_str(r#"{"quietEnabled":true,"quietStart":"bad","quietEnd":"bad"}"#)
                .unwrap();
        assert!(p.delivery_enabled());
        assert!(!serde_json::to_string(&p).unwrap().contains("quiet"));
    }
    #[test]
    fn preferences_survive_reload_and_failed_save_keeps_runtime_truth() {
        tauri::async_runtime::block_on(async {
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::raw_sql(include_str!("../migrations/0001_initial.sql"))
                .execute(&pool)
                .await
                .unwrap();
            let state = PreferencesState::load(&pool).await.unwrap();
            let input = Preferences {
                calendar_enabled: false,
                journal_enabled: false,
                notifications_enabled: false,
                show_task_title: false,
                ..Preferences::default()
            };
            state.save(&pool, input.clone()).await.unwrap();
            assert_eq!(
                PreferencesState::load(&pool).await.unwrap().snapshot(),
                input
            );
            sqlx::query("CREATE TRIGGER reject_preferences BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT,'test'); END").execute(&pool).await.unwrap();
            assert!(state.save(&pool, Preferences::default()).await.is_err());
            assert_eq!(state.snapshot(), input);
            pool.close().await;
        });
    }
}
