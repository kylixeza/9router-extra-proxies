'use strict';
const fs = require('fs');
const pathMod = require('path');
const { CFG, VALID_ROLES, VALID_TIERS, VALID_REWRITE_MODES } = require('./config');
const { syncModelsFrom9Router, check9RouterHealth } = require('./sync');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, obj) {
  if (res.writableEnded || res.destroyed) return;
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length });
  res.end(buf);
}

function sendText(res, status, text, ct = 'text/plain; charset=utf-8') {
  if (res.writableEnded || res.destroyed) return;
  const buf = Buffer.from(String(text ?? ''), 'utf8');
  res.writeHead(status, { 'content-type': ct, 'content-length': buf.length });
  res.end(buf);
}

function readAdminJson(req, maxBytes = CFG.adminMaxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0, tooBig = false;
    req.on('data', c => {
      n += c.length;
      if (n > maxBytes) { tooBig = true; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(Object.assign(new Error('admin request body too large'), { status: 413 }));
      if (!n) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        resolve({ __rawText: raw });
      }
    });
    req.on('error', reject);
  });
}

function serveDashboardAsset(res, relName) {
  const safe = pathMod.basename(relName);
  const full = pathMod.join(__dirname, 'dashboard', safe);
  try {
    const buf = fs.readFileSync(full);
    const ext = pathMod.extname(safe).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': buf.length,
      'cache-control': 'no-cache',
    });
    res.end(buf);
  } catch (_) {
    sendJson(res, 404, { error: 'asset not found' });
  }
}

function defaultBuildRoster(store) {
  try {
    const { buildRoster } = require('./roster');
    return buildRoster(store);
  } catch (_) {
    return { text: '<orch-roster v="000000">\n</orch-roster>', hash: '000000', tokensEst: 8 };
  }
}

function defaultDryRun(store, inputPayload) {
  const { dryRunRoute } = require('./pipeline_dryrun_shim');
  return dryRunRoute(store, inputPayload);
}

function createAdminHandler(opts = {}) {
  const store = opts.store;
  const router9Url = opts.router9Url || CFG.router9Url;
  const getRoster = opts.getRoster || (() => defaultBuildRoster(store));
  const dryRun = opts.dryRun || (payload => {
    try {
      const { evaluateRequest } = require('./server');
      return evaluateRequest(store, payload, { dryRun: true });
    } catch (_) {
      return defaultDryRun(store, payload);
    }
  });

  return async function handleAdmin(req, res) {
    const parsedUrl = new URL(req.url, 'http://127.0.0.1');
    const p = parsedUrl.pathname;

    if (req.method === 'GET' && (p === '/' || p === '/dashboard' || p === '/dashboard/' || p === '/orch' || p === '/orch/')) {
      return serveDashboardAsset(res, 'index.html');
    }
    if (req.method === 'GET' && (p.startsWith('/dashboard/assets/') || p.startsWith('/orch/assets/'))) {
      const rel = p.startsWith('/dashboard/assets/') ? p.slice('/dashboard/assets/'.length) : p.slice('/orch/assets/'.length);
      return serveDashboardAsset(res, rel);
    }
    if (req.method === 'GET' && (p === '/roster' || p === '/orch/roster')) {
      const r = getRoster();
      return sendText(res, 200, r.text, 'text/plain; charset=utf-8');
    }

    const apiPath = p === '/health' ? '/orch/api/health'
      : p.startsWith('/api/orch/') ? '/orch/api/' + p.slice('/api/orch/'.length)
      : p;

    if (!apiPath.startsWith('/orch/api/')) return false;

    try {
      if (req.method === 'GET' && apiPath === '/orch/api/health') {
        const [r9, mismatches24h] = await Promise.all([
          check9RouterHealth({ router9Url, authorization: req.headers.authorization }),
          store.countMismatches24h(),
        ]);
        const settings = store.getSettings();
        const r = getRoster();
        return sendJson(res, 200, {
          ok: true,
          uptimeSec: Math.round(process.uptime()),
          enabled: settings.enabled,
          dbConnected: store.hasPg(),
          modelsTotal: store.listCachedModels().length,
          modelsActive: store.listModels({ active: true }).length,
          router9: r9,
          mismatches24h,
          warnings: store.computeWarnings(),
          lastSync: store.getLastSyncMeta(),
          roster: r,
          enums: { roles: VALID_ROLES, tiers: VALID_TIERS, rewriteModes: VALID_REWRITE_MODES },
        });
      }

      if (req.method === 'POST' && apiPath === '/orch/api/models/sync') {
        const summary = await syncModelsFrom9Router(store, {
          router9Url,
          authorization: req.headers.authorization,
        });
        return sendJson(res, 200, summary);
      }

      if (req.method === 'GET' && apiPath === '/orch/api/models') {
        const list = store.listModels({
          role: parsedUrl.searchParams.get('role') || '',
          active: parsedUrl.searchParams.get('active') ?? '',
          available: parsedUrl.searchParams.get('available') ?? '',
          q: parsedUrl.searchParams.get('q') || '',
          cap: parsedUrl.searchParams.get('cap') || '',
        });
        return sendJson(res, 200, { models: list, lastSync: store.getLastSyncMeta() });
      }

      if (req.method === 'PATCH' && apiPath === '/orch/api/models') {
        const body = await readAdminJson(req);
        const id = parsedUrl.searchParams.get('id') || body.id;
        if (!id) return sendJson(res, 400, { error: 'query ?id= required' });
        const result = await store.patchModel(id, body);
        return sendJson(res, 200, result);
      }

      if (req.method === 'POST' && apiPath === '/orch/api/models/bulk') {
        const body = await readAdminJson(req);
        const result = await store.bulkUpdateModels(body.ids, body);
        return sendJson(res, 200, result);
      }

      if (req.method === 'GET' && apiPath === '/orch/api/settings') {
        const [mismatches24h] = await Promise.all([store.countMismatches24h()]);
        const r = getRoster();
        return sendJson(res, 200, {
          settings: store.getSettings(),
          warnings: store.computeWarnings(),
          mismatches24h,
          roster: r,
        });
      }

      if (req.method === 'PUT' && apiPath === '/orch/api/settings') {
        const body = await readAdminJson(req);
        const settings = await store.putSettings(body);
        const r = getRoster();
        return sendJson(res, 200, {
          settings,
          warnings: store.computeWarnings(),
          roster: r,
        });
      }

      if (req.method === 'GET' && apiPath === '/orch/api/plans') {
        const limit = Number(parsedUrl.searchParams.get('limit') || 50);
        const plans = await store.listPlans(Number.isFinite(limit) ? limit : 50);
        return sendJson(res, 200, { plans });
      }

      const planCallsMatch = /^\/orch\/api\/plans\/([^/]+)\/calls$/.exec(apiPath);
      if (req.method === 'GET' && (planCallsMatch || apiPath === '/orch/api/calls')) {
        const planId = planCallsMatch ? decodeURIComponent(planCallsMatch[1]) : (parsedUrl.searchParams.get('planId') || '');
        const calls = await store.listPlanCalls(planId);
        return sendJson(res, 200, { planId, calls });
      }

      if (req.method === 'POST' && apiPath === '/orch/api/route/dry-run') {
        const body = await readAdminJson(req);
        const out = dryRun(body);
        return sendJson(res, 200, out);
      }

      return sendJson(res, 404, { error: `unknown endpoint: ${req.method} ${p}` });
    } catch (err) {
      const status = err.status || 500;
      return sendJson(res, status, { error: err.message || 'internal error' });
    }
  };
}

module.exports = { createAdminHandler, sendJson, sendText, readAdminJson };
