'use strict';
const fs = require('fs');
const pathMod = require('path');
const { config } = require('./config');

let pool = null;
let warned = false;

function isEnabled() {
  return config.enabled && !!config.databaseUrl;
}

function getPool() {
  if (pool) return pool;
  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch (err) {
    if (!warned) { warned = true; console.error('[storage] pg module missing, run `npm install pg`. PG logging disabled.'); }
    return null;
  }
  pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 });
  pool.on('error', err => console.error('[storage] pool error:', err.message));
  return pool;
}

async function ensureSchema() {
  if (!isEnabled() || !config.automigrate) return;
  const p = getPool();
  if (!p) return;
  try {
    const sql = await fs.promises.readFile(pathMod.join(__dirname, 'schema.sql'), 'utf8');
    await p.query(sql);
    console.log('[storage] schema ensured (proxy_logs + v_conversations)');
  } catch (err) {
    console.error('[storage] ensureSchema failed:', err.message);
  }
}

// Full bodies, no truncation. Never throws to hot path.
function logProxyRequest(r) {
  if (!isEnabled()) return Promise.resolve(false);
  const p = getPool();
  if (!p) return Promise.resolve(false);
  const q = `INSERT INTO proxy_logs
    (id, conversation_id, project_name, method, path, model, stream, status, ms, attempts, fallback_used,
     prompt_tokens, completion_tokens, bytes, request_headers, request, response, provider, est_prompt_tokens, est_completion_tokens)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    ON CONFLICT (id) DO NOTHING`;
  const params = [
    r.id, r.conversationId || null, r.projectName || null, r.method, r.path, r.model || null, !!r.stream,
    r.status ?? null, r.ms ?? null, r.attempts ?? null, r.fallbackUsed || null,
    r.promptTokens ?? null, r.completionTokens ?? null, r.bytes ?? null,
    r.requestHeaders ? JSON.stringify(r.requestHeaders) : null,
    r.request !== undefined ? JSON.stringify(r.request) : null,
    r.response !== undefined ? JSON.stringify(r.response) : null,
    r.provider || null,
    r.estPromptTokens ?? null,
    r.estCompletionTokens ?? null,
  ];
  return p.query(q, params).catch(err => {
    console.error('[storage] insert failed:', err.message);
    return null;
  });
}

async function close() {
  if (pool) {
    try { await pool.end(); } catch (_) {}
    pool = null;
  }
}

function query(text, params) {
  const p = getPool();
  if (!p) return Promise.resolve(null);
  return p.query(text, params).catch(err => {
    console.error('[storage] query failed:', err.message);
    return null;
  });
}

// ponytail: single-row bookmark upsert. Caller validates id/note.
async function setBookmark(id, bookmarked, note) {
  const r = await query(
    `UPDATE proxy_logs SET bookmarked = $2, bookmark_note = $3,
       bookmarked_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1`,
    [id, !!bookmarked, note || null]);
  return r ? r.rowCount : null;
}

module.exports = { isEnabled, ensureSchema, logProxyRequest, close, query, setBookmark };
