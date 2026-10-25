'use strict';
// One-off: node storage_layer/backfill.js — inserts logs/*.json, skips existing ids.
const fs = require('fs');
const pathMod = require('path');
const { logProxyRequest, ensureSchema, close, isEnabled, extractProjectName, query } = require('./index');

function extractConversationId(headers, body) {
  const h = headers || {};
  if (h['x-conversation-id']) return String(h['x-conversation-id']);
  if (h['x-session-id']) return String(h['x-session-id']);
  if (body && typeof body === 'object') {
    if (body.conversation_id) return String(body.conversation_id);
    if (body.session_id) return String(body.session_id);
    if (body.metadata && body.metadata.session_id) return String(body.metadata.session_id);
  }
  return null;
}

async function fillMissingProjects() {
  // Existing rows inserted before project_name existed.
  const res = await query(`SELECT id, request_headers, request FROM proxy_logs WHERE project_name IS NULL LIMIT 500`);
  if (!res) return 0;
  let n = 0;
  for (const row of res.rows) {
    const name = extractProjectName(row.request_headers, row.request);
    if (!name) continue;
    await query(`UPDATE proxy_logs SET project_name = $2 WHERE id = $1`, [row.id, name]);
    n++;
  }
  return n;
}

async function main() {
  if (!isEnabled()) { console.error('[backfill] LOG_TO_PG disabled or no DATABASE_URL'); process.exit(1); }
  await ensureSchema();
  const dir = process.env.LOG_DIR || pathMod.join(__dirname, '..', 'logs');
  const files = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.json')).sort();
  let inserted = 0, skipped = 0, errors = 0;
  for (const f of files) {
    try {
      const j = JSON.parse(await fs.promises.readFile(pathMod.join(dir, f), 'utf8'));
      const meta = j.meta || {};
      if (!meta.id) { errors++; continue; }
      const res = await logProxyRequest({
        id: String(meta.id),
        conversationId: extractConversationId(j.requestHeaders, j.request),
        projectName: extractProjectName(j.requestHeaders, j.request),
        method: meta.method || 'POST',
        path: meta.path || '-',
        model: meta.model || null,
        stream: !!meta.stream,
        status: meta.status ?? null,
        ms: meta.ms ?? null,
        attempts: meta.attempts ?? null,
        fallbackUsed: meta.fallbackUsed || null,
        promptTokens: (meta.usage && meta.usage.prompt) ?? null,
        completionTokens: (meta.usage && meta.usage.completion) ?? null,
        bytes: meta.bytes ?? null,
        requestHeaders: j.requestHeaders || null,
        request: j.request ?? null,
        response: j.response ?? null,
      });
      if (res && res.rowCount === 1) inserted++; else skipped++;
    } catch (err) {
      errors++;
      console.error(`[backfill] ${f}: ${err.message}`);
    }
  }
  console.log(`[backfill] done: inserted=${inserted} skipped=${skipped} errors=${errors} files=${files.length}`);
  const filled = await fillMissingProjects();
  console.log(`[backfill] project_name backfilled: ${filled}`);
  await close();
}

if (require.main === module) main().catch(err => { console.error('[backfill] fatal:', err.message); process.exit(1); });
module.exports = { extractConversationId };
