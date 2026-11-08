'use strict';
// ponytail: one-off T0 extractor from live PG proxy_logs + 9router :20128/v1/models.
const fs = require('fs');
const pathMod = require('path');
const http = require('http');
const { DatabaseSync } = require('node:sqlite');
const store = require('../../storage_layer/store');

const OUT = __dirname;

function shrinkInstruction(s) {
  if (typeof s !== 'string' || s.length <= 1600) return s;
  return s.slice(0, 1200) + '\n...[truncated for fixture; includes example marker [[ORCH v=1 plan=<id> task=<T-id> role=worker agent=<id> attempt=1]]]...\n' + s.slice(-300);
}

function shrinkTools(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.slice(0, 6).map(t => ({
    type: t.type,
    name: t.name || (t.function && t.function.name),
    description: String(t.description || (t.function && t.function.description) || '').slice(0, 120),
    parameters: { type: 'object', properties: {} },
  }));
}

function sanitizeBody(body) {
  const b = JSON.parse(JSON.stringify(body));
  if (b.instructions) b.instructions = shrinkInstruction(b.instructions);
  if (b.tools) b.tools = shrinkTools(b.tools);
  if (Array.isArray(b.input)) {
    b.input = b.input.map(it => {
      if (!it || typeof it !== 'object') return it;
      const copy = { ...it };
      if (Array.isArray(copy.content)) {
        copy.content = copy.content.map(c => {
          if (!c || typeof c.text !== 'string') return c;
          const idx = c.text.lastIndexOf('</ide-context>');
          if (idx > 600) {
            return { ...c, text: c.text.slice(0, 400) + '\n...[ide-context truncated]...\n' + c.text.slice(idx) };
          }
          return c.text.length > 1500 ? { ...c, text: c.text.slice(0, 1500) + '…' } : c;
        });
      }
      if (typeof copy.output === 'string' && copy.output.length > 600) copy.output = copy.output.slice(0, 600) + '…';
      return copy;
    });
  }
  return b;
}

function fetch9RouterModels() {
  let key = process.env.ORCH_9ROUTER_API_KEY || '';
  if (!key) {
    try {
      const db = new DatabaseSync(pathMod.join(process.env.HOME, '.9router/db/data.sqlite'), { readOnly: true });
      const row = db.prepare('SELECT key FROM apiKeys WHERE isActive=1 LIMIT 1').get();
      db.close();
      if (row) key = row.key;
    } catch (_) {}
  }
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:20128/v1/models', {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      timeout: 5000,
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
  });
}

(async () => {
  // 1. Normal IDE conversation turn (recent short input[] without /plan or set_plan_state)
  const normalRow = await store.query(`
    SELECT id, request FROM (
      SELECT id, request FROM proxy_logs
      WHERE path = '/v1/responses'
      ORDER BY created_at DESC LIMIT 20
    ) s
    WHERE jsonb_typeof(request->'input') = 'array'
      AND jsonb_array_length(request->'input') BETWEEN 1 AND 5
    LIMIT 1
  `);

  // 2. Plan conversation turn (contains set_plan_state + task calls)
  const planRow = await store.query(`SELECT id, request FROM proxy_logs WHERE id = '6239bcd36b'`);

  // 3. Sub-agent turn from task tool (no 'task' tool in tools[])
  const subRow = await store.query(`SELECT id, request FROM proxy_logs WHERE id = '9782dc9af4'`);

  if (!normalRow.rows[0] || !planRow.rows[0] || !subRow.rows[0]) {
    throw new Error('Missing expected rows in proxy_logs');
  }

  const normal = sanitizeBody(normalRow.rows[0].request);
  fs.writeFileSync(pathMod.join(OUT, 'normal.json'), JSON.stringify(normal, null, 2));

  // Build orch-plan fixture from real plan conversation (before COMPLETED, with /orch-plan user query)
  const orchPlan = sanitizeBody(planRow.rows[0].request);
  const completedIdx = orchPlan.input.findIndex(it => it && it.type === 'function_call' && it.name === 'set_plan_state' && String(it.arguments || '').includes('COMPLETED'));
  if (completedIdx > 0) orchPlan.input = orchPlan.input.slice(0, completedIdx);
  const firstUser = orchPlan.input.find(it => it && it.role === 'user');
  if (firstUser && Array.isArray(firstUser.content) && firstUser.content[0]) {
    const t = firstUser.content[0].text;
    const k = t.lastIndexOf('</ide-context>');
    firstUser.content[0].text = k >= 0
      ? t.slice(0, k + '</ide-context>'.length) + '\n\n/orch-plan\n\nBuild weekly verification chart on home page'
      : '/orch-plan\n\n' + t;
  }
  fs.writeFileSync(pathMod.join(OUT, 'orch-plan.json'), JSON.stringify(orchPlan, null, 2));

  // Build subagent fixture from real task sub-agent request, adding strict marker at prompt start after </ide-context>
  const subagent = sanitizeBody(subRow.rows[0].request);
  subagent.input = subagent.input.slice(0, 3);
  if (subagent.input[0] && Array.isArray(subagent.input[0].content) && subagent.input[0].content[0]) {
    const t = subagent.input[0].content[0].text;
    const k = t.lastIndexOf('</ide-context>');
    const marker = '[[ORCH v=1 plan=2026-11-07-weekly-chart task=T3 role=worker agent=ag/gemini-4-argon-high attempt=1]]\n';
    subagent.input[0].content[0].text = k >= 0
      ? t.slice(0, k + '</ide-context>'.length) + '\n\n' + marker + t.slice(k + '</ide-context>'.length).trimStart()
      : marker + t;
  }
  fs.writeFileSync(pathMod.join(OUT, 'subagent-task.json'), JSON.stringify(subagent, null, 2));

  const modelsRes = await fetch9RouterModels();
  const list = Array.isArray(modelsRes) ? modelsRes : (modelsRes.data || []);
  const picked = list.slice(0, 8);
  // Add synthetic edge-case entries for tests (missing capabilities, thinkingEffortSupported=false)
  picked.push(
    { id: 'test/no-caps-model', object: 'model', owned_by: 'test' },
    {
      id: 'test/no-tools-no-vision',
      object: 'model',
      owned_by: 'test',
      capabilities: { vision: false, pdf: false, tools: false, reasoning: false, thinkingEffortSupported: false, thinkingRange: null, contextWindow: 64000, maxOutput: 4096 },
      context_length: 64000,
      max_completion_tokens: 4096,
    }
  );
  fs.writeFileSync(pathMod.join(OUT, 'models-sample.json'), JSON.stringify({ object: 'list', data: picked }, null, 2));

  console.log('Fixtures written:', {
    normalId: normalRow.rows[0].id,
    planId: planRow.rows[0].id,
    subId: subRow.rows[0].id,
    modelsCount: picked.length,
  });
  await store.close();
})();
