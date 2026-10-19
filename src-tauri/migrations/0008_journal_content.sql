ALTER TABLE journal_records ADD COLUMN content_json TEXT CHECK(content_json IS NULL OR (json_valid(content_json) AND json_type(content_json)='object'));
ALTER TABLE journal_records ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0 CHECK(content_revision>=0);
CREATE TABLE journal_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    period_start TEXT NOT NULL,
    mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
    data BLOB NOT NULL CHECK(length(data) BETWEEN 1 AND 10485760),
    FOREIGN KEY(kind,period_start) REFERENCES journal_records(kind,period_start) ON DELETE CASCADE
);
CREATE INDEX idx_journal_assets_owner ON journal_assets(kind,period_start);
PRAGMA user_version=8;
