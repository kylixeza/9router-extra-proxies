'use strict';
// ponytail: single-file dashboard, no deps. Serves UI + JSON API from :20130.
const fs = require('fs');
const pathMod = require('path');
const toolIndex = require('./tool_index');
const { sendJson, readBody } = require('./transport');

async function readJson(req) {
  try {
    const buf = await readBody(req, 1 * 1024 * 1024);
    if (!buf.length) return {};
    return JSON.parse(buf.toString('utf8'));
  } catch (_) { return {}; }
}

function snapshot() {
  return {
    providers: [...toolIndex.providers.values()].map(p => ({
      name: p.name, tools: p.items.size,
      toolNames: [...p.items].sort().slice(0, 200),
      keywords: [...p.keywords].sort(),
    })).sort((a, b) => a.name.localeCompare(b.name)),
    skills: [...toolIndex.skills.values()].map(s => ({
      name: s.name, path: s.path, description: s.description || (toolIndex.descriptionForSkill ? toolIndex.descriptionForSkill(s.name) : ''), keywords: [...s.keywords].sort(),
    })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const dec = s => { try { return decodeURIComponent(s); } catch (_) { return s; } };

async function handleApi(req, res) {
  const u = req.url.split('?')[0];
  if (req.method === 'GET' && (u === '/dashboard' || u === '/dashboard/')) return void sendHtml(res);
  if (req.method === 'GET' && u.startsWith('/dashboard/assets/')) return void sendAsset(res, u.slice('/dashboard/assets/'.length));
  if (!u.startsWith('/api/')) return false;

  if (req.method === 'GET' && u === '/api/index') return void sendJson(res, 200, snapshot());

  if (req.method === 'GET' && u === '/api/instructions') {
    try {
      const mod = require('../storage_layer/instructions');
      const meta = mod.getMeta();
      const t = mod.getTemplateMeta();
      return void sendJson(res, 200, { content: meta.content || '', updatedAt: meta.updatedAt || null, active: meta.active, loaded: meta.loaded, templateUpdatedAt: t.updatedAt || null, hasTemplate: t.hasTemplate, templateLen: (t.content || '').length });
    } catch (e) { return void sendJson(res, 500, { error: e.message }); }
  }

  if (req.method === 'GET' && u === '/api/instructions/template') {
    try {
      const mod = require('../storage_layer/instructions');
      const t = mod.getTemplateMeta();
      return void sendJson(res, 200, { content: t.content || '', updatedAt: t.updatedAt || null, hasTemplate: t.hasTemplate });
    } catch (e) { return void sendJson(res, 500, { error: e.message }); }
  }

  if (req.method === 'POST' && u === '/api/instructions/generate') {
    try {
      const mod = require('../storage_layer/instructions');
      const meta = await mod.generateFromTemplate();
      return void sendJson(res, meta.content ? 200 : 404, meta.content ? { ok: true, content: meta.content || '', updatedAt: meta.updatedAt || null, active: meta.active } : { error: 'no template — run #9r-sync first' });
    } catch (e) { return void sendJson(res, 500, { error: e.message }); }
  }

  if (req.method === 'POST' && u === '/api/instructions') {
    const b = await readJson(req);
    try {
      const mod = require('../storage_layer/instructions');
      const meta = await mod.saveActive(String(b.content || ''));
      return void sendJson(res, 200, { ok: true, content: meta.content || '', updatedAt: meta.updatedAt || null, active: meta.active });
    } catch (e) { return void sendJson(res, 500, { error: e.message }); }
  }

  if (req.method === 'POST' && u === '/api/match') {
    const b = await readJson(req);
    const text = String(b.text || '');
    return void sendJson(res, 200, {
      providers: [...toolIndex.matchedGroupsForPrompt(text)],
      skills: [...toolIndex.matchedSkillsForPrompt(text)],
    });
  }

  // ponytail: dumb pipe to upstream Responses API. Browser supplies key; proxy never stores it.
  if (req.method === 'POST' && u === '/api/ask') {
    const b = await readJson(req);
    const auth = req.headers.authorization;
    if (!auth) return void sendJson(res, 401, { error: 'missing Authorization – set Bearer key first' });
    const text = String(b.input || b.text || '');
    if (!text) return void sendJson(res, 400, { error: 'input required' });
    const payload = JSON.stringify({ model: b.model || 'muse/muse-spark-1.3-contributor', input: text });
    try {
      const { CFG } = require('./config');
      const targetUrl = new URL('/v1/responses', CFG.target);
      const lib = targetUrl.protocol === 'https:' ? require('https') : require('http');
      const upstream = await new Promise((resolve, reject) => {
        const r = lib.request(targetUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), authorization: auth } }, resolve);
        r.on('error', reject);
        r.end(payload);
      });
      const chunks = [];
      const buf = await new Promise((resolve, reject) => {
        upstream.on('data', c => chunks.push(c));
        upstream.on('end', () => resolve(Buffer.concat(chunks)));
        upstream.on('error', reject);
      });
      res.writeHead(upstream.statusCode, { 'content-type': 'application/json' });
      return void res.end(buf);
    } catch (e) {
      return void sendJson(res, 502, { error: 'ask failed: ' + e.message });
    }
  }

  if (req.method === 'POST' && u === '/api/providers') {
    const b = await readJson(req);
    if (!b.name) return void sendJson(res, 400, { error: 'name required' });
    toolIndex.upsertProviderDash(b.name, b.keywords || []);
    return void sendJson(res, 200, { ok: true });
  }
  let m = u.match(/^\/api\/providers\/([^/]+)\/keywords(\/(.+))?$/);
  if (m) {
    const prov = dec(m[1]);
    if (req.method === 'POST') {
      const b = await readJson(req);
      if (!b.keyword) return void sendJson(res, 400, { error: 'keyword required' });
      toolIndex.addProvKw(prov, b.keyword);
      return void sendJson(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && m[3] !== undefined) {
      const ok = toolIndex.delProvKw(prov, dec(m[3]));
      return void sendJson(res, ok ? 200 : 404, { ok });
    }
  }
  m = u.match(/^\/api\/providers\/([^/]+)$/);
  if (m && req.method === 'DELETE') {
    const ok = toolIndex.delProvider(dec(m[1]));
    return void sendJson(res, ok ? 200 : 404, { ok });
  }

  m = u.match(/^\/api\/tools\/(.+)$/);
  if (m && req.method === 'DELETE') {
    const ok = toolIndex.delTool(dec(m[1]));
    return void sendJson(res, ok ? 200 : 404, { ok });
  }
  if (req.method === 'POST' && u === '/api/tools/move') {
    const b = await readJson(req);
    if (!b.tool || !b.to) return void sendJson(res, 400, { error: 'tool + to required' });
    const ok = toolIndex.moveTool(b.tool, String(b.to).toLowerCase());
    return void sendJson(res, ok ? 200 : 404, { ok });
  }

  if (req.method === 'POST' && u === '/api/skills') {
    const b = await readJson(req);
    if (!b.name) return void sendJson(res, 400, { error: 'name required' });
    toolIndex.upsertSkillDash(b.name, b.path, b.keywords || [], b.description);
    return void sendJson(res, 200, { ok: true });
  }
  m = u.match(/^\/api\/skills\/([^/]+)\/keywords(\/(.+))?$/);
  if (m) {
    const sk = dec(m[1]);
    if (req.method === 'POST') {
      const b = await readJson(req);
      if (!b.keyword) return void sendJson(res, 400, { error: 'keyword required' });
      toolIndex.addSkillKw(sk, b.keyword);
      return void sendJson(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && m[3] !== undefined) {
      const ok = toolIndex.delSkillKw(sk, dec(m[3]));
      return void sendJson(res, ok ? 200 : 404, { ok });
    }
  }
  m = u.match(/^\/api\/skills\/([^/]+)$/);
  if (m) {
    const sk = dec(m[1]);
    if (req.method === 'PUT') {
      const b = await readJson(req);
      let ok = true;
      if (b.path !== undefined) ok = toolIndex.setSkillPath(sk, b.path) && ok;
      if (b.description !== undefined) ok = toolIndex.setSkillDescription(sk, b.description) && ok;
      if (b.path === undefined && b.description === undefined) ok = toolIndex.setSkillPath(sk, b.path);
      return void sendJson(res, ok ? 200 : 404, { ok });
    }
    if (req.method === 'DELETE') {
      const ok = toolIndex.delSkill(sk);
      return void sendJson(res, ok ? 200 : 404, { ok });
    }
  }

  return void sendJson(res, 404, { error: 'unknown api' });
}

function sendHtml(res) {
  try {
    const body = fs.readFileSync(pathMod.join(__dirname, 'dashboard', 'valiant.html'));
    res.writeHead(200, { 'content-type': 'text/html', 'content-length': body.length });
    res.end(body);
  } catch (e) {
    sendJson(res, 500, { error: 'dashboard/valiant.html missing: ' + e.message });
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

module.exports = { handleApi };
