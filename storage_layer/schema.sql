CREATE TABLE IF NOT EXISTS proxy_logs (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  conversation_id TEXT,
  project_name TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  model TEXT,
  stream BOOLEAN NOT NULL DEFAULT false,
  status INT,
  ms INT,
  attempts INT,
  fallback_used TEXT,
  prompt_tokens INT,
  completion_tokens INT,
  bytes INT,
  request_headers JSONB,
  request JSONB,
  response JSONB
);
ALTER TABLE proxy_logs ADD COLUMN IF NOT EXISTS project_name TEXT;
ALTER TABLE proxy_logs ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE proxy_logs ADD COLUMN IF NOT EXISTS est_prompt_tokens INT;
ALTER TABLE proxy_logs ADD COLUMN IF NOT EXISTS est_completion_tokens INT;
ALTER TABLE proxy_logs ADD COLUMN IF NOT EXISTS bookmarked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE proxy_logs ADD COLUMN IF NOT EXISTS bookmark_note TEXT;
ALTER TABLE proxy_logs ADD COLUMN IF NOT EXISTS bookmarked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_proxy_logs_bookmarked ON proxy_logs (bookmarked) WHERE bookmarked;
CREATE INDEX IF NOT EXISTS idx_proxy_logs_created ON proxy_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proxy_logs_model ON proxy_logs (model);
CREATE INDEX IF NOT EXISTS idx_proxy_logs_provider ON proxy_logs (provider);
CREATE INDEX IF NOT EXISTS idx_proxy_logs_conversation ON proxy_logs (conversation_id);
CREATE INDEX IF NOT EXISTS idx_proxy_logs_project ON proxy_logs (project_name);
CREATE TABLE IF NOT EXISTS instructions (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW v_conversations AS
  SELECT conversation_id, min(created_at) AS started_at, max(created_at) AS last_at,
         count(*) AS requests, array_agg(DISTINCT model) AS models,
         array_agg(DISTINCT project_name) AS projects
  FROM proxy_logs WHERE conversation_id IS NOT NULL GROUP BY conversation_id;

-- Orchestration layer tables
CREATE TABLE IF NOT EXISTS orch_models (
  id                        TEXT PRIMARY KEY,
  object                    TEXT,
  owned_by                  TEXT,
  cap_vision                BOOLEAN,
  cap_pdf                   BOOLEAN,
  cap_audio_input           BOOLEAN,
  cap_video_input           BOOLEAN,
  cap_image_output          BOOLEAN,
  cap_audio_output          BOOLEAN,
  cap_search                BOOLEAN,
  cap_tools                 BOOLEAN,
  cap_reasoning             BOOLEAN,
  thinking_format           TEXT,
  thinking_can_disable      BOOLEAN,
  thinking_range            JSONB,
  thinking_effort_supported BOOLEAN,
  context_window            INT,
  max_output                INT,
  context_length            INT,
  max_completion_tokens     INT,
  raw_json                  JSONB NOT NULL,
  available                 BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active                 BOOLEAN NOT NULL DEFAULT FALSE,
  roles                     JSONB NOT NULL DEFAULT '[]'::jsonb,
  tier                      TEXT,
  family                    TEXT,
  priority                  INT NOT NULL DEFAULT 100,
  is_default_worker         BOOLEAN NOT NULL DEFAULT FALSE,
  notes                     TEXT
);
CREATE INDEX IF NOT EXISTS idx_orch_models_active ON orch_models (is_active, available);

CREATE TABLE IF NOT EXISTS orch_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orch_calls (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind            TEXT NOT NULL,
  plan_id         TEXT,
  task_key        TEXT,
  attempt         INT,
  role            TEXT,
  requested_model TEXT,
  routed_model    TEXT,
  applied_model   TEXT,
  rewritten_by    TEXT,
  fallback_reason TEXT,
  mismatch        BOOLEAN NOT NULL DEFAULT FALSE,
  status          INT,
  latency_ms      INT,
  ttfb_ms         INT,
  input_tokens    INT,
  output_tokens   INT,
  error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_orch_calls_plan ON orch_calls (plan_id, task_key);
CREATE INDEX IF NOT EXISTS idx_orch_calls_ts ON orch_calls (ts DESC);

