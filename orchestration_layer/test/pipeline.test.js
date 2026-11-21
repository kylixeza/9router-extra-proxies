'use strict';
// Ensure hermetic test run: never write to live PostgreSQL or disk logs
process.env.LOG_TO_PG = 'false';
process.env.LOG_BODIES = 'false';
process.env.DEDUP_TTL_MS = '0';

const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const pathMod = require('path');

const connConfig = require('../../connection_layer/config');
const connHandler = require('../../connection_layer/handler');
const ctxConfig = require('../../context_layer/config');
const ctxHandler = require('../../context_layer/handler');

const { createStore } = require('../store');
const { createOrchServer, evaluateRequest } = require('../server');
const { detectRequest } = require('../detector');
const { adaptRequest } = require('../adapter');

const FIXTURES_DIR = pathMod.join(__dirname, '..', 'fixtures');
const normalRawBuf = fs.readFileSync(pathMod.join(FIXTURES_DIR, 'normal.json'));
const orchPlanRawBuf = fs.readFileSync(pathMod.join(FIXTURES_DIR, 'orch-plan.json'));
const subagentRawBuf = fs.readFileSync(pathMod.join(FIXTURES_DIR, 'subagent-task.json'));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function listenEphemeral(srv) {
  return new Promise(resolve => {
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise(r => srv.close(r)),
      });
    });
  });
}

function sendHttpRequest(baseUrl, method, path, rawBody, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const buf = rawBody === null || rawBody === undefined
      ? null
      : (Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody), 'utf8'));
    const headers = { ...extraHeaders };
    if (buf !== null && headers['content-type'] === undefined) headers['content-type'] = 'application/json';
    if (buf !== null && headers['content-length'] === undefined) headers['content-length'] = buf.length;

    const started = Date.now();
    const req = http.request(new URL(path, baseUrl), { method, headers }, res => {
      let ttfbMs = null;
      const chunks = [];
      res.on('data', c => {
        if (ttfbMs === null) ttfbMs = Date.now() - started;
        chunks.push(c);
      });
      res.on('end', () => {
        const totalMs = Date.now() - started;
        const bodyBuf = Buffer.concat(chunks);
        const text = bodyBuf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, bodyBuf, text, json, ttfbMs: ttfbMs ?? totalMs, totalMs });
      });
    });
    req.on('error', reject);
    req.end(buf || undefined);
  });
}

(async () => {
  // Captured requests at mock 9router (:20128 equivalent) and at first hop after orchestration_layer
  const r9Received = [];
  let r9Mode = { type: 'json' }; // or { type: 'sse_slow', delayMs: 220 }

  const mock9Srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks);
      let parsed = null;
      try { parsed = JSON.parse(raw.toString('utf8')); } catch (_) {}
      r9Received.push({
        method: req.method,
        url: req.url,
        headers: { ...req.headers },
        raw,
        parsed,
      });

      if (r9Mode.type === 'sse_slow') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        if (res.flushHeaders) res.flushHeaders();
        res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'first-token' })}\n\n`);
        await sleep(r9Mode.delayMs || 220);
        res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 321, output_tokens: 45 } } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const reply = JSON.stringify({
        id: 'resp_test_1',
        object: 'response',
        model: parsed && parsed.model ? parsed.model : 'unknown',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] }],
        usage: { input_tokens: 111, output_tokens: 22 },
      });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(reply) });
      res.end(reply);
    });
  });

  // Hop spy sitting right after orchestration_layer (verifies byte-for-byte passthrough before context_layer shapes tools)
  const firstHopReceived = [];
  let stripOrchHeaderInTransit = false;
  let nextAfterSpyUrl = '';

  const hopSpySrv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      firstHopReceived.push({ method: req.method, url: req.url, headers: { ...req.headers }, raw });

      const fHeaders = { ...req.headers };
      delete fHeaders.host;
      if (stripOrchHeaderInTransit) {
        for (const k of Object.keys(fHeaders)) {
          if (k.toLowerCase().startsWith('x-orch-')) delete fHeaders[k];
        }
      }
      fHeaders['content-length'] = raw.length;

      const up = http.request(new URL(req.url, nextAfterSpyUrl), { method: req.method, headers: fHeaders }, upRes => {
        res.writeHead(upRes.statusCode, upRes.headers);
        if (res.flushHeaders) res.flushHeaders();
        upRes.pipe(res);
      });
      up.on('error', err => { res.writeHead(502); res.end(err.message); });
      up.end(raw);
    });
  });

  const connSrv = http.createServer((req, res) => connHandler.handle(req, res));
  const ctxSrv = http.createServer((req, res) => ctxHandler.handle(req, res));

  const mock9 = await listenEphemeral(mock9Srv);
  const conn = await listenEphemeral(connSrv);
  const ctx = await listenEphemeral(ctxSrv);
  const hopSpy = await listenEphemeral(hopSpySrv);

  // Wire full chain: orch -> hopSpy -> context_layer -> connection_layer -> mock9router
  connConfig.CFG.target = mock9.url;
  connConfig.CFG.retries = 0;
  ctxConfig.CFG.target = conn.url;
  ctxConfig.CFG.tokenAlertThreshold = 999999999; // never trigger macOS AppleScript alert in tests
  nextAfterSpyUrl = ctx.url;

  const store = createStore({ pg: null });
  await store.init();

  // Seed catalog models covering orchestrator, workers (vision/no-vision, reasoning caps), fixer, inactive
  await store.applySyncPayload([
    {
      id: 'ag/claude-opus-4-6-thinking',
      object: 'model',
      owned_by: 'ag',
      capabilities: {
        vision: true, pdf: true, tools: true, reasoning: true,
        thinkingEffortSupported: true, contextWindow: 200000, maxOutput: 64000,
      },
    },
    {
      id: 'ag/gemini-4-argon-high',
      object: 'model',
      owned_by: 'ag',
      capabilities: {
        vision: true, pdf: true, tools: true, reasoning: true,
        thinkingEffortSupported: true, contextWindow: 1000000, maxOutput: 65536,
      },
    },
    {
      id: 'kr/qwen-coder-fast',
      object: 'model',
      owned_by: 'kr',
      capabilities: {
        vision: false, pdf: false, tools: true, reasoning: false,
        thinkingEffortSupported: false, contextWindow: 128000, maxOutput: 8192,
      },
    },
    {
      id: 'ms/inactive-worker',
      object: 'model',
      owned_by: 'ms',
      capabilities: {
        vision: true, pdf: true, tools: true, reasoning: true,
        contextWindow: 128000, maxOutput: 16384,
      },
    },
    {
      id: 'oai/gpt-5-fixer',
      object: 'model',
      owned_by: 'oai',
      capabilities: {
        vision: true, pdf: false, tools: true, reasoning: true,
        thinkingEffortSupported: false, contextWindow: 272000, maxOutput: 32768,
      },
    },
  ]);

  await store.patchModel('ag/claude-opus-4-6-thinking', {
    isActive: true, roles: ['orchestrator', 'fixer'], tier: 'strong', priority: 10, notes: 'Lead planner',
  });
  await store.patchModel('ag/gemini-4-argon-high', {
    isActive: true, roles: ['worker'], tier: 'balanced', priority: 20, isDefaultWorker: true, notes: 'Vision worker',
  });
  await store.patchModel('kr/qwen-coder-fast', {
    isActive: true, roles: ['worker'], tier: 'fast', priority: 15, notes: 'Text-only fast coder',
  });
  await store.patchModel('ms/inactive-worker', {
    isActive: false, roles: ['worker'], tier: 'fast', priority: 30,
  });
  await store.patchModel('oai/gpt-5-fixer', {
    isActive: true, roles: ['fixer'], tier: 'strong', priority: 12, notes: 'Cross-family debugger',
  });

  await store.putSettings({
    enabled: true,
    trigger_command: '/orch-plan',
    off_command: '/orch-off',
    orchestrator_chain: ['ag/claude-opus-4-6-thinking'],
    worker_fallback_chain: ['ag/gemini-4-argon-high', 'kr/qwen-coder-fast'],
    fixer_chain: ['oai/gpt-5-fixer', 'ag/claude-opus-4-6-thinking'],
    max_attempts: 3,
    max_parallel: 3,
    inject_roster: true,
    rewrite_mode: 'body',
  });

  const orchInst = createOrchServer({ store, upstream: hopSpy.url, router9Url: mock9.url });
  const orch = await listenEphemeral(orchInst.server);

  try {
    // =========================================================================
    // Scenario 1: Normal request (`normal.json`) -> PASSTHROUGH, byte-identical
    // =========================================================================
    firstHopReceived.length = 0;
    r9Received.length = 0;
    const res1 = await sendHttpRequest(orch.url, 'POST', '/v1/responses', normalRawBuf);
    assert.equal(res1.status, 200);
    assert.equal(res1.headers['x-orch-kind'], 'passthrough');
    assert.equal(res1.headers['x-orch-routed-model'], undefined);
    assert.equal(firstHopReceived.length, 1);
    assert.equal(
      Buffer.compare(firstHopReceived[0].raw, normalRawBuf),
      0,
      'Scenario 1: normal request body bytes leaving orchestration_layer must be 100% byte-identical'
    );
    assert.equal(firstHopReceived[0].headers['x-orch-model'], undefined);
    // Verify conversation_id flows from context_layer -> response, and internal x-proxy-* is stripped before 9router
    assert.match(res1.headers['x-conversation-id'] || '', /^conv_[0-9a-f]{16}$/);
    assert.equal(r9Received[0].headers['x-proxy-conversation-id'], undefined);

    // =========================================================================
    // Scenario 2: `/orch-plan` message (`orch-plan.json`) -> orchestrator + roster at end of last user msg
    // =========================================================================
    firstHopReceived.length = 0;
    r9Received.length = 0;
    const res2 = await sendHttpRequest(orch.url, 'POST', '/v1/responses', orchPlanRawBuf);
    assert.equal(res2.status, 200);
    assert.equal(res2.headers['x-orch-kind'], 'orchestrator');
    assert.equal(res2.headers['x-orch-routed-model'], 'ag/claude-opus-4-6-thinking');
    const hop2Body = JSON.parse(firstHopReceived[0].raw.toString('utf8'));
    assert.equal(hop2Body.model, 'ag/claude-opus-4-6-thinking');
    const userItems2 = hop2Body.input.filter(it => it && it.role === 'user');
    const lastUserText2 = userItems2[userItems2.length - 1].content.map(p => p.text || '').join('\n');
    assert.match(lastUserText2, /<orch-roster v="[0-9a-f]{6}">[\s\S]*orchestrator: ag\/claude-opus-4-6-thinking[\s\S]*assignment_policy: spread_across_workers[\s\S]*<\/orch-roster>$/);
    assert.ok(!lastUserText2.includes('default_worker:'), 'spread_load=true omits single default_worker so tasks spread across peers');
    // Also verify context_layer received x-orch-model-context (200000) and reported it
    assert.equal(res2.headers['x-context-budget'], '200000');
    assert.equal(r9Received[0].parsed.model, 'ag/claude-opus-4-6-thinking');

    // =========================================================================
    // Scenario 3: Follow-up message whose history has `/orch-plan` -> stays routed to orchestrator
    // =========================================================================
    const followUpBody = JSON.parse(orchPlanRawBuf.toString('utf8'));
    followUpBody.input.push({
      role: 'user',
      content: [{ type: 'input_text', text: '<ide-context>doc</ide-context>\n\nProceed with the approved implementation plan.' }],
    });
    r9Received.length = 0;
    const res3 = await sendHttpRequest(orch.url, 'POST', '/v1/responses', followUpBody);
    assert.equal(res3.status, 200);
    assert.equal(res3.headers['x-orch-kind'], 'orchestrator');
    assert.equal(r9Received[0].parsed.model, 'ag/claude-opus-4-6-thinking');

    // =========================================================================
    // Scenario 4: History has `set_plan_state` with `state="COMPLETED"` (and `/orch-off`) -> PASSTHROUGH
    // =========================================================================
    const completedBody = JSON.parse(JSON.stringify(followUpBody));
    completedBody.model = 'muse/muse-spark-1.3';
    completedBody.input.push({
      type: 'function_call',
      name: 'set_plan_state',
      call_id: 'fc_done_1',
      arguments: JSON.stringify({ currentTask: null, state: 'COMPLETED', verified: true }),
    });
    completedBody.input.push({
      role: 'user',
      content: [{ type: 'input_text', text: '<ide-context>ctx</ide-context>\n\nThanks, quick unrelated question?' }],
    });
    r9Received.length = 0;
    const res4a = await sendHttpRequest(orch.url, 'POST', '/v1/responses', completedBody);
    assert.equal(res4a.headers['x-orch-kind'], 'passthrough');
    assert.equal(r9Received[0].parsed.model, 'muse/muse-spark-1.3');

    // Also test `/orch-off` user command closing an active `/orch-plan` session
    const offBody = JSON.parse(JSON.stringify(followUpBody));
    offBody.model = 'muse/muse-spark-1.3';
    offBody.input.push({
      role: 'user',
      content: [{ type: 'input_text', text: '<ide-context>ctx</ide-context>\n\n/orch-off' }],
    });
    const res4b = await sendHttpRequest(orch.url, 'POST', '/v1/responses', offBody);
    assert.equal(res4b.headers['x-orch-kind'], 'passthrough');

    // =========================================================================
    // Scenario 5: Valid `[[ORCH v=1 ...]]` marker (`subagent-task.json`) -> routed to `marker.agent`
    // =========================================================================
    r9Received.length = 0;
    const res5 = await sendHttpRequest(orch.url, 'POST', '/v1/responses', subagentRawBuf);
    assert.equal(res5.status, 200);
    assert.equal(res5.headers['x-orch-kind'], 'subagent');
    assert.equal(res5.headers['x-orch-routed-model'], 'ag/gemini-4-argon-high');
    assert.equal(r9Received[0].parsed.model, 'ag/gemini-4-argon-high');
    await sleep(20);
    const calls5 = await store.listPlanCalls('2026-11-07-weekly-chart');
    assert.ok(calls5.some(c => c.task_key === 'T3' && c.routed_model === 'ag/gemini-4-argon-high' && c.fallback_reason === null));

    // =========================================================================
    // Scenario 6: Marker with unknown ID or inactive model -> fallback chain + logs fallback_reason
    // =========================================================================
    const unknownMarkerBody = {
      model: 'muse/muse-spark-1.3',
      tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object', properties: {} } }],
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: '[[ORCH v=1 plan=2026-11-07-fb task=T1 role=worker agent=ghost/non-existent attempt=1]]\nDo T1' }],
      }],
    };
    const res6a = await sendHttpRequest(orch.url, 'POST', '/v1/responses', unknownMarkerBody);
    assert.equal(res6a.headers['x-orch-routed-model'], 'ag/gemini-4-argon-high');
    assert.equal(res6a.headers['x-orch-fallback'], 'unknown_id');

    const inactiveMarkerBody = {
      model: 'muse/muse-spark-1.3',
      tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object', properties: {} } }],
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: '[[ORCH v=1 plan=2026-11-07-fb task=T2 role=worker agent=ms/inactive-worker attempt=1]]\nDo T2' }],
      }],
    };
    const res6b = await sendHttpRequest(orch.url, 'POST', '/v1/responses', inactiveMarkerBody);
    assert.equal(res6b.headers['x-orch-routed-model'], 'ag/gemini-4-argon-high');
    assert.equal(res6b.headers['x-orch-fallback'], 'inactive');

    const fixerFallbackBody = {
      model: 'muse/muse-spark-1.3',
      tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object', properties: {} } }],
      reasoning: { effort: 'high' },
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: '[[ORCH v=1 plan=2026-11-07-fb task=T2 role=fixer agent=kr/qwen-coder-fast attempt=2]]\nFix T2' }],
      }],
    };
    r9Received.length = 0;
    const res6c = await sendHttpRequest(orch.url, 'POST', '/v1/responses', fixerFallbackBody);
    assert.equal(res6c.headers['x-orch-routed-model'], 'oai/gpt-5-fixer');
    assert.equal(res6c.headers['x-orch-fallback'], 'role_mismatch');
    // Adapter check: oai/gpt-5-fixer has thinkingEffortSupported=false -> reasoning.effort stripped!
    assert.equal(r9Received[0].parsed.reasoning.effort, undefined);

    await sleep(20);
    const fbCalls = await store.listPlanCalls('2026-11-07-fb');
    assert.deepEqual(
      fbCalls.map(c => c.fallback_reason),
      ['unknown_id', 'inactive', 'role_mismatch']
    );

    // =========================================================================
    // Scenario 7: Marker inside `function_call` arguments of orchestrator -> stays ORCH, NOT SUBAGENT
    // =========================================================================
    const orchCallingTaskBody = {
      model: 'muse/muse-spark-1.3',
      tools: [{ type: 'function', name: 'task', parameters: { type: 'object', properties: {} } }],
      input: [
        { role: 'user', content: [{ type: 'input_text', text: '<ide-context>ctx</ide-context>\n\n/orch-plan\nBuild feature X' }] },
        {
          type: 'function_call',
          name: 'task',
          call_id: 'fc_task_1',
          arguments: JSON.stringify({
            prompt: '[[ORCH v=1 plan=2026-11-07-x task=T1 role=worker agent=kr/qwen-coder-fast attempt=1]]\nImplement X',
          }),
        },
        {
          type: 'function_call_output',
          call_id: 'fc_task_1',
          output: 'Sub-agent T1 finished [[ORCH v=1 plan=2026-11-07-x task=T1 role=worker agent=kr/qwen-coder-fast attempt=1]]',
        },
      ],
    };
    const res7 = await sendHttpRequest(orch.url, 'POST', '/v1/responses', orchCallingTaskBody);
    assert.equal(res7.headers['x-orch-kind'], 'orchestrator');
    assert.equal(res7.headers['x-orch-routed-model'], 'ag/claude-opus-4-6-thinking');

    // =========================================================================
    // Scenario 8: Example marker in `instructions` (`<T-id>`, `<id>`) & `<ide-context>` -> never matches
    // =========================================================================
    const exampleInInstructionsAndContext = {
      model: 'muse/muse-spark-1.3',
      instructions: 'Always format subagent prompts as [[ORCH v=1 plan=<id> task=<T-id> role=worker agent=<id> attempt=1]] or even [[ORCH v=1 plan=demo task=T1 role=worker agent=kr/qwen-coder-fast attempt=1]]',
      input: [{
        role: 'user',
        content: [{
          type: 'input_text',
          text: '<ide-context>\nAGENTS.md example: [[ORCH v=1 plan=demo task=T1 role=worker agent=kr/qwen-coder-fast attempt=1]]\n/orch-plan\n</ide-context>\n\nExplain how [[ORCH v=1 plan=<id> task=<T-id> role=worker agent=<id> attempt=1]] works',
        }],
      }],
    };
    const det8 = detectRequest(exampleInInstructionsAndContext, store.getSettings());
    assert.equal(det8.kind, 'PASSTHROUGH');

    // Also test adapter `previous_response_id` defensive guard
    const prevRespEval = adaptRequest(
      { model: 'orig', previous_response_id: 'resp_prev_123', max_output_tokens: 999999 },
      store.getModel('kr/qwen-coder-fast'),
      store.getSettings()
    );
    assert.equal(prevRespEval.skippedReason, 'previous_response_id');

    // =========================================================================
    // Scenario 9: Non-JSON body, store error, or `enabled = false` -> fail-open, original bytes forwarded
    // =========================================================================
    // 9a. Invalid non-JSON body
    firstHopReceived.length = 0;
    const garbageBuf = Buffer.from('{not valid json [[[ORCH v=1 plan=p task=T1 role=worker agent=kr/qwen-coder-fast attempt=1]]', 'utf8');
    await sendHttpRequest(orch.url, 'POST', '/v1/responses', garbageBuf, { 'content-type': 'application/json' });
    assert.equal(Buffer.compare(firstHopReceived[0].raw, garbageBuf), 0, '9a: invalid JSON forwarded untouched');

    // 9b. Simulated store error on hot path
    firstHopReceived.length = 0;
    const origGetSettings = store.getSettings;
    store.getSettings = () => { throw new Error('simulated DB cache explosion'); };
    try {
      const res9b = await sendHttpRequest(orch.url, 'POST', '/v1/responses', subagentRawBuf);
      assert.equal(res9b.status, 200);
      assert.equal(res9b.headers['x-orch-kind'], 'passthrough');
      assert.equal(Buffer.compare(firstHopReceived[0].raw, subagentRawBuf), 0, '9b: store throw fails open byte-for-byte');
    } finally {
      store.getSettings = origGetSettings;
    }

    // 9c. `enabled = false` kill switch
    await store.putSettings({ enabled: false });
    try {
      firstHopReceived.length = 0;
      const res9c = await sendHttpRequest(orch.url, 'POST', '/v1/responses', orchPlanRawBuf);
      assert.equal(res9c.headers['x-orch-kind'], 'passthrough');
      assert.equal(Buffer.compare(firstHopReceived[0].raw, orchPlanRawBuf), 0, '9c: enabled=false forwards untouched');
    } finally {
      await store.putSettings({ enabled: true });
    }

    // =========================================================================
    // Scenario 10: Request with `input_image` when target has `cap_vision = false` ->
    //   10a) routes to vision-capable fallback (`ag/gemini-4-argon-high`)
    //   10b) when no vision-capable fallback exists, replaces image with `[image omitted]`
    // =========================================================================
    const imageSubagentBody = {
      model: 'muse/muse-spark-1.3',
      max_output_tokens: 50000,
      reasoning: { effort: 'high' },
      tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object', properties: {} } }],
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: '[[ORCH v=1 plan=2026-11-07-vis task=T1 role=worker agent=kr/qwen-coder-fast attempt=1]]\nInspect UI screenshot' },
          { type: 'input_image', image_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' },
        ],
      }],
    };
    r9Received.length = 0;
    const res10a = await sendHttpRequest(orch.url, 'POST', '/v1/responses', imageSubagentBody);
    assert.equal(res10a.headers['x-orch-routed-model'], 'ag/gemini-4-argon-high');
    assert.equal(res10a.headers['x-orch-fallback'], 'needs_vision');
    assert.equal(r9Received[0].parsed.input[0].content[1].type, 'input_image', '10a: vision fallback keeps image intact');

    // 10b: disable vision worker so no vision-capable worker exists -> keeps kr/qwen-coder-fast and replaces image with `[image omitted]`
    await store.patchModel('ag/gemini-4-argon-high', { isActive: false });
    try {
      r9Received.length = 0;
      const res10b = await sendHttpRequest(orch.url, 'POST', '/v1/responses', imageSubagentBody);
      assert.equal(res10b.headers['x-orch-routed-model'], 'kr/qwen-coder-fast');
      assert.equal(res10b.headers['x-orch-fallback'], 'needs_vision');
      const sentContent = r9Received[0].parsed.input[0].content;
      assert.deepEqual(sentContent[1], { type: 'input_text', text: '[image omitted]' });
      // Also verifies adapter clamped max_output_tokens (50000 -> 8192) & deleted reasoning on kr/qwen-coder-fast!
      assert.equal(r9Received[0].parsed.max_output_tokens, 8192);
      assert.equal(r9Received[0].parsed.reasoning, undefined);
    } finally {
      await store.patchModel('ag/gemini-4-argon-high', { isActive: true });
    }

    // =========================================================================
    // Scenario 11: Long SSE streaming response -> TTFB not blocked; `orch_calls` logged async after end
    // =========================================================================
    r9Mode = { type: 'sse_slow', delayMs: 240 };
    try {
      const streamBody = {
        model: 'muse/muse-spark-1.3',
        stream: true,
        tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object', properties: {} } }],
        input: [{
          role: 'user',
          content: [{ type: 'input_text', text: '[[ORCH v=1 plan=2026-11-07-sse task=T9 role=worker agent=kr/qwen-coder-fast attempt=1]]\nStream response' }],
        }],
      };
      const res11 = await sendHttpRequest(orch.url, 'POST', '/v1/responses', streamBody);
      assert.equal(res11.status, 200);
      assert.ok(res11.ttfbMs < 120, `Scenario 11: expected fast TTFB (<120ms), got ${res11.ttfbMs}ms`);
      assert.ok(res11.totalMs >= 220, `Scenario 11: stream lasted ${res11.totalMs}ms`);
      assert.ok(res11.ttfbMs < res11.totalMs - 120, 'Scenario 11: first SSE chunk arrived well before stream end');
      await sleep(25);
      const sseCalls = await store.listPlanCalls('2026-11-07-sse');
      assert.equal(sseCalls.length, 1);
      assert.equal(sseCalls[0].input_tokens, 321);
      assert.equal(sseCalls[0].output_tokens, 45);
      assert.ok(sseCalls[0].ttfb_ms < sseCalls[0].latency_ms);
    } finally {
      r9Mode = { type: 'json' };
    }

    // =========================================================================
    // Scenario 12: `rewrite_mode = 'header'` -> orch leaves body.model untouched, connection forces body.model,
    //   recomputes content-length, strips x-orch-*, returns x-orch-rewritten-by = 'connection'
    // =========================================================================
    await store.putSettings({ rewrite_mode: 'header' });
    firstHopReceived.length = 0;
    r9Received.length = 0;
    const hdrModeBody = {
      model: 'muse/muse-spark-1.3',
      tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object', properties: {} } }],
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: '[[ORCH v=1 plan=2026-11-07-hdr task=T1 role=worker agent=ag/gemini-4-argon-high attempt=1]]\nRun header mode' }],
      }],
    };
    const hdrRaw = Buffer.from(JSON.stringify(hdrModeBody), 'utf8');
    const res12 = await sendHttpRequest(orch.url, 'POST', '/v1/responses', hdrRaw);
    assert.equal(res12.status, 200);
    // Leaving orchestration_layer: body.model untouched (byte-for-byte identical!), x-orch-model set
    assert.equal(Buffer.compare(firstHopReceived[0].raw, hdrRaw), 0, '12: orch in header mode leaves body bytes untouched');
    assert.equal(firstHopReceived[0].headers['x-orch-model'], 'ag/gemini-4-argon-high');
    // Arriving at 9router: body.model forced, content-length exact, zero x-orch-* headers!
    assert.equal(r9Received[0].parsed.model, 'ag/gemini-4-argon-high');
    assert.equal(Number(r9Received[0].headers['content-length']), r9Received[0].raw.length);
    assert.equal(Object.keys(r9Received[0].headers).filter(k => k.startsWith('x-orch-')).length, 0, '12: all x-orch-* stripped before 9router');
    assert.equal(res12.headers['x-orch-applied-model'], 'ag/gemini-4-argon-high');
    assert.equal(res12.headers['x-orch-rewritten-by'], 'connection');
    await sleep(20);
    const hdrCalls = await store.listPlanCalls('2026-11-07-hdr');
    assert.equal(hdrCalls[0].rewritten_by, 'connection');
    assert.equal(hdrCalls[0].mismatch, false);

    // =========================================================================
    // Scenario 13: `rewrite_mode = 'body'` -> body.model already matches x-orch-model at connection_layer,
    //   strips x-orch-*, returns x-orch-rewritten-by = 'orchestration'
    // =========================================================================
    await store.putSettings({ rewrite_mode: 'body' });
    r9Received.length = 0;
    const bodyModeReq = {
      model: 'muse/muse-spark-1.3',
      tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object', properties: {} } }],
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: '[[ORCH v=1 plan=2026-11-07-bdy task=T1 role=worker agent=ag/gemini-4-argon-high attempt=1]]\nRun body mode' }],
      }],
    };
    const res13 = await sendHttpRequest(orch.url, 'POST', '/v1/responses', bodyModeReq);
    assert.equal(res13.status, 200);
    assert.equal(r9Received[0].parsed.model, 'ag/gemini-4-argon-high');
    assert.equal(Object.keys(r9Received[0].headers).filter(k => k.startsWith('x-orch-')).length, 0, '13: all x-orch-* stripped before 9router');
    assert.equal(res13.headers['x-orch-applied-model'], 'ag/gemini-4-argon-high');
    assert.equal(res13.headers['x-orch-rewritten-by'], 'orchestration');
    await sleep(20);
    const bdyCalls = await store.listPlanCalls('2026-11-07-bdy');
    assert.equal(bdyCalls[0].rewritten_by, 'orchestration');
    assert.equal(bdyCalls[0].mismatch, false);

    // =========================================================================
    // Scenario 14: `x-orch-model` stripped mid-hop before connection_layer ->
    //   connection does not rewrite, 9router sees original model, orchestration records `mismatch = true`
    // =========================================================================
    await store.putSettings({ rewrite_mode: 'header' });
    stripOrchHeaderInTransit = true;
    r9Received.length = 0;
    try {
      const stripBody = {
        model: 'muse/muse-spark-1.3',
        tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object', properties: {} } }],
        input: [{
          role: 'user',
          content: [{ type: 'input_text', text: '[[ORCH v=1 plan=2026-11-07-mis task=T1 role=worker agent=ag/gemini-4-argon-high attempt=1]]\nTest stripped header' }],
        }],
      };
      const res14 = await sendHttpRequest(orch.url, 'POST', '/v1/responses', stripBody);
      assert.equal(res14.status, 200);
      assert.equal(r9Received[0].parsed.model, 'muse/muse-spark-1.3', '14: 9router got original model because header was stripped');
      assert.equal(res14.headers['x-orch-applied-model'], undefined);
      await sleep(25);
      const misCalls = await store.listPlanCalls('2026-11-07-mis');
      assert.equal(misCalls.length, 1);
      assert.equal(misCalls[0].routed_model, 'ag/gemini-4-argon-high');
      assert.equal(misCalls[0].applied_model, null);
      assert.equal(misCalls[0].mismatch, true, '14: orchestration layer must record mismatch=true');
      assert.ok((await store.countMismatches24h()) >= 1);
    } finally {
      stripOrchHeaderInTransit = false;
      await store.putSettings({ rewrite_mode: 'body' });
    }

    // =========================================================================
    // Scenario 15: Direct request to connection_layer without `x-orch-model` ->
    //   body untouched, zero `x-orch-*` headers on response
    // =========================================================================
    r9Received.length = 0;
    const directPayload = Buffer.from(JSON.stringify({
      model: 'direct/test-model',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hello connection layer directly' }] }],
    }), 'utf8');
    const res15 = await sendHttpRequest(conn.url, 'POST', '/v1/responses', directPayload);
    assert.equal(res15.status, 200);
    assert.equal(Buffer.compare(r9Received[0].raw, directPayload), 0, '15: direct connection_layer request payload untouched');
    const orchHeadersOnRes15 = Object.keys(res15.headers).filter(k => k.toLowerCase().startsWith('x-orch-'));
    assert.deepEqual(orchHeadersOnRes15, [], '15: zero x-orch-* response headers when x-orch-model absent');

    // Bonus sanity: Admin dry-run endpoint (`POST /orch/api/route/dry-run`) matches evaluateRequest without hitting upstream
    const beforeR9Count = r9Received.length;
    const dryRes = await sendHttpRequest(orch.url, 'POST', '/orch/api/route/dry-run', {
      text: '[[ORCH v=1 plan=2026-11-07-dry task=T4 role=fixer agent=oai/gpt-5-fixer attempt=2]]\nFix failing test',
    });
    assert.equal(dryRes.status, 200);
    assert.equal(dryRes.json.kind, 'SUBAGENT');
    assert.equal(dryRes.json.routedModel, 'oai/gpt-5-fixer');
    assert.equal(r9Received.length, beforeR9Count, 'dry-run must never hit upstream');

    // Layer isolation sanity: :20131 serves Orch dashboard on /dashboard (not Valiant), and forwards /v1/models downstream
    const orchDash = await sendHttpRequest(orch.url, 'GET', '/dashboard', null);
    assert.equal(orchDash.status, 200);
    assert.ok(orchDash.text.includes('Orch - orchestration layer'), ':20131/dashboard serves Orch UI, not Valiant');
    const ctxLeak = await sendHttpRequest(orch.url, 'GET', '/context-health', null);
    assert.equal(ctxLeak.status, 404, 'Valiant internal routes do not bleed onto :20131');
    const modelsPass = await sendHttpRequest(orch.url, 'GET', '/v1/models', null);
    assert.equal(modelsPass.status, 200, 'OpenAI /v1/models passes through :20131 -> :20130 -> :20129 -> :20128');

    // Equal peer pool sanity: choosing orchestrator at /orch-plan time (`body.model` or `/orch-plan @<model>`) with zero backup/fallback chains
    await store.patchModel('zd/gpt-6.1-sol', {
      isActive: false, roles: ['orchestrator'],
    }).catch(async () => {
      await store.applySyncPayload([
        ...store.listCachedModels().map(m => m.rawJson),
        {
          id: 'zd/gpt-6.1-sol',
          object: 'model',
          owned_by: 'zd',
          capabilities: { vision: true, pdf: true, tools: true, reasoning: true, contextWindow: 400000, maxOutput: 64000 },
        },
      ]);
    });
    await store.patchModel('zd/gpt-6.1-sol', { isActive: true, roles: ['orchestrator'], tier: 'strong', priority: 25 });
    await store.putSettings({ orchestrator_model: '', orchestrator_chain: [], worker_fallback_chain: [], fixer_chain: [] });

    // 16a: IDE picker set to `zd/gpt-6.1-sol` + `/orch-plan` -> uses `zd/gpt-6.1-sol` (NOT top priority `ag/claude-opus-4-6-thinking`)
    const chosenByIde = await sendHttpRequest(orch.url, 'POST', '/orch/api/route/dry-run', {
      body: {
        model: 'zd/gpt-6.1-sol',
        tools: [{ type: 'function', name: 'task' }],
        input: [{ role: 'user', content: [{ type: 'input_text', text: '/orch-plan\nBuild feature' }] }],
      },
    });
    assert.equal(chosenByIde.json.kind, 'ORCH');
    assert.equal(chosenByIde.json.routedModel, 'zd/gpt-6.1-sol', 'uses the active orchestrator selected in IDE');
    assert.match(chosenByIde.json.roster, /orchestrator: zd\/gpt-6\.1-sol/);

    // 16b: Inline `/orch-plan @ag/claude-opus-4-6-thinking` overrides IDE non-orchestrator model with zero backup fallback
    const chosenInline = await sendHttpRequest(orch.url, 'POST', '/orch/api/route/dry-run', {
      body: {
        model: 'muse/muse-spark-1.3',
        tools: [{ type: 'function', name: 'task' }],
        input: [{ role: 'user', content: [{ type: 'input_text', text: '/orch-plan @ag/claude-opus-4-6-thinking\nBuild feature' }] }],
      },
    });
    assert.equal(chosenInline.json.kind, 'ORCH');
    assert.equal(chosenInline.json.routedModel, 'ag/claude-opus-4-6-thinking');

    // 16c: Inline `/orch-plan @unknown/orch` fails open without silently falling back to another orchestrator
    const badInline = await sendHttpRequest(orch.url, 'POST', '/orch/api/route/dry-run', {
      body: {
        model: 'muse/muse-spark-1.3',
        tools: [{ type: 'function', name: 'task' }],
        input: [{ role: 'user', content: [{ type: 'input_text', text: '/orch-plan @unknown/orch\nBuild feature' }] }],
      },
    });
    assert.equal(badInline.json.failOpen, true);
    assert.equal(badInline.json.routedModel, null);

    // 16d: Empty worker_fallback_chain still recovers invalid subagent marker from active worker pool
    const peerRes = await sendHttpRequest(orch.url, 'POST', '/orch/api/route/dry-run', {
      text: '[[ORCH v=1 plan=2026-11-07-peer task=T1 role=worker agent=typo/non-existent attempt=1]]\nRun task on peer pool',
    });
    assert.equal(peerRes.status, 200);
    assert.ok(
      peerRes.json.routedModel === 'kr/qwen-coder-fast' || peerRes.json.routedModel === 'ag/gemini-4-argon-high',
      'empty worker_fallback_chain falls back automatically to active worker pool'
    );
    assert.equal(peerRes.json.fallbackReason, 'unknown_id');
  } finally {
    await orch.close();
    await hopSpy.close();
    await ctx.close();
    await conn.close();
    await mock9.close();
  }

  console.log('PASS: pipeline.test.js (all 15 scenarios verified)');
})();
