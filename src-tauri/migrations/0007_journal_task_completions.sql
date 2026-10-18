-- Completion snapshots deliberately have no task FK: deleting a task preserves history.
-- Handwritten journals retain their own revision and can be edited during capture.
CREATE TABLE journal_task_completions (
    id TEXT PRIMARY KEY NOT NULL,
    day TEXT NOT NULL CHECK(length(day)=10),
    task_id INTEGER NOT NULL CHECK(task_id>0),
    task_created_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    theme TEXT NOT NULL DEFAULT '',
    important INTEGER NOT NULL DEFAULT 0 CHECK(important IN (0,1)),
    revoked_at TEXT,
    revoked_day TEXT CHECK(revoked_day IS NULL OR length(revoked_day)=10),
    CHECK((revoked_at IS NULL) = (revoked_day IS NULL)),
    UNIQUE(task_id,task_created_at,completed_at)
);
CREATE INDEX idx_journal_completions_day ON journal_task_completions(day,completed_at);
CREATE INDEX idx_journal_completions_task ON journal_task_completions(task_id,task_created_at);
PRAGMA user_version = 7;
