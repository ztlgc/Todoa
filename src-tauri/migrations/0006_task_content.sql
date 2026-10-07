ALTER TABLE tasks ADD COLUMN content_json TEXT;
ALTER TABLE tasks ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN due_date TEXT CHECK(due_date IS NULL OR (length(due_date)=10 AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'));
CREATE TABLE task_assets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
 data BLOB NOT NULL CHECK(length(data) BETWEEN 1 AND 10485760)
);
CREATE TABLE task_asset_refs (
 task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 asset_id INTEGER NOT NULL REFERENCES task_assets(id) ON DELETE CASCADE,
 PRIMARY KEY(task_id,asset_id)
);
CREATE TRIGGER trg_task_asset_cleanup AFTER DELETE ON task_asset_refs BEGIN
 DELETE FROM task_assets WHERE id=OLD.asset_id AND NOT EXISTS(SELECT 1 FROM task_asset_refs WHERE asset_id=OLD.asset_id);
END;
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
PRAGMA user_version=6;
