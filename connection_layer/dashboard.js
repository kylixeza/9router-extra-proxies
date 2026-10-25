'use strict';
// ponytail: read-only dashboard, no deps. Serves UI + JSON API from :20129.
const fs = require('fs');
const pathMod = require('path');
const state = require('./state');
const { CFG } = require('./config');
const { sendJson, readBody } = require('./utils');

const BOOKMARK_FILE = '.bookmarks.json';
const validId = id => /^[A-Za-z0-9_-]{1,64}$/.test(String(id || ''));

async function readBookmarks() {
  try {
    const raw = await fs.promises.readFile(pathMod.join(CFG.logDir, BOOKMARK_FILE), 'utf8');
    const j = JSON.parse(raw);
    return (j && typeof j === 'object') ? j : {};
  } catch (_) { return {}; }
}

async function writeBookmarks(map) {
  try {
    await fs.promises.mkdir(CFG.logDir, { recursive: true });
    await fs.promises.writeFile(pathMod.join(CFG.logDir, BOOKMARK_FILE), JSON.stringify(map));
  } catch (e) { console.error('[bookmarks] write failed:', e.message); }
}

async function readJsonBody(req) {
  try {
    const buf = await readBody(req, 64 * 1024);
    if (!buf.length) return {};
    return JSON.parse(buf.toString('utf8'));
  } catch (_) { return {}; }
}

async function snapshot() {
  // ponytail: Models table is all-time from PG, not process memory (wiped on restart).
  let models = null;
  let modelsSource = 'memory';
  try {
    const storage = require('../storage_layer');
    if (storage.isEnabled()) {
      const r = await storage.query(`SELECT model, COUNT(*)::int AS requests, COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens, COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens, COALESCE(AVG(ms), 0)::int AS avg_ms FROM proxy_logs WHERE model IS NOT NULL GROUP BY model ORDER BY requests DESC`);
      if (r && r.rows) {
        models = r.rows.map(row => ({
          name: row.model,
          requests: Number(row.requests) || 0,
          promptTokens: Number(row.prompt_tokens) || 0,
          completionTokens: Number(row.completion_tokens) || 0,
          totalMs: 0,
          avgMs: Number(row.avg_ms) || 0,
        }));
        modelsSource = 'pg';
      }
    }
  } catch (_) {}
  if (!models) {
    models = Object.entries(state.stats.models || {})
      .map(([name, m]) => ({
        name,
        requests: m.requests,
        promptTokens: m.promptTokens || 0,
        completionTokens: m.completionTokens || 0,
        totalMs: m.totalMs || 0,
        avgMs: m.requests ? Math.round((m.totalMs || 0) / m.requests) : 0,
      }))
      .sort((a, b) => b.requests - a.requests);
  }
  const mc = state.modelsCache;
  const ageMs = mc ? Date.now() - mc.at : null;
  let modelCount = null;
  if (mc && mc.buf) {
    try {
      const j = JSON.parse(mc.buf.toString('utf8'));
      const d = j.data || j.models || [];
      if (Array.isArray(d)) modelCount = d.length;
    } catch (_) {}
  }
  return {
    health: { ok: true, uptimeSec: Math.round(process.uptime()) },
    stats: {
      startedAt: state.stats.startedAt,
      requests: state.stats.requests,
      byStatus: state.stats.byStatus,
      dedupHits: state.stats.dedupHits,
      coalesced: state.stats.coalesced,
      retries: state.stats.retries,
      fallbacks: state.stats.fallbacks,
      upstreamErrors: state.stats.upstreamErrors,
      clientAborts: state.stats.clientAborts,
      dedupEntries: state.dedupCache.size,
      inflight: state.inflight.size,
    },
    models,
    modelsSource,
    config: {
      target: CFG.target,
      port: CFG.port,
      retries: CFG.retries,
      ttfbMs: CFG.ttfbMs,
      modelsTtlMs: CFG.modelsTtlMs,
      dedupTtlMs: CFG.dedupTtlMs,
      dedupMax: CFG.dedupMax,
      dedupDeterministicOnly: CFG.dedupDeterministicOnly,
      aliases: CFG.aliases,
      fallbacks: CFG.fallbacks,
      defaults: CFG.defaults,
      dropParams: CFG.dropParams,
      logBodies: CFG.logBodies,
      logKeep: CFG.logKeep,
    },
    modelsCache: { cached: !!mc, ageMs, ttlMs: CFG.modelsTtlMs, refreshing: !!state.modelsRefreshing, modelCount },
  };
}

async function listLogs(opts) {
  const o = opts || {};
  const pageSize = Math.min(Math.max(parseInt(o.pageSize || o.limit || '20', 10) || 20, 1), 100);
  const page = Math.max(parseInt(o.page || '1', 10) || 1, 1);
  const q = String(o.q || '').trim().slice(0, 200);
  const project = String(o.project || '').trim().slice(0, 200);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(o.from || '').trim()) ? String(o.from).trim() : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(o.to || '').trim()) ? String(o.to).trim() : '';
  const bookmarkedOnly = /^(1|true|yes|on)$/i.test(String(o.bookmarked || o.starred || ''));
  const offset = (page - 1) * pageSize;
  try {
    const storage = require('../storage_layer');
    if (storage.isEnabled()) {
      const conds = [];
      const params = [];
      if (project) { params.push(project); conds.push(`project_name = $${params.length}`); }
      if (from) { params.push(from); conds.push(`created_at >= $${params.length}::date`); }
      if (to) { params.push(to); conds.push(`created_at < ($${params.length}::date + interval '1 day')`); }
      if (bookmarkedOnly) conds.push(`bookmarked = TRUE`);
      if (q) {
        params.push(`%${q}%`);
        const n = params.length;
        conds.push(`(id ILIKE $${n} OR model ILIKE $${n} OR path ILIKE $${n} OR project_name ILIKE $${n} OR CAST(status AS TEXT) LIKE $${n})`);
      }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const cnt = await storage.query(`SELECT count(*)::int AS total FROM proxy_logs ${where}`, params);
      const total = (cnt && cnt.rows && cnt.rows[0] && cnt.rows[0].total) || 0;
      const r = await storage.query(
        `SELECT id, created_at, conversation_id, project_name, method, path, model, provider, stream,
                status, ms, attempts, fallback_used, prompt_tokens, completion_tokens, est_prompt_tokens, est_completion_tokens, bytes,
                bookmarked, bookmark_note, bookmarked_at
         FROM proxy_logs ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, pageSize, offset]);
      if (r && r.rows) return { source: 'pg', logs: r.rows, page, pageSize, total };
    }
  } catch (_) {}
  // file fallback
  try {
    const { extractProjectName } = require('../storage_layer/project');
    const { parseProviderModel } = require('./utils');
    const [bm, files] = await Promise.all([
      readBookmarks(),
      fs.promises.readdir(CFG.logDir).catch(() => []),
    ]);
    const liveIds = new Set();
    let logs = [];
    for (const f of files.filter(f => f.endsWith('.json') && f !== BOOKMARK_FILE).sort().reverse()) {
      try {
        const st = await fs.promises.stat(pathMod.join(CFG.logDir, f));
        const rec = JSON.parse(await fs.promises.readFile(pathMod.join(CFG.logDir, f), 'utf8'));
        const m = rec.meta || {};
        if (!m.id) continue;
        liveIds.add(m.id);
        let proj = null;
        try { proj = extractProjectName(rec.requestHeaders, rec.request); } catch (_) {}
        const pm = parseProviderModel(m.model);
        const b = bm[m.id];
        logs.push({
          id: m.id, created_at: st.mtime.toISOString(), file: f,
          project_name: proj, method: m.method, path: m.path, model: m.model,
          provider: m.provider || pm.provider,
          stream: !!m.stream,
          status: m.status, ms: m.ms, attempts: m.attempts, fallback_used: m.fallbackUsed || null,
          prompt_tokens: (m.usage && m.usage.prompt) ?? null,
          completion_tokens: (m.usage && m.usage.completion) ?? null,
          est_prompt_tokens: m.estPromptTokens ?? null,
          est_completion_tokens: m.estCompletionTokens ?? null,
          bytes: m.bytes ?? null,
          bookmarked: !!b, bookmark_note: (b && b.note) || null, bookmarked_at: (b && b.created_at) || null,
        });
      } catch (_) {}
    }
    // GC bookmarks for pruned files
    const stale = Object.keys(bm).filter(id => !liveIds.has(id));
    if (stale.length) { for (const id of stale) delete bm[id]; writeBookmarks(bm); }
    const ql = q.toLowerCase();
    if (bookmarkedOnly) logs = logs.filter(l => l.bookmarked);
    if (project) logs = logs.filter(l => (l.project_name || '') === project);
    if (from) logs = logs.filter(l => String(l.created_at || '').slice(0, 10) >= from);
    if (to) logs = logs.filter(l => String(l.created_at || '').slice(0, 10) <= to);
    if (ql) logs = logs.filter(l => (l.id || '').toLowerCase().includes(ql) || (l.model || '').toLowerCase().includes(ql) || (l.path || '').toLowerCase().includes(ql) || (l.project_name || '').toLowerCase().includes(ql) || String(l.status || '').includes(ql));
    const total = logs.length;
    return { source: 'file', logs: logs.slice(offset, offset + pageSize), page, pageSize, total };
  } catch (e) {
    return { source: 'none', logs: [], page, pageSize, total: 0, error: e.message };
  }
}

async function listProjects() {
  try {
    const storage = require('../storage_layer');
    if (storage.isEnabled()) {
      const r = await storage.query(`SELECT DISTINCT project_name FROM proxy_logs WHERE project_name IS NOT NULL AND project_name <> '' ORDER BY project_name LIMIT 100`);
      if (r && r.rows) return { source: 'pg', projects: r.rows.map(x => x.project_name) };
    }
  } catch (_) {}
  try {
    const { extractProjectName } = require('../storage_layer/project');
    const files = (await fs.promises.readdir(CFG.logDir)).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 200);
    const set = new Set();
    for (const f of files) {
      try {
        const rec = JSON.parse(await fs.promises.readFile(pathMod.join(CFG.logDir, f), 'utf8'));
        const p = extractProjectName(rec.requestHeaders, rec.request);
        if (p) set.add(p);
      } catch (_) {}
    }
    return { source: 'file', projects: [...set].sort() };
  } catch (e) {
    return { source: 'none', projects: [] };
  }
}

async function getLog(id) {
  if (!validId(id)) return null;
  try {
    const storage = require('../storage_layer');
    if (storage.isEnabled()) {
      const r = await storage.query(`SELECT * FROM proxy_logs WHERE id = $1`, [id]);
      if (r && r.rows && r.rows[0]) return { source: 'pg', log: r.rows[0] };
    }
  } catch (_) {}
  try {
    const files = (await fs.promises.readdir(CFG.logDir)).filter(f => f.endsWith(`-${id}.json`));
    if (!files.length) return null;
    const rec = JSON.parse(await fs.promises.readFile(pathMod.join(CFG.logDir, files[0]), 'utf8'));
    const bm = await readBookmarks();
    const b = bm[id];
    rec.bookmarked = !!b;
    rec.bookmark_note = (b && b.note) || null;
    rec.bookmarked_at = (b && b.created_at) || null;
    return { source: 'file', log: rec };
  } catch (_) { return null; }
}

async function setBookmark(id, bookmarked, note) {
  if (!validId(id)) return { ok: false, error: 'bad id' };
  const clean = String(note || '').trim().slice(0, 500);
  try {
    const storage = require('../storage_layer');
    if (storage.isEnabled()) {
      const n = await storage.setBookmark(id, bookmarked, clean);
      if (n === null) return { ok: false, error: 'db error' };
      if (n === 0) { /* fall through to file sidecar: PG row may not exist */ }
      else return { ok: true, id, bookmarked: !!bookmarked, note: clean || null, source: 'pg' };
    }
  } catch (_) {}
  // file sidecar; verify log exists first
  try {
    const files = (await fs.promises.readdir(CFG.logDir)).filter(f => f.endsWith(`-${id}.json`));
    if (!files.length) return { ok: false, error: 'not found', status: 404 };
    const bm = await readBookmarks();
    if (bookmarked) bm[id] = { note: clean || null, created_at: (bm[id] && bm[id].created_at) || new Date().toISOString() };
    else delete bm[id];
    await writeBookmarks(bm);
    return { ok: true, id, bookmarked: !!bookmarked, note: clean || null, source: 'file' };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function getUsageAnalytics(opts) {
  const o = opts || {};
  const timeframe = String(o.timeframe || 'all').toLowerCase();
  const project = String(o.project || '').trim();
  let from = /^\d{4}-\d{2}-\d{2}$/.test(String(o.from || '').trim()) ? String(o.from).trim() : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(o.to || '').trim()) ? String(o.to).trim() : '';

  if (!from) {
    const now = new Date();
    if (timeframe === 'today') from = now.toISOString().slice(0, 10);
    else if (timeframe === '7d') {
      const d = new Date(now.getTime() - 7 * 86400000);
      from = d.toISOString().slice(0, 10);
    } else if (timeframe === '30d') {
      const d = new Date(now.getTime() - 30 * 86400000);
      from = d.toISOString().slice(0, 10);
    }
  }

  try {
    const storage = require('../storage_layer');
    if (storage.isEnabled()) {
      const conds = [];
      const params = [];
      if (project) { params.push(project); conds.push(`project_name = $${params.length}`); }
      if (from) { params.push(from); conds.push(`created_at >= $${params.length}::date`); }
      if (to) { params.push(to); conds.push(`created_at < ($${params.length}::date + interval '1 day')`); }
      const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      // Provider breakdown
      const pRes = await storage.query(`
        SELECT COALESCE(provider, split_part(model, '/', 1), 'direct') AS provider,
               COUNT(*)::int AS requests,
               COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
               COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
               COALESCE(SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)), 0)::bigint AS total_tokens,
               COALESCE(SUM(COALESCE(prompt_tokens, est_prompt_tokens, 0) + COALESCE(completion_tokens, est_completion_tokens, 0)), 0)::bigint AS est_total_tokens,
               COALESCE(AVG(ms), 0)::int AS avg_ms,
               COALESCE(
                 CASE WHEN SUM(CASE WHEN completion_tokens > 0 AND ms > 0 THEN ms ELSE 0 END) > 0
                      THEN ROUND(SUM(CASE WHEN completion_tokens > 0 AND ms > 0 THEN completion_tokens ELSE 0 END)::numeric /
                                 (SUM(CASE WHEN completion_tokens > 0 AND ms > 0 THEN ms ELSE 0 END)::numeric / 1000), 1)
                      ELSE 0 END, 0)::float AS tokens_per_sec
        FROM proxy_logs ${where}
        GROUP BY 1 ORDER BY est_total_tokens DESC
      `, params);

      // Model breakdown
      const mRes = await storage.query(`
        SELECT model,
               COALESCE(provider, split_part(model, '/', 1), 'direct') AS provider,
               COUNT(*)::int AS requests,
               COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
               COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
               COALESCE(SUM(COALESCE(prompt_tokens, est_prompt_tokens, 0) + COALESCE(completion_tokens, est_completion_tokens, 0)), 0)::bigint AS est_total_tokens,
               COALESCE(AVG(ms), 0)::int AS avg_ms
        FROM proxy_logs ${where}
        WHERE model IS NOT NULL
        GROUP BY 1, 2 ORDER BY est_total_tokens DESC LIMIT 15
      `, params);

      // Project breakdown
      const prRes = await storage.query(`
        SELECT COALESCE(project_name, '(unknown)') AS project_name,
               COUNT(*)::int AS requests,
               COALESCE(SUM(COALESCE(prompt_tokens, est_prompt_tokens, 0) + COALESCE(completion_tokens, est_completion_tokens, 0)), 0)::bigint AS est_total_tokens,
               COALESCE(AVG(ms), 0)::int AS avg_ms
        FROM proxy_logs ${where}
        GROUP BY 1 ORDER BY est_total_tokens DESC LIMIT 15
      `, params);

      // Daily runaway meter: check tokens consumed in last 24h per project
      const runRes = await storage.query(`
        SELECT COALESCE(project_name, '(unknown)') AS project_name,
               COUNT(*)::int AS requests,
               COALESCE(SUM(COALESCE(prompt_tokens, est_prompt_tokens, 0) + COALESCE(completion_tokens, est_completion_tokens, 0)), 0)::bigint AS tokens_24h
        FROM proxy_logs WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY 1 ORDER BY tokens_24h DESC LIMIT 10
      `);

      return {
        source: 'pg',
        timeframe,
        from, to,
        providers: pRes ? pRes.rows : [],
        models: mRes ? mRes.rows : [],
        projects: prRes ? prRes.rows : [],
        runaway24h: runRes ? runRes.rows : [],
      };
    }
  } catch (_) {}

  // In-memory fallback
  return {
    source: 'none',
    timeframe,
    providers: [],
    models: [],
    projects: [],
    runaway24h: [],
  };
}

async function handleApi(req, res) {
  const u = req.url.split('?')[0];
  if (req.method === 'GET' && (u === '/dashboard' || u === '/dashboard/')) return void sendHtml(res);
  if (req.method === 'GET' && u.startsWith('/dashboard/assets/')) return void sendAsset(res, u.slice('/dashboard/assets/'.length));
  if (!u.startsWith('/api/')) return false;

  if (req.method === 'GET' && u === '/api/conn/index') return void sendJson(res, 200, await snapshot());

  if (req.method === 'GET' && u === '/api/conn/usage') {
    const q = new URL(req.url, 'http://x').searchParams;
    return void sendJson(res, 200, await getUsageAnalytics({ timeframe: q.get('timeframe'), project: q.get('project'), from: q.get('from'), to: q.get('to') }));
  }
  if (req.method === 'GET' && u === '/api/conn/logs') {
    const q = new URL(req.url, 'http://x').searchParams;
    return void sendJson(res, 200, await listLogs({ page: q.get('page'), pageSize: q.get('pageSize') || q.get('limit'), q: q.get('q'), project: q.get('project'), from: q.get('from'), to: q.get('to'), bookmarked: q.get('bookmarked') || q.get('starred') }));
  }
  if (req.method === 'GET' && u === '/api/conn/projects') {
    return void sendJson(res, 200, await listProjects());
  }
  const mb = u.match(/^\/api\/conn\/logs\/([^/]+)\/bookmark$/);
  if (mb) {
    const id = decodeURIComponent(mb[1]);
    if (req.method === 'POST') {
      const b = await readJsonBody(req);
      const r = await setBookmark(id, !!b.bookmarked, b.note);
      if (!r.ok) return void sendJson(res, r.status || (r.error === 'not found' ? 404 : 400), { error: r.error || 'bookmark failed' });
      return void sendJson(res, 200, r);
    }
    if (req.method === 'DELETE') {
      const r = await setBookmark(id, false, '');
      if (!r.ok) return void sendJson(res, r.status || (r.error === 'not found' ? 404 : 400), { error: r.error || 'bookmark failed' });
      return void sendJson(res, 200, r);
    }
  }
  const m = u.match(/^\/api\/conn\/logs\/([^/]+)$/);
  if (req.method === 'GET' && m) {
    const found = await getLog(decodeURIComponent(m[1]));
    if (!found) return void sendJson(res, 404, { error: 'not found' });
    return void sendJson(res, 200, found);
  }
  return void sendJson(res, 404, { error: 'unknown api' });
}

function sendHtml(res) {
  try {
    const body = fs.readFileSync(pathMod.join(__dirname, 'dashboard', 'leon.html'));
    res.writeHead(200, { 'content-type': 'text/html', 'content-length': body.length });
    res.end(body);
  } catch (e) {
    sendJson(res, 500, { error: 'dashboard/leon.html missing: ' + e.message });
  }
}

const ASSET_TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml' };
function sendAsset(res, rel) {
  try {
    const base = pathMod.join(__dirname, 'dashboard');
    const p = pathMod.normalize(pathMod.join(base, rel));
    if (!p.startsWith(base + pathMod.sep) && p !== base) return void sendJson(res, 403, { error: 'forbidden' });
    const body = fs.readFileSync(p);
    const ct = ASSET_TYPES[pathMod.extname(p).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': ct, 'content-length': body.length });
    res.end(body);
  } catch (e) {
    sendJson(res, 404, { error: 'asset missing' });
  }
}

module.exports = { handleApi, snapshot };
