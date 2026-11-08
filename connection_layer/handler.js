'use strict';
const crypto = require('crypto');
const { CFG, RETRYABLE } = require('./config');
const state = require('./state');
const { sleep, sendJson, sendBuffered, readBody, collect, callUpstream, upstreamHeaders, retryDelay, dedupKey, pruneDedup, prepareModelAndParams, parseProviderModel, estimateRequestTokens, usageFromJson, usageFromSseTail, recordStats, writeLog, summaryLine } = require('./utils');
const { handleModels } = require('./models');

async function handle(req, res) {
  const id = crypto.randomBytes(5).toString('hex');
  const started = Date.now();
  const p = req.url.split('?')[0];
  res.setHeader('x-request-id', id);

  if (p === '/dashboard' || p === '/dashboard/' || p.startsWith('/dashboard/assets/') || p.startsWith('/api/conn/')) {
    try { const { handleApi } = require('./dashboard'); await handleApi(req, res); } catch (e) { return sendJson(res, 500, { error: e.message }); }
    return;
  }
  if (p === '/health') return sendJson(res, 200, { ok: true, uptimeSec: Math.round(process.uptime()) });
  if (p === '/stats') return sendJson(res, 200, { ...state.stats, dedupEntries: state.dedupCache.size, inflight: state.inflight.size });

  let raw;
  try { raw = await readBody(req, CFG.maxBodyBytes); }
  catch (err) { return sendJson(res, err.status || 400, { error: { message: err.message, type: 'proxy_error' } }); }

  if (req.method === 'GET' && p === '/v1/models') return handleModels(req, res);

  const isJsonPost = req.method === 'POST' && (req.headers['content-type'] || '').includes('application/json');
  let bodyObj = null;
  if (isJsonPost && raw.length) { try { bodyObj = JSON.parse(raw.toString('utf8')); } catch (_) {} }

  const forcedOrchModel = typeof req.headers['x-orch-model'] === 'string' ? req.headers['x-orch-model'].trim() : '';
  let appliedOrch = null;

  const meta = { id, method: req.method, path: p, model: null, provider: null, stream: false, attempts: 0, fallbackUsed: null, estPromptTokens: null, estCompletionTokens: null };
  if (bodyObj && typeof bodyObj === 'object' && !Array.isArray(bodyObj)) {
    const rawModelBeforePrep = bodyObj.model;
    const info = prepareModelAndParams(bodyObj);
    let finalModel = info.model;
    if (forcedOrchModel) {
      if (bodyObj.model !== forcedOrchModel) bodyObj.model = forcedOrchModel;
      finalModel = forcedOrchModel;
      appliedOrch = {
        model: forcedOrchModel,
        by: rawModelBeforePrep === forcedOrchModel ? 'orchestration' : 'connection',
      };
    }
    meta.model = finalModel;
    meta.stream = info.stream;
    const pm = parseProviderModel(finalModel);
    meta.provider = pm.provider;
    meta.estPromptTokens = estimateRequestTokens(bodyObj, finalModel);
  } else {
    bodyObj = null;
  }
  let payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : raw;

  const orchResHeaders = appliedOrch ? {
    'x-orch-applied-model': appliedOrch.model,
    'x-orch-rewritten-by': appliedOrch.by,
  } : null;

  let clientGone = false;
  let currentReq = null;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true; state.stats.clientAborts++;
      if (currentReq) currentReq.destroy();
    }
  });

  const cacheable = !!bodyObj && !meta.stream && CFG.dedupTtlMs > 0 && !req.headers['x-no-cache']
    && !(CFG.dedupDeterministicOnly && (bodyObj.temperature ?? 1) > 0);
  let key = null;
  let release = () => {};
  if (cacheable) {
    key = dedupKey(req, p, payload);
    const hit = state.dedupCache.get(key);
    if (hit && Date.now() - hit.at < CFG.dedupTtlMs) {
      state.stats.dedupHits++;
      return sendBuffered(res, hit.status, hit.headers, hit.body, { 'x-cache': 'dedup', ...(orchResHeaders || {}) });
    }
    const pending = state.inflight.get(key);
    if (pending) {
      const entry = await pending;
      if (entry) {
        state.stats.coalesced++;
        return sendBuffered(res, entry.status, entry.headers, entry.body, { 'x-cache': 'coalesced', ...(orchResHeaders || {}) });
      }
    } else {
      let done;
      const pr = new Promise(r => { done = r; });
      state.inflight.set(key, pr);
      release = entry => { if (state.inflight.get(key) === pr) state.inflight.delete(key); done(entry || null); };
    }
  }

  try {
    const chain = forcedOrchModel
      ? [forcedOrchModel]
      : [bodyObj ? bodyObj.model : undefined, ...(bodyObj ? (CFG.fallbacks[bodyObj.model] || []) : [])];
    const upstreamUrl = new URL(req.url, CFG.target);
    let upstreamRes = null, lastErr = null;

    outer:
    for (let ci = 0; ci < chain.length; ci++) {
      if (ci > 0) {
        bodyObj.model = chain[ci];
        payload = Buffer.from(JSON.stringify(bodyObj), 'utf8');
        meta.fallbackUsed = chain[ci];
        state.stats.fallbacks++;
      }
      const tries = ci === 0 ? CFG.retries + 1 : 1;
      for (let t = 0; t < tries; t++) {
        if (clientGone) break outer;
        meta.attempts++;
        const lastAttempt = ci === chain.length - 1 && t === tries - 1;
        try {
          const r = await callUpstream(upstreamUrl, { method: req.method, headers: upstreamHeaders(req, payload) }, payload, q => { currentReq = q; });
          if (RETRYABLE.has(r.statusCode) && !lastAttempt) {
            r.resume();
            state.stats.retries++;
            if (t < tries - 1) await sleep(retryDelay(r, t));
            continue;
          }
          upstreamRes = r;
          break outer;
        } catch (err) {
          lastErr = err;
          if (clientGone) break outer;
          if (!lastAttempt) { state.stats.retries++; if (t < tries - 1) await sleep(retryDelay(null, t)); }
        }
      }
    }

    if (!upstreamRes) {
      state.stats.upstreamErrors++;
      const ms = Date.now() - started;
      sendJson(res, 502, { error: { message: (lastErr && lastErr.message) || 'upstream unavailable', type: 'proxy_error' } });
      recordStats(meta, clientGone ? 499 : 502, ms, null);
      summaryLine(meta, clientGone ? 499 : 502, ms, null);
      writeLog({ ...meta, status: 502, ms }, req.headers, payload, JSON.stringify({ error: lastErr && lastErr.message }));
      return;
    }

    const status = upstreamRes.statusCode;
    const rh = { ...upstreamRes.headers, ...(orchResHeaders || {}) };
    const ct = String(rh['content-type'] || '');
    const isSSE = ct.includes('text/event-stream');
    const buffered = !meta.stream && !isSSE && /json/.test(ct);

    if (buffered) {
      const buf = await collect(upstreamRes);
      const ms = Date.now() - started;

      let usage = null;
      try { usage = usageFromJson(JSON.parse(buf.toString('utf8'))); } catch (_) {}

      const out = { ...rh };
      delete out['transfer-encoding']; delete out['content-length']; delete out['connection'];
      out['content-length'] = buf.length;

      if (cacheable && status === 200) {
        const entry = { at: Date.now(), status, headers: out, body: buf };
        state.dedupCache.set(key, entry);
        pruneDedup();
        release(entry);
      }
      sendBuffered(res, status, out, buf);
      recordStats(meta, status, ms, usage);
      summaryLine(meta, status, ms, usage);
      writeLog({ ...meta, status, ms, usage }, req.headers, payload, buf.toString('utf8'));
      return;
    }

    const HEAD_CAP = 24 * 1024, TAIL_CAP = 24 * 1024;
    let head = '', tail = '', total = 0;
    res.writeHead(status, rh);
    if (res.flushHeaders) res.flushHeaders();
    if (res.socket) res.socket.setNoDelay(true);

    upstreamRes.on('data', c => {
      total += c.length;
      const s = c.toString('utf8');
      if (head.length < HEAD_CAP) head += s;
      tail = (tail + s).slice(-TAIL_CAP);
    });
    upstreamRes.on('error', () => res.destroy());
    upstreamRes.on('aborted', () => res.destroy());
    upstreamRes.on('end', () => {
      const ms = Date.now() - started;
      const usage = usageFromSseTail(tail);
      recordStats(meta, status, ms, usage);
      summaryLine(meta, status, ms, usage);
      const preview = total <= HEAD_CAP + TAIL_CAP ? head + (head.length < total ? tail.slice(-(total - head.length)) : '')
        : `${head}\n…[${total - HEAD_CAP - TAIL_CAP} bytes omitted]…\n${tail}`;
      writeLog({ ...meta, status, ms, usage, bytes: total }, req.headers, payload, preview);
    });
    upstreamRes.pipe(res);
  } finally {
    release(null);
  }
}

module.exports = { handle };
