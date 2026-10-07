ALTER TABLE tasks ADD COLUMN deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z');
CREATE INDEX idx_tasks_deleted_at ON tasks(deleted_at);
PRAGMA user_version = 4;
