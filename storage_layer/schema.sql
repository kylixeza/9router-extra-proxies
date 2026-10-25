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
