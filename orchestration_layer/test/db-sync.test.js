'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const pathMod = require('path');
const { createStore } = require('../store');
const { syncModelsFrom9Router } = require('../sync');

const sampleModels = JSON.parse(
  fs.readFileSync(pathMod.join(__dirname, '..', 'fixtures', 'models-sample.json'), 'utf8')
);

function startMock9Router(handler) {
  return new Promise(resolve => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise(r => srv.close(r)) });
    });
  });
}

(async () => {
  // 1. Sync with real 9router fixture + edge-case items (thinkingRange: null, missing capabilities, invalid missing id)
  let payloadToServe = {
    object: 'list',
    data: [
      ...sampleModels.data,
      { object: 'model', owned_by: 'broken_no_id' },
      {
        id: 'ag/claude-opus-4-6-thinking',
        object: 'model',
        owned_by: 'ag',
        capabilities: {
          vision: true,
          pdf: true,
          tools: true,
          reasoning: true,
          thinkingFormat: 'claude-budget',
          thinkingRange: null,
          contextWindow: 200000,
          maxOutput: 64000,
        },
      },
    ],
  };

  const mock = await startMock9Router((req, res) => {
    if (req.url === '/v1/models') {
      const b = JSON.stringify(payloadToServe);
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) });
      res.end(b);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  try {
    const store = createStore({ pg: null });
    await store.init();

    const s1 = await syncModelsFrom9Router(store, { router9Url: mock.url });
    assert.ok(s1.added >= 10, 'initial sync adds valid models and skips item without id');
    assert.equal(s1.updated, 0);
    assert.equal(s1.unavailable, 0);

    const opus = store.getModel('ag/claude-opus-4-6-thinking');
    assert.ok(opus);
    assert.equal(opus.family, 'claude', 'family guessed from id');
    assert.equal(opus.capTools, true);
    assert.equal(opus.thinkingRange, null);
    assert.equal(opus.isActive, false);
    assert.deepEqual(opus.roles, []);

    const noCaps = store.getModel('test/no-caps-model');
    assert.ok(noCaps);
    assert.equal(noCaps.capTools, null, 'missing capabilities map to NULL, not false');
    assert.equal(noCaps.capVision, null);

    // 2. Customize user fields via patchModel
    await store.patchModel('ag/claude-opus-4-6-thinking', {
      isActive: true,
      roles: ['orchestrator', 'fixer'],
      tier: 'strong',
      family: 'custom-claude',
      priority: 10,
      notes: 'Primary orchestrator',
    });

    // 3. Second sync with array root & one model removed -> preserves user fields, marks missing model available=false
    payloadToServe = payloadToServe.data.filter(m => m.id && m.id !== 'test/no-caps-model');
    const s2 = await syncModelsFrom9Router(store, { router9Url: mock.url });
    assert.equal(s2.added, 0);
    assert.ok(s2.updated >= 9);
    assert.equal(s2.unavailable, 1);

    const opusAfter = store.getModel('ag/claude-opus-4-6-thinking');
    assert.equal(opusAfter.isActive, true, 'sync must preserve is_active');
    assert.deepEqual(opusAfter.roles, ['orchestrator', 'fixer'], 'sync must preserve roles');
    assert.equal(opusAfter.tier, 'strong', 'sync must preserve tier');
    assert.equal(opusAfter.family, 'custom-claude', 'sync must preserve non-empty family');
    assert.equal(opusAfter.priority, 10, 'sync must preserve priority');
    assert.equal(opusAfter.notes, 'Primary orchestrator', 'sync must preserve notes');

    const missingAfter = store.getModel('test/no-caps-model');
    assert.ok(missingAfter, 'missing model must not be deleted');
    assert.equal(missingAfter.available, false, 'missing model marked available=false');
  } finally {
    await mock.close();
  }

  // 4. Dead 9router -> clear 502 error
  const deadStore = createStore({ pg: null });
  await deadStore.init();
  await assert.rejects(
    () => syncModelsFrom9Router(deadStore, { router9Url: 'http://127.0.0.1:19999', timeoutMs: 1000 }),
    err => err.status === 502 && /9router tidak terjangkau/i.test(err.message)
  );

  // 5. Verify PostgreSQL schema migration & round-trip against live PG if enabled
  const pgStore = require('../../storage_layer/store');
  if (pgStore.isEnabled()) {
    const liveOrchStore = createStore({ pg: pgStore });
    await liveOrchStore.init();
    const check = await pgStore.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('orch_models', 'orch_settings', 'orch_calls')
       ORDER BY table_name`
    );
    assert.deepEqual(
      check.rows.map(r => r.table_name),
      ['orch_calls', 'orch_models', 'orch_settings'],
      'PostgreSQL tables created cleanly'
    );
    await pgStore.close();
  }

  console.log('PASS: db-sync.test.js');
})();
