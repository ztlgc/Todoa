CREATE TABLE journal_records (
    kind TEXT NOT NULL CHECK(kind IN ('day','week','month','year')),
    period_start TEXT NOT NULL CHECK(length(period_start)=10),
    period_end TEXT NOT NULL CHECK(length(period_end)=10 AND period_end >= period_start),
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    theme TEXT NOT NULL DEFAULT '',
    important INTEGER NOT NULL DEFAULT 0 CHECK(important IN (0,1)),
    items_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(items_json) AND json_type(items_json)='array'),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    PRIMARY KEY(kind,period_start)
);
CREATE INDEX idx_journal_period ON journal_records(period_start,period_end);
PRAGMA user_version = 5;
