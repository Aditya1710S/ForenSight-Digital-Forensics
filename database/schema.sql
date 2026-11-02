-- ForenSight schema (SQLite). Timestamps are UTC ISO-8601 strings.
CREATE TABLE IF NOT EXISTS cases (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  investigator TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('Open','In Progress','Closed')),
  priority     TEXT NOT NULL CHECK (priority IN ('Low','Medium','High','Critical')),
  is_demo      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_created ON cases(created_at);

CREATE TABLE IF NOT EXISTS evidence (
  id                TEXT PRIMARY KEY,
  case_id           TEXT NOT NULL REFERENCES cases(id),
  original_filename TEXT NOT NULL,
  stored_filename   TEXT NOT NULL UNIQUE,
  category          TEXT NOT NULL CHECK (category IN ('image','video')),
  mime_type         TEXT NOT NULL,
  detected_format   TEXT NOT NULL,
  declared_ext      TEXT,
  format_mismatch   INTEGER NOT NULL DEFAULT 0,
  size_bytes        INTEGER NOT NULL,
  sha256            TEXT NOT NULL,
  notes             TEXT NOT NULL DEFAULT '',
  is_demo           INTEGER NOT NULL DEFAULT 0,
  uploaded_by       TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  deleted_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence(case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_category ON evidence(category);
CREATE INDEX IF NOT EXISTS idx_evidence_sha ON evidence(sha256);

CREATE TABLE IF NOT EXISTS analysis_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_id   TEXT NOT NULL REFERENCES evidence(id),
  analysis_type TEXT NOT NULL CHECK (analysis_type IN ('image','video')),
  status        TEXT NOT NULL,
  result_json   TEXT NOT NULL,
  analyzed_by   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analysis_evidence ON analysis_results(evidence_id);

CREATE TABLE IF NOT EXISTS derived_artifacts (
  id              TEXT PRIMARY KEY,
  evidence_id     TEXT NOT NULL REFERENCES evidence(id),
  kind            TEXT NOT NULL,
  stored_filename TEXT NOT NULL UNIQUE,
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  params_json     TEXT NOT NULL DEFAULT '{}',
  created_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_evidence ON derived_artifacts(evidence_id);

CREATE TABLE IF NOT EXISTS integrity_verifications (
  id                        TEXT PRIMARY KEY,
  evidence_id               TEXT NOT NULL REFERENCES evidence(id),
  status                    TEXT NOT NULL CHECK (status IN ('MATCH','MISMATCH','ERROR')),
  expected_hash             TEXT NOT NULL,
  calculated_hash           TEXT,
  provided_hash             TEXT,
  provided_matches_recorded INTEGER,
  error_message             TEXT,
  verified_by               TEXT NOT NULL,
  verified_at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verif_evidence ON integrity_verifications(evidence_id);

CREATE TABLE IF NOT EXISTS audit_events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT NOT NULL UNIQUE,
  case_id     TEXT REFERENCES cases(id),
  evidence_id TEXT REFERENCES evidence(id),
  event_type  TEXT NOT NULL,
  timestamp   TEXT NOT NULL,
  actor       TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'success',
  prev_hash   TEXT NOT NULL,
  event_hash  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_case ON audit_events(case_id);
CREATE INDEX IF NOT EXISTS idx_audit_evidence ON audit_events(evidence_id);
CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events(event_type);

-- Append-only enforcement at the database level.
CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

CREATE TABLE IF NOT EXISTS application_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
