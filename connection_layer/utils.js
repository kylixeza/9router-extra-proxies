'use strict';
const crypto = require('crypto');
const fs = require('fs');
const pathMod = require('path');
const { CFG, transport, agent } = require('./config');
const state = require('./state');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function sendJson(res, status, obj) {
  if (res.writableEnded || res.destroyed) return;
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length });
  res.end(body);
}

function sendBuffered(res, status, headers, buf, extra = {}) {
  if (res.writableEnded || res.destroyed) return;
  const h = { ...headers, ...extra };
  delete h['transfer-encoding'];
  delete h['connection'];
  delete h['content-length'];
  h['content-length'] = buf.length;
  res.writeHead(status, h);
  res.end(buf);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0, tooBig = false;
    req.on('data', c => { n += c.length; if (n > limit) { tooBig = true; return; } chunks.push(c); });
    req.on('end', () => tooBig ? reject(Object.assign(new Error('request body too large'), { status: 413 })) : resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    stream.on('aborted', () => reject(new Error('upstream aborted')));
  });
}

function callUpstream(url, opts, payload, onReq) {
  return new Promise((resolve, reject) => {
    const r = transport.request(url, { ...opts, agent }, resolve);
    const timer = setTimeout(() => r.destroy(new Error(`upstream timeout after ${CFG.ttfbMs}ms`)), CFG.ttfbMs);
    r.once('response', () => clearTimeout(timer));
    r.once('close', () => clearTimeout(timer));
    r.on('error', e => { clearTimeout(timer); reject(e); });
    if (onReq) onReq(r);
    r.end(payload || undefined);
  });
}

function upstreamHeaders(req, payload) {
  const h = { ...req.headers };
  delete h.host; delete h.connection; delete h['keep-alive']; delete h['transfer-encoding'];
  for (const k of Object.keys(h)) {
    if (k.toLowerCase().startsWith('x-orch-')) delete h[k];
  }
  h['accept-encoding'] = 'identity';
  if (payload && payload.length) h['content-length'] = payload.length; else delete h['content-length'];
  return h;
}

function retryDelay(res, attempt) {
  const ra = res && parseFloat(res.headers['retry-after']);
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, 10000);
  return Math.min(250 * 2 ** attempt + Math.random() * 150, 4000);
}

function dedupKey(req, p, payload) {
  return crypto.createHash('sha256')
    .update(req.headers.authorization || '').update('\0')
    .update(req.headers['x-orch-model'] || '').update('\0')
    .update(p).update('\0').update(payload).digest('hex');
}

function pruneDedup() {
  const now = Date.now();
  for (const [k, v] of state.dedupCache) if (now - v.at > CFG.dedupTtlMs) state.dedupCache.delete(k);
  while (state.dedupCache.size > CFG.dedupMax) state.dedupCache.delete(state.dedupCache.keys().next().value);
}

function prepareModelAndParams(body) {
  if (typeof body.model === 'string' && CFG.aliases[body.model]) {
    body.model = CFG.aliases[body.model];
  }
  const defaults = { ...(CFG.defaults['*'] || {}), ...(CFG.defaults[body.model] || {}) };
  for (const [k, v] of Object.entries(defaults)) {
    if (body[k] === undefined) body[k] = v;
  }
  for (const k of [...(CFG.dropParams['*'] || []), ...(CFG.dropParams[body.model] || [])]) {
    delete body[k];
  }
  return { model: body.model, stream: body.stream === true };
}

function parseProviderModel(rawModel) {
  if (!rawModel || typeof rawModel !== 'string') return { provider: 'direct', model: '' };
  const idx = rawModel.indexOf('/');
  if (idx > 0) {
    return { provider: rawModel.slice(0, idx), model: rawModel.slice(idx + 1) };
  }
  return { provider: 'direct', model: rawModel };
}

function estimateRequestTokens(bodyObj, rawModel) {
  if (!bodyObj) return 0;
  const pm = parseProviderModel(rawModel);
  // Empirically calibrated: kr (claude) ~2.2, muse/ms ~4.2, default ~3.6 chars/token
  const cpt = (pm.provider === 'kr' || /claude/i.test(rawModel || '')) ? 2.2
    : (pm.provider === 'ms' || pm.provider === 'muse' || /muse/i.test(rawModel || '')) ? 4.2
    : 3.6;
  let chars = 0;
  const scan = v => {
    if (typeof v === 'string') chars += v.length;
    else if (Array.isArray(v)) for (const el of v) scan(el);
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) scan(v[k]);
  };
  scan(bodyObj.messages || bodyObj.input || bodyObj.prompt || bodyObj);
  return Math.ceil(chars / cpt);
}

function usageFromJson(j) {
  if (!j || typeof j !== 'object') return null;
  const u = j.usage || (j.response && j.response.usage);
  if (!u) return null;
  return { prompt: u.prompt_tokens ?? u.input_tokens ?? 0, completion: u.completion_tokens ?? u.output_tokens ?? 0 };
}

function usageFromSseTail(tail) {
  const lines = tail.split('\n').reverse();
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      const u = usageFromJson(parsed);
      if (u) return u;
    } catch (_) {}
  }
  return null;
}

function recordStats(meta, status, ms, usage) {
  state.stats.requests++;
  state.stats.byStatus[status] = (state.stats.byStatus[status] || 0) + 1;
  if (meta.model) {
    const m = state.stats.models[meta.model] || (state.stats.models[meta.model] = { requests: 0, promptTokens: 0, completionTokens: 0, totalMs: 0 });
    m.requests++; m.totalMs += ms;
    if (usage) { m.promptTokens += usage.prompt; m.completionTokens += usage.completion; }
  }
}

const SECRET_RE = /(sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/-]{16,})/g;
const redact = s => s.replace(SECRET_RE, '[redacted]');

function writeLog(meta, headers, payload, respText) {
  (async () => {
    try {
      const safeHeaders = { ...headers };
      for (const k of ['authorization', 'x-api-key', 'cookie', 'proxy-authorization']) if (safeHeaders[k]) safeHeaders[k] = '[redacted]';
      let reqBody = null;
      if (payload && payload.length) {
        const s = payload.toString('utf8');
        try { reqBody = JSON.parse(redact(s)); } catch (_) { reqBody = redact(s); }
      }
      let resBody = respText;
      try { resBody = JSON.parse(respText); } catch (_) {}
      if (typeof resBody === 'string') resBody = redact(resBody);

      // Dedicated layer: Postgres first, files as fallback.
      // ponytail: full bodies, no truncation.
      try {
        const storage = require('../storage_layer');
        if (storage.isEnabled()) {
          const h = safeHeaders;
          let conversationId = null;
          if (h['x-conversation-id']) conversationId = String(h['x-conversation-id']);
          else if (h['x-session-id']) conversationId = String(h['x-session-id']);
          else if (reqBody && typeof reqBody === 'object') {
            conversationId = reqBody.conversation_id || reqBody.session_id
              || (reqBody.metadata && reqBody.metadata.session_id) || null;
            if (conversationId) conversationId = String(conversationId);
          }
          await storage.logProxyRequest({
            id: String(meta.id),
            conversationId,
            projectName: storage.extractProjectName(safeHeaders, reqBody),
            method: meta.method,
            path: meta.path,
            model: meta.model || null,
            stream: !!meta.stream,
            status: meta.status ?? null,
            ms: meta.ms ?? null,
            attempts: meta.attempts ?? null,
            fallbackUsed: meta.fallbackUsed || null,
            promptTokens: (meta.usage && meta.usage.prompt) ?? null,
            completionTokens: (meta.usage && meta.usage.completion) ?? null,
            bytes: meta.bytes ?? null,
            requestHeaders: safeHeaders,
            request: reqBody,
            response: resBody,
            provider: meta.provider || (meta.model ? parseProviderModel(meta.model).provider : null),
            estPromptTokens: meta.estPromptTokens ?? null,
            estCompletionTokens: meta.estCompletionTokens ?? null,
          });
          if (!CFG.logBodies) return;
        }
      } catch (err) {
        console.error('[storage] write failed, falling back to file:', err.message);
      }

      if (!CFG.logBodies) return;
      await fs.promises.mkdir(CFG.logDir, { recursive: true });
      const file = pathMod.join(CFG.logDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${meta.id}.json`);
      const record = { meta, requestHeaders: safeHeaders, request: reqBody, response: resBody };
      await fs.promises.writeFile(file, JSON.stringify(record, null, 2));
      const files = (await fs.promises.readdir(CFG.logDir)).filter(f => f.endsWith('.json')).sort();
      for (const f of files.slice(0, Math.max(0, files.length - CFG.logKeep))) await fs.promises.unlink(pathMod.join(CFG.logDir, f)).catch(() => {});
    } catch (err) {
      console.error('[log error]', err.message);
    }
  })();
}

function summaryLine(meta, status, ms, usage) {
  let u = '';
  if (usage) {
    u = ` tokens=${usage.prompt}/${usage.completion}`;
    if (meta.estPromptTokens) u += ` [est ~${Math.round(meta.estPromptTokens / 1000 * 10) / 10}k]`;
  } else if (meta.estPromptTokens) {
    u = ` tokens=~${Math.round(meta.estPromptTokens / 1000 * 10) / 10}k (est)`;
  }
  const prov = meta.provider ? ` provider=${meta.provider}` : '';
  console.log(`[req ${meta.id}] ${meta.method} ${meta.path}${prov} model=${meta.model || '-'} stream=${meta.stream} -> ${status} ${ms}ms attempts=${meta.attempts}${meta.fallbackUsed ? ` fallback=${meta.fallbackUsed}` : ''}${u}`);
}

module.exports = { sleep, sendJson, sendBuffered, readBody, collect, callUpstream, upstreamHeaders, retryDelay, dedupKey, pruneDedup, prepareModelAndParams, parseProviderModel, estimateRequestTokens, usageFromJson, usageFromSseTail, recordStats, redact, writeLog, summaryLine };
