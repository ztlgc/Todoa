CREATE TABLE task_recurrence_progress (
 task_id INTEGER PRIMARY KEY NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 processed_at TEXT NOT NULL
);
INSERT INTO task_recurrence_progress(task_id, processed_at)
 SELECT id, completed_at FROM tasks WHERE status='completed' AND repeat_rule IS NOT NULL;
PRAGMA user_version = 10;
