'use strict';
// One-off: node storage_layer/backfill.js — inserts logs/*.json, backfills missing projects & conversations.
const fs = require('fs');
const pathMod = require('path');
const { logProxyRequest, ensureSchema, close, isEnabled, extractProjectName, extractConversationId, query } = require('./index');

async function fillMissingProjects() {
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

async function fillMissingConversations(batchSize = 200) {
  let total = 0;
  let afterId = '';
  for (;;) {
    const res = await query(
      `SELECT id, request_headers, request
       FROM proxy_logs
       WHERE conversation_id IS NULL
         AND path IN ('/v1/responses', '/v1/chat/completions')
         AND id > $1
       ORDER BY id ASC
       LIMIT $2`,
      [afterId, batchSize]
    );
    if (!res || !res.rows.length) break;
    afterId = res.rows[res.rows.length - 1].id;
    const ids = [];
    const convs = [];
    for (const row of res.rows) {
      const convId = extractConversationId(row.request_headers, row.request);
      if (!convId) continue;
      ids.push(row.id);
      convs.push(convId);
    }
    if (ids.length) {
      await query(
        `UPDATE proxy_logs AS p
         SET conversation_id = v.conv_id
         FROM unnest($1::text[], $2::text[]) AS v(id, conv_id)
         WHERE p.id = v.id`,
        [ids, convs]
      );
      total += ids.length;
    }
    if (res.rows.length < batchSize) break;
  }
  return total;
}

async function main() {
  if (!isEnabled()) { console.error('[backfill] LOG_TO_PG disabled or no DATABASE_URL'); process.exit(1); }
  await ensureSchema();
  const dir = process.env.LOG_DIR || pathMod.join(__dirname, '..', 'logs');
  const files = (await fs.promises.readdir(dir).catch(() => [])).filter(f => f.endsWith('.json')).sort();
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
  const filledProj = await fillMissingProjects();
  console.log(`[backfill] project_name backfilled: ${filledProj}`);
  const filledConv = await fillMissingConversations();
  console.log(`[backfill] conversation_id backfilled: ${filledConv}`);
  await close();
}

if (require.main === module) main().catch(err => { console.error('[backfill] fatal:', err.message); process.exit(1); });
module.exports = { extractConversationId, fillMissingProjects, fillMissingConversations };
