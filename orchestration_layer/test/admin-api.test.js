'use strict';
const assert = require('node:assert/strict');
const http = require('http');
const { createStore } = require('../store');
const { createAdminHandler } = require('../admin');

function requestJson(baseUrl, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = http.request(new URL(path, baseUrl), {
      method,
      headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {},
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end(payload || undefined);
  });
}

(async () => {
  const mock9 = http.createServer((req, res) => {
    const data = [
      {
        id: 'ag/claude-opus-4-6-thinking',
        object: 'model',
        owned_by: 'ag',
        capabilities: { vision: true, pdf: true, tools: true, reasoning: true, contextWindow: 200000, maxOutput: 64000 },
      },
      {
        id: 'ag/gemini-4-argon-high',
        object: 'model',
        owned_by: 'ag',
        capabilities: { vision: true, pdf: null, tools: null, reasoning: true, contextWindow: 1000000, maxOutput: 65536 },
      },
      {
        id: 'ag/no-tools-fast',
        object: 'model',
        owned_by: 'ag',
        capabilities: { vision: false, pdf: false, tools: false, reasoning: false, contextWindow: 32000, maxOutput: 4096 },
      },
    ];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data }));
  });
  await new Promise(r => mock9.listen(0, '127.0.0.1', r));
  const mock9Url = `http://127.0.0.1:${mock9.address().port}`;

  const store = createStore({ pg: null });
  await store.init();
  const handleAdmin = createAdminHandler({
    store,
    router9Url: mock9Url,
    getRoster: () => ({ text: '<orch-roster v="abc123">\n</orch-roster>', hash: 'abc123', tokensEst: 10 }),
    dryRun: b => ({ kind: 'PASSTHROUGH', echo: Boolean(b) }),
  });
  const srv = http.createServer((req, res) => {
    handleAdmin(req, res).then(handled => {
      if (handled === false) { res.writeHead(404); res.end(); }
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${srv.address().port}`;

  try {
    // Sync
    const syncRes = await requestJson(baseUrl, 'POST', '/orch/api/models/sync');
    assert.equal(syncRes.status, 200);
    assert.equal(syncRes.json.added, 3);

    // URL-encoded PATCH with slash in id
    const p1 = await requestJson(
      baseUrl,
      'PATCH',
      `/orch/api/models?id=${encodeURIComponent('ag/claude-opus-4-6-thinking')}`,
      { isActive: true, roles: ['orchestrator', 'fixer'], tier: 'strong', priority: 5 }
    );
    assert.equal(p1.status, 200);
    assert.equal(p1.json.model.isActive, true);
    assert.deepEqual(p1.json.model.roles, ['orchestrator', 'fixer']);

    // Activating model with cap_tools = false for worker role must fail 400
    const badPatch = await requestJson(
      baseUrl,
      'PATCH',
      `/orch/api/models?id=${encodeURIComponent('ag/no-tools-fast')}`,
      { isActive: true, roles: ['worker'] }
    );
    assert.equal(badPatch.status, 400);
    assert.match(badPatch.json.error, /cap_tools=false/);

    // Activating model with cap_tools = null for worker role is allowed with warning
    const nullCapPatch = await requestJson(
      baseUrl,
      'PATCH',
      `/orch/api/models?id=${encodeURIComponent('ag/gemini-4-argon-high')}`,
      { isActive: true, roles: ['worker'], isDefaultWorker: true }
    );
    assert.equal(nullCapPatch.status, 200);
    assert.equal(nullCapPatch.json.warnings.length, 1);

    // Invalid role enum rejected
    const badRole = await requestJson(
      baseUrl,
      'PATCH',
      `/orch/api/models?id=${encodeURIComponent('ag/claude-opus-4-6-thinking')}`,
      { roles: ['hacker'] }
    );
    assert.equal(badRole.status, 400);

    // Filter GET /orch/api/models
    const listActive = await requestJson(baseUrl, 'GET', '/orch/api/models?active=true&role=orchestrator');
    assert.equal(listActive.status, 200);
    assert.equal(listActive.json.models.length, 1);
    assert.equal(listActive.json.models[0].id, 'ag/claude-opus-4-6-thinking');

    // Bulk action (skips tool-less worker activation gracefully)
    const bulkRes = await requestJson(baseUrl, 'POST', '/orch/api/models/bulk', {
      ids: ['ag/claude-opus-4-6-thinking', 'ag/no-tools-fast'],
      addRole: 'worker',
      isActive: true,
    });
    assert.equal(bulkRes.status, 200);
    assert.equal(bulkRes.json.updated, 1);
    assert.equal(bulkRes.json.skipped.length, 1);

    // Settings PUT/GET
    const putSet = await requestJson(baseUrl, 'PUT', '/orch/api/settings', {
      orchestrator_chain: ['ag/claude-opus-4-6-thinking'],
      rewrite_mode: 'header',
      max_attempts: 4,
    });
    assert.equal(putSet.status, 200);
    assert.equal(putSet.json.settings.rewrite_mode, 'header');
    assert.equal(putSet.json.settings.max_attempts, 4);

    // Plans & calls monitor
    await store.logCall({
      kind: 'subagent',
      planId: '2026-11-07-demo',
      taskKey: 'T1',
      attempt: 1,
      role: 'worker',
      requestedModel: 'gpt-4o',
      routedModel: 'ag/gemini-4-argon-high',
      appliedModel: 'ag/gemini-4-argon-high',
      rewrittenBy: 'orchestration',
      status: 200,
      latencyMs: 320,
      inputTokens: 1200,
      outputTokens: 300,
    });
    const plansRes = await requestJson(baseUrl, 'GET', '/orch/api/plans');
    assert.equal(plansRes.status, 200);
    assert.equal(plansRes.json.plans.length, 1);
    assert.equal(plansRes.json.plans[0].plan_id, '2026-11-07-demo');

    const callsRes = await requestJson(baseUrl, 'GET', '/orch/api/plans/2026-11-07-demo/calls');
    assert.equal(callsRes.status, 200);
    assert.equal(callsRes.json.calls.length, 1);

    // Roster plain text + health
    const rosterRes = await requestJson(baseUrl, 'GET', '/orch/roster');
    assert.equal(rosterRes.status, 200);
    assert.match(rosterRes.text, /<orch-roster/);

    const healthRes = await requestJson(baseUrl, 'GET', '/orch/api/health');
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.json.ok, true);
    assert.equal(healthRes.json.router9.reachable, true);
  } finally {
    await new Promise(r => srv.close(r));
    await new Promise(r => mock9.close(r));
  }

  console.log('PASS: admin-api.test.js');
})();
