-- Snapshots intentionally have no source FK: deleting a source preserves review text.
CREATE TABLE journal_highlights (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id) BETWEEN 1 AND 100),
 date TEXT NOT NULL CHECK(length(date)=10),
 summary TEXT NOT NULL CHECK(length(trim(summary)) BETWEEN 1 AND 20000),
 result TEXT NOT NULL DEFAULT '' CHECK(length(result)<=20000),
 theme TEXT NOT NULL DEFAULT '' CHECK(length(theme)<=100),
 source_type TEXT NOT NULL CHECK(source_type IN ('note','task','legacy')),
 source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 100),
 source_revision INTEGER NOT NULL CHECK(source_revision>=0),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_journal_highlights_date ON journal_highlights(date,deleted_at);
CREATE UNIQUE INDEX idx_journal_highlights_task ON journal_highlights(source_id) WHERE source_type='task' AND deleted_at IS NULL;
CREATE TABLE journal_review_sources (
 review_kind TEXT NOT NULL CHECK(review_kind IN ('month','year')),
 review_start TEXT NOT NULL,
 source_type TEXT NOT NULL CHECK(source_type IN ('highlight','month')),
 source_id TEXT NOT NULL,
 snapshot TEXT NOT NULL,
 source_revision INTEGER NOT NULL CHECK(source_revision>=0),
 highlight_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(highlight_ids) AND json_type(highlight_ids)='array'),
 created_at TEXT NOT NULL,
 PRIMARY KEY(review_kind,review_start,source_type,source_id),
 FOREIGN KEY(review_kind,review_start) REFERENCES journal_records(kind,period_start)
);
CREATE INDEX idx_journal_review_sources_origin ON journal_review_sources(source_type,source_id);
PRAGMA user_version = 9;
