'use strict';
const http = require('http');
const https = require('https');
const { CFG, agent: defaultAgent } = require('./config');
const { defaultStore } = require('./store');
const { detectRequest } = require('./detector');
const { routeRequest } = require('./router');
const { adaptRequest } = require('./adapter');
const { buildRoster, injectRosterIntoBody } = require('./roster');
const { createAdminHandler } = require('./admin');

function kindHeaderValue(kind) {
  if (kind === 'ORCH') return 'orchestrator';
  if (kind === 'SUBAGENT') return 'subagent';
  return 'passthrough';
}

function readRawBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooBig = false;
    req.on('data', c => {
      total += c.length;
      if (total > limitBytes) { tooBig = true; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(Object.assign(new Error('request body too large'), { status: 413 }));
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function extractUsageFromObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const u = obj.usage || (obj.response && obj.response.usage);
  if (!u || typeof u !== 'object') return null;
  const inputTokens = u.input_tokens ?? u.prompt_tokens ?? null;
  const outputTokens = u.output_tokens ?? u.completion_tokens ?? null;
  if (inputTokens === null && outputTokens === null) return null;
  return { inputTokens, outputTokens };
}

function parseUsageTail(tail, contentType) {
  if (!tail) return null;
  const ct = String(contentType || '');
  if (ct.includes('text/event-stream') || tail.includes('data:')) {
    const lines = tail.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const u = extractUsageFromObject(JSON.parse(data));
        if (u) return u;
      } catch (_) {}
    }
  }
  try {
    return extractUsageFromObject(JSON.parse(tail));
  } catch (_) {
    return null;
  }
}

function normalizeDryRunPayload(rawInput) {
  if (!rawInput) return { model: 'default', tools: [{ type: 'function', name: 'read_file' }], input: [] };
  if (typeof rawInput === 'string') {
    const t = rawInput.trim();
    if (t.startsWith('{')) {
      try {
        const parsed = JSON.parse(t);
        if (parsed && typeof parsed === 'object') return normalizeDryRunPayload(parsed);
      } catch (_) {}
    }
    return {
      model: 'default',
      tools: [{ type: 'function', name: 'read_file' }],
      input: [{ role: 'user', content: [{ type: 'input_text', text: rawInput }] }],
    };
  }
  if (typeof rawInput === 'object') {
    if (typeof rawInput.__rawText === 'string') return normalizeDryRunPayload(rawInput.__rawText);
    if (rawInput.body && typeof rawInput.body === 'object') return rawInput.body;
    if (typeof rawInput.body === 'string') return normalizeDryRunPayload(rawInput.body);
    if (typeof rawInput.text === 'string' && rawInput.input === undefined) return normalizeDryRunPayload(rawInput.text);
    if (typeof rawInput.prompt === 'string' && rawInput.input === undefined) return normalizeDryRunPayload(rawInput.prompt);
    return rawInput;
  }
  return { model: 'default', input: [] };
}

function evaluateRequest(store, rawInput, opts = {}) {
  const dryRun = Boolean(opts.dryRun);
  const srcBody = normalizeDryRunPayload(rawInput);
  const bodyObj = dryRun ? JSON.parse(JSON.stringify(srcBody)) : srcBody;
  const requestedModel = bodyObj && typeof bodyObj.model === 'string' ? bodyObj.model : null;

  const settings = store.getSettings();
  const detection = detectRequest(bodyObj, settings);
  const route = routeRequest(detection, store);

  let adapterRes = { changed: false, bodyMutated: false, changes: [], headers: {}, skippedReason: null };
  let rosterInjected = false;
  let rosterObj = null;

  if (route.routedModel && !route.failOpen) {
    const targetModel = store.getModel(route.routedModel);
    adapterRes = adaptRequest(bodyObj, targetModel, settings);
    if (!adapterRes.skippedReason && detection.kind === 'ORCH' && settings.inject_roster) {
      rosterObj = buildRoster(store, { activeOrchestrator: route.routedModel });
      rosterInjected = injectRosterIntoBody(bodyObj, rosterObj.text);
    }
  }

  const effectiveRouted = adapterRes.skippedReason ? null : route.routedModel;
  const effectiveFailOpen = Boolean(route.failOpen || adapterRes.skippedReason);
  const effectiveFallback = adapterRes.skippedReason || route.fallbackReason || null;

  return {
    kind: detection.kind,
    kindLabel: kindHeaderValue(detection.kind),
    reason: detection.reason,
    marker: detection.marker,
    needs: detection.needs,
    requestedModel,
    routedModel: effectiveRouted,
    fallbackReason: effectiveFallback,
    failOpen: effectiveFailOpen,
    warnings: route.warnings || [],
    adapterChanges: adapterRes.changes,
    bodyMutated: Boolean(adapterRes.bodyMutated || rosterInjected),
    headers: adapterRes.skippedReason ? {} : adapterRes.headers,
    rosterInjected,
    roster: rosterObj ? rosterObj.text : null,
    mutatedBody: bodyObj,
  };
}

function forwardStreamPassThrough(req, res, upstreamBase, httpAgent) {
  const upUrl = new URL(req.url, upstreamBase);
  const lib = upUrl.protocol === 'https:' ? https : http;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers['keep-alive'];

  const upReq = lib.request(upUrl, { method: req.method, headers, agent: httpAgent }, upRes => {
    const outHeaders = { ...upRes.headers };
    delete outHeaders.connection;
    delete outHeaders['keep-alive'];
    res.writeHead(upRes.statusCode || 502, outHeaders);
    if (res.flushHeaders) res.flushHeaders();
    upRes.on('error', () => res.destroy());
    upRes.pipe(res);
  });

  res.on('close', () => {
    if (!res.writableEnded) upReq.destroy();
  });

  upReq.on('error', err => {
    if (res.headersSent) { res.destroy(); return; }
    const buf = Buffer.from(JSON.stringify({ error: { message: err.message, type: 'orch_proxy_error' } }));
    res.writeHead(502, { 'content-type': 'application/json', 'content-length': buf.length });
    res.end(buf);
  });

  req.pipe(upReq);
}

function createOrchServer(opts = {}) {
  const store = opts.store || defaultStore;
  const getUpstream = () => opts.upstream || CFG.upstream;
  const getRouter9Url = () => opts.router9Url || CFG.router9Url;
  const keepAliveHttps = new https.Agent({ keepAlive: true, maxSockets: 64 });
  const keepAliveHttp = opts.agent || defaultAgent;

  const adminHandler = createAdminHandler({
    store,
    router9Url: getRouter9Url(),
    getRoster: () => buildRoster(store),
    dryRun: payload => evaluateRequest(store, payload, { dryRun: true }),
  });

  async function handleRequest(req, res) {
    const pathname = req.url.split('?')[0];

    // :20131 owns Orch dashboard + admin API (/ , /dashboard*, /orch*, /roster, /health, /api/orch/*).
    // Only OpenAI proxy traffic (/v1/*) forwards downstream to Valiant (:20130).
    const handled = await adminHandler(req, res);
    if (handled !== false) return;

    if (!pathname.startsWith('/v1/')) {
      const b = Buffer.from(JSON.stringify({ error: { message: `not found on orchestration layer: ${req.method} ${pathname}`, type: 'orch_not_found' } }));
      res.writeHead(404, { 'content-type': 'application/json', 'content-length': b.length });
      res.end(b);
      return;
    }

    const upstreamBase = getUpstream();
    const isHttpsUp = upstreamBase.startsWith('https:');
    const agentForUp = isHttpsUp ? keepAliveHttps : keepAliveHttp;

    if (req.method !== 'POST' || pathname !== '/v1/responses') {
      return forwardStreamPassThrough(req, res, upstreamBase, agentForUp);
    }

    const startedAt = Date.now();
    let rawBuf;
    try {
      rawBuf = await readRawBody(req, CFG.maxBodyBytes);
    } catch (err) {
      const status = err.status || 400;
      const b = Buffer.from(JSON.stringify({ error: { message: err.message, type: 'orch_proxy_error' } }));
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': b.length });
      res.end(b);
      return;
    }

    let outBuf = rawBuf;
    let extraReqHeaders = {};
    let evalRes = {
      kind: 'PASSTHROUGH',
      kindLabel: 'passthrough',
      marker: null,
      requestedModel: null,
      routedModel: null,
      fallbackReason: null,
      failOpen: false,
    };
    let pipelineErr = null;

    try {
      const bodyObj = JSON.parse(rawBuf.toString('utf8'));
      if (bodyObj && typeof bodyObj === 'object' && !Array.isArray(bodyObj)) {
        const evaluated = evaluateRequest(store, bodyObj, { dryRun: false });
        evalRes = evaluated;
        extraReqHeaders = evaluated.headers || {};

        if (evaluated.routedModel && !evaluated.failOpen && evaluated.bodyMutated) {
          try {
            outBuf = Buffer.from(JSON.stringify(bodyObj), 'utf8');
          } catch (serErr) {
            // Section 4.7: serialization failure restores rawBuf while keeping x-orch-model header
            outBuf = rawBuf;
            pipelineErr = `serialize_failed:${serErr.message}`;
          }
        }
      }
    } catch (err) {
      // Fail-open on invalid JSON or unexpected store/router/adapter throw: forward rawBuf byte-for-byte
      outBuf = rawBuf;
      extraReqHeaders = {};
      pipelineErr = err && err.message ? err.message : 'pipeline_error';
    }

    const upUrl = new URL(req.url, upstreamBase);
    const lib = isHttpsUp ? https : http;
    const reqHeaders = { ...req.headers };
    delete reqHeaders.host;
    delete reqHeaders.connection;
    delete reqHeaders['keep-alive'];
    delete reqHeaders['transfer-encoding'];
    // Prevent spoofed incoming x-orch-* unless orchestration itself sets them
    for (const k of Object.keys(reqHeaders)) {
      if (k.toLowerCase().startsWith('x-orch-')) delete reqHeaders[k];
    }
    Object.assign(reqHeaders, extraReqHeaders);
    reqHeaders['content-length'] = outBuf.length;

    const debugHeaders = { 'x-orch-kind': evalRes.kindLabel || 'passthrough' };
    if (evalRes.routedModel) debugHeaders['x-orch-routed-model'] = evalRes.routedModel;
    if (evalRes.fallbackReason) debugHeaders['x-orch-fallback'] = evalRes.fallbackReason;

    const marker = evalRes.marker;
    const inflightRole = marker ? marker.role : (evalRes.kind === 'ORCH' ? 'orchestrator' : null);
    const inflightId = evalRes.kind !== 'PASSTHROUGH' && typeof store.beginCall === 'function' ? store.beginCall({
      kind: evalRes.kindLabel || 'passthrough',
      planId: marker ? marker.planId : null,
      taskKey: marker ? marker.taskKey : null,
      attempt: marker ? marker.attempt : null,
      role: inflightRole,
      requestedModel: evalRes.requestedModel,
      routedModel: evalRes.routedModel || null,
      fallbackReason: evalRes.fallbackReason || null,
    }) : null;

    let ttfbMs = null;
    let logged = false;

    const recordAsyncLog = (status, appliedModel, rewrittenBy, usage, errMsg) => {
      if (logged) return;
      logged = true;
      if (inflightId && typeof store.endCall === 'function') store.endCall(inflightId);
      const latencyMs = Date.now() - startedAt;
      const routedModel = evalRes.routedModel || null;
      const mismatch = Boolean(routedModel && status !== 502 && appliedModel !== routedModel);
      const marker = evalRes.marker;
      const role = marker ? marker.role : (evalRes.kind === 'ORCH' ? 'orchestrator' : null);

      setImmediate(() => {
        try {
          store.logCall({
            kind: evalRes.kindLabel || 'passthrough',
            planId: marker ? marker.planId : null,
            taskKey: marker ? marker.taskKey : null,
            attempt: marker ? marker.attempt : null,
            role,
            requestedModel: evalRes.requestedModel,
            routedModel,
            appliedModel: appliedModel || null,
            rewrittenBy: rewrittenBy || null,
            fallbackReason: evalRes.fallbackReason || null,
            mismatch,
            status,
            latencyMs,
            ttfbMs,
            inputTokens: usage ? usage.inputTokens : null,
            outputTokens: usage ? usage.outputTokens : null,
            error: errMsg || pipelineErr || null,
          });
        } catch (_) {}
      });
    };

    const upReq = lib.request(upUrl, { method: 'POST', headers: reqHeaders, agent: agentForUp }, upRes => {
      const status = upRes.statusCode || 502;
      const appliedModel = upRes.headers['x-orch-applied-model'] ? String(upRes.headers['x-orch-applied-model']) : null;
      const rewrittenBy = upRes.headers['x-orch-rewritten-by'] ? String(upRes.headers['x-orch-rewritten-by']) : null;
      const ct = String(upRes.headers['content-type'] || '');

      const outHeaders = { ...upRes.headers, ...debugHeaders };
      delete outHeaders.connection;
      delete outHeaders['keep-alive'];

      res.writeHead(status, outHeaders);
      if (res.flushHeaders) res.flushHeaders();
      if (res.socket) res.socket.setNoDelay(true);

      let tail = '';
      upRes.on('data', chunk => {
        if (ttfbMs === null) ttfbMs = Date.now() - startedAt;
        tail = (tail + chunk.toString('utf8')).slice(-16384);
      });
      upRes.on('end', () => {
        if (ttfbMs === null) ttfbMs = Date.now() - startedAt;
        const usage = parseUsageTail(tail, ct);
        recordAsyncLog(status, appliedModel, rewrittenBy, usage, null);
      });
      upRes.on('error', err => {
        recordAsyncLog(status, appliedModel, rewrittenBy, null, err.message);
        res.destroy();
      });
      upRes.on('aborted', () => {
        recordAsyncLog(status, appliedModel, rewrittenBy, null, 'upstream_aborted');
        res.destroy();
      });

      upRes.pipe(res);
    });

    res.on('close', () => {
      if (!res.writableEnded) upReq.destroy();
    });

    upReq.on('error', err => {
      recordAsyncLog(502, null, null, null, err.message);
      if (res.headersSent) { res.destroy(); return; }
      const b = Buffer.from(JSON.stringify({ error: { message: err.message, type: 'orch_proxy_error' } }));
      res.writeHead(502, { 'content-type': 'application/json', 'content-length': b.length, ...debugHeaders });
      res.end(b);
    });

    upReq.end(outBuf);
  }

  const srv = http.createServer((req, res) => {
    handleRequest(req, res).catch(err => {
      console.error(`[orch-proxy error] ${err.stack || err.message}`);
      if (!res.headersSent) {
        const b = Buffer.from(JSON.stringify({ error: { message: err.message, type: 'orch_proxy_error' } }));
        res.writeHead(500, { 'content-type': 'application/json', 'content-length': b.length });
        res.end(b);
      } else {
        res.destroy();
      }
    });
  });

  srv.keepAliveTimeout = 120000;
  srv.headersTimeout = 125000;

  return { server: srv, handle: handleRequest, store };
}

const defaultInstance = createOrchServer();
const server = defaultInstance.server;

async function start(port = CFG.port) {
  try {
    await defaultStore.init();
  } catch (err) {
    console.error('[Orchestration Proxy] store init failed (continuing fail-open):', err.message);
  }
  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[Orchestration Proxy] Listening on http://127.0.0.1:${port} -> Context Proxy ${CFG.upstream} (dashboard: http://127.0.0.1:${port}/orch)`);
      resolve(server);
    });
  });
}

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
}

if (require.main === module) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  start();
}

module.exports = {
  createOrchServer,
  evaluateRequest,
  server,
  start,
  shutdown,
};
