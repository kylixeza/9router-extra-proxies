'use strict';
// ponytail: warm in-memory cache backed by PostgreSQL (`storage_layer/store`).
// Hot path (`getModel`, `listCachedModels`, `getSettings`) reads memory synchronously in <0.1ms;
// DB outages fail open without blocking streaming.
const { DEFAULT_SETTINGS, VALID_ROLES, VALID_TIERS, VALID_REWRITE_MODES, guessFamily } = require('./config');

const boolOrNull = v => (typeof v === 'boolean' ? v : v === 1 ? true : v === 0 ? false : null);
const intOrNull = v => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);

function map9RouterModel(raw) {
  const c = (raw && typeof raw.capabilities === 'object' && raw.capabilities) || {};
  return {
    id: String(raw.id),
    object: raw.object != null ? String(raw.object) : null,
    ownedBy: raw.owned_by != null ? String(raw.owned_by) : null,
    capVision: boolOrNull(c.vision),
    capPdf: boolOrNull(c.pdf),
    capAudioInput: boolOrNull(c.audioInput),
    capVideoInput: boolOrNull(c.videoInput),
    capImageOutput: boolOrNull(c.imageOutput),
    capAudioOutput: boolOrNull(c.audioOutput),
    capSearch: boolOrNull(c.search),
    capTools: boolOrNull(c.tools),
    capReasoning: boolOrNull(c.reasoning),
    thinkingFormat: c.thinkingFormat != null ? String(c.thinkingFormat) : null,
    thinkingCanDisable: boolOrNull(c.thinkingCanDisable),
    thinkingRange: c.thinkingRange !== undefined ? c.thinkingRange : null,
    thinkingEffortSupported: boolOrNull(c.thinkingEffortSupported),
    contextWindow: intOrNull(c.contextWindow),
    maxOutput: intOrNull(c.maxOutput),
    contextLength: intOrNull(raw.context_length),
    maxCompletionTokens: intOrNull(raw.max_completion_tokens),
    rawJson: raw,
  };
}

function rowToModel(r) {
  return {
    id: r.id,
    object: r.object ?? null,
    ownedBy: r.owned_by ?? r.ownedBy ?? null,
    capVision: r.cap_vision ?? r.capVision ?? null,
    capPdf: r.cap_pdf ?? r.capPdf ?? null,
    capAudioInput: r.cap_audio_input ?? r.capAudioInput ?? null,
    capVideoInput: r.cap_video_input ?? r.capVideoInput ?? null,
    capImageOutput: r.cap_image_output ?? r.capImageOutput ?? null,
    capAudioOutput: r.cap_audio_output ?? r.capAudioOutput ?? null,
    capSearch: r.cap_search ?? r.capSearch ?? null,
    capTools: r.cap_tools ?? r.capTools ?? null,
    capReasoning: r.cap_reasoning ?? r.capReasoning ?? null,
    thinkingFormat: r.thinking_format ?? r.thinkingFormat ?? null,
    thinkingCanDisable: r.thinking_can_disable ?? r.thinkingCanDisable ?? null,
    thinkingRange: r.thinking_range !== undefined ? r.thinking_range : (r.thinkingRange ?? null),
    thinkingEffortSupported: r.thinking_effort_supported ?? r.thinkingEffortSupported ?? null,
    contextWindow: r.context_window ?? r.contextWindow ?? null,
    maxOutput: r.max_output ?? r.maxOutput ?? null,
    contextLength: r.context_length ?? r.contextLength ?? null,
    maxCompletionTokens: r.max_completion_tokens ?? r.maxCompletionTokens ?? null,
    rawJson: typeof r.raw_json === 'string' ? JSON.parse(r.raw_json) : (r.raw_json ?? r.rawJson ?? {}),
    available: Boolean(r.available ?? true),
    firstSeenAt: r.first_seen_at ? new Date(r.first_seen_at).toISOString() : (r.firstSeenAt || new Date().toISOString()),
    lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : (r.lastSyncedAt || new Date().toISOString()),
    isActive: Boolean(r.is_active ?? r.isActive ?? false),
    roles: Array.isArray(r.roles) ? [...r.roles] : (typeof r.roles === 'string' ? JSON.parse(r.roles) : []),
    tier: r.tier ?? null,
    family: r.family ?? null,
    priority: Number.isFinite(r.priority) ? r.priority : 100,
    isDefaultWorker: Boolean(r.is_default_worker ?? r.isDefaultWorker ?? false),
    notes: r.notes ?? null,
  };
}

function validateRoles(roles) {
  if (!Array.isArray(roles)) throw Object.assign(new Error('roles must be an array'), { status: 400 });
  const out = [];
  for (const r of roles) {
    const s = String(r || '').trim();
    if (!VALID_ROLES.includes(s)) throw Object.assign(new Error(`invalid role: ${s}`), { status: 400 });
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

const TOOL_ROLES = new Set(['orchestrator', 'worker', 'fixer']);

function validateActivation(model, nextActive, nextRoles) {
  if (nextActive && nextRoles.some(r => TOOL_ROLES.has(r)) && model.capTools === false) {
    throw Object.assign(
      new Error(`Model ${model.id} has cap_tools=false and cannot be activated for role ${nextRoles.filter(r => TOOL_ROLES.has(r)).join('/')}`),
      { status: 400 }
    );
  }
}

function createStore(opts = {}) {
  const pg = opts.pg !== undefined ? opts.pg : require('../storage_layer/store');
  const models = new Map();
  let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  let callsMem = []; // used when pg is null (hermetic tests) and for fast recent fallback
  const inflightCalls = new Map();
  let nextInflightId = 1;
  let lastSyncMeta = null;
  let loaded = false;

  const hasPg = () => Boolean(pg && pg.isEnabled && pg.isEnabled());

  async function init() {
    if (!hasPg()) { loaded = true; return; }
    await pg.ensureSchema();
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await pg.query(
        `INSERT INTO orch_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO NOTHING`,
        [k, JSON.stringify(v)]
      );
    }
    await reload();
    loaded = true;
  }

  async function reload() {
    if (!hasPg()) return;
    const [mRes, sRes] = await Promise.all([
      pg.query(`SELECT * FROM orch_models ORDER BY priority ASC, id ASC`),
      pg.query(`SELECT key, value FROM orch_settings`),
    ]);
    if (mRes && Array.isArray(mRes.rows)) {
      models.clear();
      for (const row of mRes.rows) {
        const m = rowToModel(row);
        models.set(m.id, m);
      }
    }
    if (sRes && Array.isArray(sRes.rows)) {
      const next = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      for (const row of sRes.rows) {
        if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, row.key)) {
          next[row.key] = row.value;
        }
      }
      settings = next;
    }
  }

  function getModel(id) {
    return models.get(id) || null;
  }

  function listCachedModels() {
    return [...models.values()].sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id));
  }

  function listModels(filter = {}) {
    let list = listCachedModels();
    if (filter.role) list = list.filter(m => m.roles.includes(filter.role));
    if (filter.active === 'true' || filter.active === true || filter.active === '1') list = list.filter(m => m.isActive);
    else if (filter.active === 'false' || filter.active === false || filter.active === '0') list = list.filter(m => !m.isActive);
    if (filter.available === 'true' || filter.available === '1') list = list.filter(m => m.available);
    else if (filter.available === 'false' || filter.available === '0') list = list.filter(m => !m.available);
    if (filter.q) {
      const q = String(filter.q).toLowerCase();
      list = list.filter(m =>
        m.id.toLowerCase().includes(q)
        || (m.family && m.family.toLowerCase().includes(q))
        || (m.ownedBy && m.ownedBy.toLowerCase().includes(q))
        || (m.notes && m.notes.toLowerCase().includes(q)));
    }
    if (filter.cap) {
      const caps = String(filter.cap).split(',').map(s => s.trim()).filter(Boolean);
      const capMap = {
        tools: 'capTools',
        vision: 'capVision',
        pdf: 'capPdf',
        reasoning: 'capReasoning',
        search: 'capSearch',
      };
      for (const c of caps) {
        const key = capMap[c];
        if (key) list = list.filter(m => m[key] === true);
      }
    }
    return list;
  }

  async function applySyncPayload(rawItems) {
    const now = new Date().toISOString();
    const parsed = [];
    const seen = new Set();
    for (const item of rawItems) {
      if (!item || typeof item !== 'object' || !item.id || typeof item.id !== 'string') continue;
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      parsed.push(map9RouterModel(item));
    }

    let added = 0, updated = 0, unavailable = 0;
    for (const m of parsed) {
      if (models.has(m.id)) updated++;
      else added++;
    }
    for (const existing of models.values()) {
      if (!seen.has(existing.id) && existing.available) unavailable++;
    }

    if (hasPg()) {
      const pool = pg.getPool && pg.getPool();
      if (!pool) throw Object.assign(new Error('PostgreSQL pool unavailable'), { status: 500 });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const m of parsed) {
          const fam = guessFamily(m.id);
          await client.query(
            `INSERT INTO orch_models (
              id, object, owned_by,
              cap_vision, cap_pdf, cap_audio_input, cap_video_input, cap_image_output, cap_audio_output,
              cap_search, cap_tools, cap_reasoning,
              thinking_format, thinking_can_disable, thinking_range, thinking_effort_supported,
              context_window, max_output, context_length, max_completion_tokens,
              raw_json, available, first_seen_at, last_synced_at,
              is_active, roles, family, priority, is_default_worker
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21::jsonb,TRUE,now(),now(),
              FALSE,'[]'::jsonb,$22,100,FALSE
            )
            ON CONFLICT (id) DO UPDATE SET
              object = EXCLUDED.object,
              owned_by = EXCLUDED.owned_by,
              cap_vision = EXCLUDED.cap_vision,
              cap_pdf = EXCLUDED.cap_pdf,
              cap_audio_input = EXCLUDED.cap_audio_input,
              cap_video_input = EXCLUDED.cap_video_input,
              cap_image_output = EXCLUDED.cap_image_output,
              cap_audio_output = EXCLUDED.cap_audio_output,
              cap_search = EXCLUDED.cap_search,
              cap_tools = EXCLUDED.cap_tools,
              cap_reasoning = EXCLUDED.cap_reasoning,
              thinking_format = EXCLUDED.thinking_format,
              thinking_can_disable = EXCLUDED.thinking_can_disable,
              thinking_range = EXCLUDED.thinking_range,
              thinking_effort_supported = EXCLUDED.thinking_effort_supported,
              context_window = EXCLUDED.context_window,
              max_output = EXCLUDED.max_output,
              context_length = EXCLUDED.context_length,
              max_completion_tokens = EXCLUDED.max_completion_tokens,
              raw_json = EXCLUDED.raw_json,
              available = TRUE,
              last_synced_at = now(),
              family = COALESCE(NULLIF(orch_models.family, ''), EXCLUDED.family)`,
            [
              m.id, m.object, m.ownedBy,
              m.capVision, m.capPdf, m.capAudioInput, m.capVideoInput, m.capImageOutput, m.capAudioOutput,
              m.capSearch, m.capTools, m.capReasoning,
              m.thinkingFormat, m.thinkingCanDisable, JSON.stringify(m.thinkingRange), m.thinkingEffortSupported,
              m.contextWindow, m.maxOutput, m.contextLength, m.maxCompletionTokens,
              JSON.stringify(m.rawJson), fam,
            ]
          );
        }
        const ids = [...seen];
        if (ids.length) {
          await client.query(`UPDATE orch_models SET available = FALSE WHERE NOT (id = ANY($1::text[]))`, [ids]);
        } else {
          await client.query(`UPDATE orch_models SET available = FALSE`);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      await reload();
    } else {
      for (const m of parsed) {
        const cur = models.get(m.id);
        if (cur) {
          models.set(m.id, {
            ...cur,
            ...m,
            available: true,
            lastSyncedAt: now,
            isActive: cur.isActive,
            roles: cur.roles,
            tier: cur.tier,
            family: cur.family || guessFamily(m.id),
            priority: cur.priority,
            isDefaultWorker: cur.isDefaultWorker,
            notes: cur.notes,
          });
        } else {
          models.set(m.id, {
            ...m,
            available: true,
            firstSeenAt: now,
            lastSyncedAt: now,
            isActive: false,
            roles: [],
            tier: null,
            family: guessFamily(m.id),
            priority: 100,
            isDefaultWorker: false,
            notes: null,
          });
        }
      }
      for (const cur of models.values()) {
        if (!seen.has(cur.id)) cur.available = false;
      }
    }

    lastSyncMeta = { added, updated, unavailable, total: models.size, syncedAt: now };
    return lastSyncMeta;
  }

  async function patchModel(id, patch = {}) {
    const cur = models.get(id);
    if (!cur) throw Object.assign(new Error(`model not found: ${id}`), { status: 404 });

    const nextRoles = patch.roles !== undefined ? validateRoles(patch.roles) : cur.roles;
    const nextActive = patch.isActive !== undefined ? Boolean(patch.isActive) : cur.isActive;
    validateActivation(cur, nextActive, nextRoles);

    let nextTier = cur.tier;
    if (patch.tier !== undefined) {
      if (patch.tier === null || patch.tier === '') nextTier = null;
      else if (VALID_TIERS.includes(patch.tier)) nextTier = patch.tier;
      else throw Object.assign(new Error(`invalid tier: ${patch.tier}`), { status: 400 });
    }
    const nextFamily = patch.family !== undefined ? (patch.family ? String(patch.family).trim() : null) : cur.family;
    const nextPriority = patch.priority !== undefined ? (Number.isFinite(Number(patch.priority)) ? Math.trunc(Number(patch.priority)) : cur.priority) : cur.priority;
    const nextDefaultWorker = patch.isDefaultWorker !== undefined ? Boolean(patch.isDefaultWorker) : cur.isDefaultWorker;
    const nextNotes = patch.notes !== undefined ? (patch.notes === null || patch.notes === '' ? null : String(patch.notes)) : cur.notes;

    if (nextDefaultWorker) {
      for (const other of models.values()) {
        if (other.id !== id && other.isDefaultWorker) other.isDefaultWorker = false;
      }
    }

    const updated = {
      ...cur,
      isActive: nextActive,
      roles: nextRoles,
      tier: nextTier,
      family: nextFamily,
      priority: nextPriority,
      isDefaultWorker: nextDefaultWorker,
      notes: nextNotes,
    };
    models.set(id, updated);

    if (hasPg()) {
      if (nextDefaultWorker) {
        await pg.query(`UPDATE orch_models SET is_default_worker = FALSE WHERE id <> $1 AND is_default_worker = TRUE`, [id]);
      }
      await pg.query(
        `UPDATE orch_models
         SET is_active = $2, roles = $3::jsonb, tier = $4, family = $5, priority = $6, is_default_worker = $7, notes = $8
         WHERE id = $1`,
        [id, updated.isActive, JSON.stringify(updated.roles), updated.tier, updated.family, updated.priority, updated.isDefaultWorker, updated.notes]
      );
    }

    const warnings = [];
    if (updated.isActive && updated.roles.some(r => TOOL_ROLES.has(r)) && updated.capTools === null) {
      warnings.push('cap_tools is unknown (NULL); verify model supports function calling');
    }
    return { model: updated, warnings };
  }

  async function bulkUpdateModels(ids, op = {}) {
    if (!Array.isArray(ids) || !ids.length) throw Object.assign(new Error('ids array required'), { status: 400 });
    const results = [];
    const skipped = [];
    for (const id of ids) {
      const cur = models.get(id);
      if (!cur) { skipped.push({ id, reason: 'not_found' }); continue; }
      const patch = {};
      if (op.isActive !== undefined) patch.isActive = Boolean(op.isActive);
      if (op.roles !== undefined) patch.roles = op.roles;
      if (op.addRole) {
        const r = String(op.addRole).trim();
        if (!VALID_ROLES.includes(r)) throw Object.assign(new Error(`invalid role: ${r}`), { status: 400 });
        patch.roles = cur.roles.includes(r) ? cur.roles : [...cur.roles, r];
      }
      if (op.removeRole) {
        patch.roles = cur.roles.filter(r => r !== op.removeRole);
      }
      if (op.tier !== undefined) patch.tier = op.tier;
      try {
        const r = await patchModel(id, patch);
        results.push(r.model);
      } catch (err) {
        skipped.push({ id, reason: err.message });
      }
    }
    return { updated: results.length, skipped };
  }

  function getSettings() {
    return JSON.parse(JSON.stringify(settings));
  }

  async function putSettings(partial = {}) {
    const next = { ...settings };
    if (partial.enabled !== undefined) next.enabled = Boolean(partial.enabled);
    if (partial.trigger_command !== undefined) {
      const s = String(partial.trigger_command).trim();
      if (!s) throw Object.assign(new Error('trigger_command cannot be empty'), { status: 400 });
      next.trigger_command = s;
    }
    if (partial.off_command !== undefined) {
      const s = String(partial.off_command).trim();
      if (!s) throw Object.assign(new Error('off_command cannot be empty'), { status: 400 });
      next.off_command = s;
    }
    if (partial.orchestrator_model !== undefined) {
      next.orchestrator_model = partial.orchestrator_model ? String(partial.orchestrator_model).trim() : '';
    }
    for (const chainKey of ['orchestrator_chain', 'worker_fallback_chain', 'fixer_chain']) {
      if (partial[chainKey] !== undefined) {
        if (!Array.isArray(partial[chainKey])) throw Object.assign(new Error(`${chainKey} must be an array`), { status: 400 });
        next[chainKey] = [...new Set(partial[chainKey].map(x => String(x || '').trim()).filter(Boolean))];
      }
    }
    if (partial.spread_load !== undefined) next.spread_load = Boolean(partial.spread_load);
    if (partial.max_attempts !== undefined) {
      const n = Math.trunc(Number(partial.max_attempts));
      if (!Number.isFinite(n) || n < 1 || n > 10) throw Object.assign(new Error('max_attempts must be 1..10'), { status: 400 });
      next.max_attempts = n;
    }
    if (partial.max_parallel !== undefined) {
      const n = Math.trunc(Number(partial.max_parallel));
      if (!Number.isFinite(n) || n < 1 || n > 16) throw Object.assign(new Error('max_parallel must be 1..16'), { status: 400 });
      next.max_parallel = n;
    }
    if (partial.inject_roster !== undefined) next.inject_roster = Boolean(partial.inject_roster);
    if (partial.rewrite_mode !== undefined) {
      if (!VALID_REWRITE_MODES.includes(partial.rewrite_mode)) {
        throw Object.assign(new Error(`rewrite_mode must be body or header`), { status: 400 });
      }
      next.rewrite_mode = partial.rewrite_mode;
    }

    settings = next;
    if (hasPg()) {
      for (const [k, v] of Object.entries(next)) {
        await pg.query(
          `INSERT INTO orch_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [k, JSON.stringify(v)]
        );
      }
    }
    return getSettings();
  }

  // ponytail: in-memory live calls expire after five minutes; use shared storage for multi-process tracking.
  function pruneInflight(nowMs) {
    for (const [id, item] of inflightCalls) {
      if (nowMs - item.startedAtMs > 300000) inflightCalls.delete(id);
    }
  }

  function beginCall(entry = {}) {
    if (!entry || entry.kind === 'passthrough' || entry.kind === 'PASSTHROUGH') return null;
    const nowMs = Date.now();
    pruneInflight(nowMs);
    const callId = `live-${nowMs}-${nextInflightId++}`;
    inflightCalls.set(callId, {
      call_id: callId,
      started_at: new Date(nowMs).toISOString(),
      startedAtMs: nowMs,
      kind: entry.kind || 'subagent',
      plan_id: entry.planId || null,
      task_key: entry.taskKey || null,
      attempt: entry.attempt ?? null,
      role: entry.role || (entry.kind === 'orchestrator' || entry.kind === 'ORCH' ? 'orchestrator' : 'worker'),
      requested_model: entry.requestedModel || null,
      routed_model: entry.routedModel || null,
      fallback_reason: entry.fallbackReason || null,
    });
    return callId;
  }

  function endCall(callId) {
    if (callId) inflightCalls.delete(callId);
  }

  function listActiveCalls(recentWindowMs = 30000) {
    const nowMs = Date.now();
    pruneInflight(nowMs);
    const inflight = [...inflightCalls.values()].map(({ startedAtMs, ...item }) => ({
      ...item, elapsed_ms: Math.max(0, nowMs - startedAtMs),
    }));
    const recentCalls = callsMem.filter(c => c.kind !== 'passthrough' && nowMs - Date.parse(c.ts) <= recentWindowMs)
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, 25);
    return { inflight, recentCalls, serverTime: new Date(nowMs).toISOString() };
  }

  function logCall(entry) {
    const row = {
      id: callsMem.length + 1,
      ts: entry.ts || new Date().toISOString(),
      kind: entry.kind || 'passthrough',
      plan_id: entry.planId || null,
      task_key: entry.taskKey || null,
      attempt: entry.attempt ?? null,
      role: entry.role || null,
      requested_model: entry.requestedModel || null,
      routed_model: entry.routedModel || null,
      applied_model: entry.appliedModel || null,
      rewritten_by: entry.rewrittenBy || null,
      fallback_reason: entry.fallbackReason || null,
      mismatch: Boolean(entry.mismatch),
      status: entry.status ?? null,
      latency_ms: entry.latencyMs ?? null,
      ttfb_ms: entry.ttfbMs ?? null,
      input_tokens: entry.inputTokens ?? null,
      output_tokens: entry.outputTokens ?? null,
      error: entry.error || null,
    };
    callsMem.push(row);
    if (callsMem.length > 1000) callsMem = callsMem.slice(-1000);

    if (!hasPg()) return Promise.resolve(row);
    return pg.query(
      `INSERT INTO orch_calls (
        ts, kind, plan_id, task_key, attempt, role,
        requested_model, routed_model, applied_model, rewritten_by, fallback_reason, mismatch,
        status, latency_ms, ttfb_ms, input_tokens, output_tokens, error
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        row.ts, row.kind, row.plan_id, row.task_key, row.attempt, row.role,
        row.requested_model, row.routed_model, row.applied_model, row.rewritten_by, row.fallback_reason, row.mismatch,
        row.status, row.latency_ms, row.ttfb_ms, row.input_tokens, row.output_tokens, row.error,
      ]
    ).catch(err => {
      console.error('[orch-store] logCall failed:', err.message);
      return null;
    });
  }

  async function listPlans(limit = 50) {
    if (hasPg()) {
      const r = await pg.query(
        `SELECT
           COALESCE(plan_id, '__orchestrator__') AS plan_id,
           min(ts) AS started_at,
           max(ts) AS last_at,
           count(DISTINCT task_key) FILTER (WHERE task_key IS NOT NULL) AS task_count,
           count(*)::int AS call_count,
           COALESCE(sum(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::bigint AS total_tokens,
           count(*) FILTER (WHERE fallback_reason IS NOT NULL)::int AS fallback_count,
           count(*) FILTER (WHERE error IS NOT NULL OR (status IS NOT NULL AND status >= 400))::int AS error_count,
           count(*) FILTER (WHERE mismatch = TRUE)::int AS mismatch_count
         FROM orch_calls
         WHERE kind <> 'passthrough'
         GROUP BY COALESCE(plan_id, '__orchestrator__')
         ORDER BY max(ts) DESC
         LIMIT $1`,
        [limit]
      );
      if (r && r.rows) return r.rows;
    }
    const byPlan = new Map();
    for (const c of callsMem) {
      if (c.kind === 'passthrough') continue;
      const pid = c.plan_id || '__orchestrator__';
      let g = byPlan.get(pid);
      if (!g) {
        g = { plan_id: pid, started_at: c.ts, last_at: c.ts, tasks: new Set(), call_count: 0, total_tokens: 0, fallback_count: 0, error_count: 0, mismatch_count: 0 };
        byPlan.set(pid, g);
      }
      if (c.ts < g.started_at) g.started_at = c.ts;
      if (c.ts > g.last_at) g.last_at = c.ts;
      if (c.task_key) g.tasks.add(c.task_key);
      g.call_count++;
      g.total_tokens += (c.input_tokens || 0) + (c.output_tokens || 0);
      if (c.fallback_reason) g.fallback_count++;
      if (c.error || (c.status && c.status >= 400)) g.error_count++;
      if (c.mismatch) g.mismatch_count++;
    }
    return [...byPlan.values()]
      .sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)))
      .slice(0, limit)
      .map(({ tasks, ...rest }) => ({ ...rest, task_count: tasks.size }));
  }

  async function listPlanCalls(planId, limit = 200) {
    const isOrchBucket = !planId || planId === '__orchestrator__';
    if (hasPg()) {
      const r = isOrchBucket
        ? await pg.query(`SELECT * FROM orch_calls WHERE plan_id IS NULL AND kind <> 'passthrough' ORDER BY ts DESC LIMIT $1`, [limit])
        : await pg.query(`SELECT * FROM orch_calls WHERE plan_id = $1 ORDER BY ts ASC LIMIT $2`, [planId, limit]);
      if (r && r.rows) return r.rows;
    }
    return callsMem
      .filter(c => isOrchBucket ? (!c.plan_id && c.kind !== 'passthrough') : c.plan_id === planId)
      .slice(-limit);
  }

  async function countMismatches24h() {
    if (hasPg()) {
      const r = await pg.query(`SELECT count(*)::int AS n FROM orch_calls WHERE mismatch = TRUE AND ts >= now() - interval '24 hours'`);
      if (r && r.rows && r.rows[0]) return r.rows[0].n;
    }
    const cutoff = Date.now() - 86400000;
    return callsMem.filter(c => c.mismatch && Date.parse(c.ts) >= cutoff).length;
  }

  function computeWarnings() {
    const warnings = [];
    const s = settings;
    const all = listCachedModels();
    const activeOrchestrators = all.filter(m => m.isActive && m.available && m.roles.includes('orchestrator') && m.capTools !== false);
    if (!activeOrchestrators.length) {
      warnings.push({ code: 'no_orchestrators', message: 'No active orchestrator model in pool — /orch-plan will fail-open to the original model.' });
    }
    const activeWorkers = all.filter(m => m.isActive && m.available && m.roles.includes('worker') && m.capTools !== false);
    if (!activeWorkers.length) {
      warnings.push({ code: 'no_workers', message: 'No active worker model in pool.' });
    } else if (s.spread_load !== false && activeWorkers.length < 2) {
      warnings.push({ code: 'single_worker_pool', message: 'Only 1 active worker in pool — activate >=2 workers to spread task load across models.' });
    }
    const activeUnavailable = all.filter(m => m.isActive && !m.available);
    if (activeUnavailable.length) {
      warnings.push({ code: 'active_unavailable', message: `Active models no longer available in 9router: ${activeUnavailable.map(m => m.id).join(', ')}` });
    }
    const fixers = all.filter(m => m.isActive && m.available && m.roles.includes('fixer') && m.capTools !== false);
    if (!fixers.length) {
      warnings.push({ code: 'no_fixer', message: 'No active fixer model in pool.' });
    }
    const nullCaps = all.filter(m => m.isActive && (m.capTools === null || m.capVision === null || m.capReasoning === null));
    if (nullCaps.length) {
      warnings.push({ code: 'null_capabilities', message: `NULL (?) capability on active models: ${nullCaps.map(m => m.id).join(', ')}` });
    }
    return warnings;
  }

  return {
    init,
    reload,
    isLoaded: () => loaded,
    hasPg,
    getLastSyncMeta: () => lastSyncMeta,
    getModel,
    listCachedModels,
    listModels,
    applySyncPayload,
    patchModel,
    bulkUpdateModels,
    getSettings,
    putSettings,
    logCall,
    beginCall,
    endCall,
    listActiveCalls,
    listPlans,
    listPlanCalls,
    countMismatches24h,
    computeWarnings,
  };
}

const defaultStore = createStore();

module.exports = { createStore, defaultStore, map9RouterModel, validateRoles };
