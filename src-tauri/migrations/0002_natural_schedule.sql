ALTER TABLE tasks ADD COLUMN repeat_rule TEXT;
ALTER TABLE tasks ADD COLUMN reminder_offsets TEXT NOT NULL DEFAULT '[]';
ALTER TABLE reminders ADD COLUMN generated INTEGER NOT NULL DEFAULT 0 CHECK (generated IN (0, 1));
PRAGMA user_version = 2;
