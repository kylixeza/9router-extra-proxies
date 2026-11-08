'use strict';
const http = require('http');
const https = require('https');
const pathMod = require('path');

const env = (k, d) => process.env[k] ?? d;
const num = (k, d) => { const v = parseInt(process.env[k] ?? '', 10); return Number.isFinite(v) ? v : d; };
const flag = (k, d) => { const v = process.env[k]; return v === undefined ? d : /^(1|true|yes|on)$/i.test(v); };

const VALID_ROLES = ['orchestrator', 'worker', 'fixer', 'reviewer', 'summarizer'];
const VALID_TIERS = ['fast', 'balanced', 'strong'];
const VALID_REWRITE_MODES = ['body', 'header'];

const DEFAULT_SETTINGS = {
  enabled: true,
  trigger_command: '/orch-plan',
  off_command: '/orch-off',
  orchestrator_model: '',
  orchestrator_chain: [],
  worker_fallback_chain: [],
  fixer_chain: [],
  max_attempts: 3,
  max_parallel: 3,
  inject_roster: true,
  rewrite_mode: 'body',
  spread_load: true,
};

const CFG = {
  port: num('ORCH_PORT', 20131),
  upstream: env('ORCH_UPSTREAM', 'http://127.0.0.1:20130'),
  router9Url: env('ORCH_9ROUTER_URL', 'http://127.0.0.1:20128'),
  router9ApiKey: env('ORCH_9ROUTER_API_KEY', ''),
  router9SqlitePath: env('ORCH_9ROUTER_SQLITE', pathMod.join(process.env.HOME || '', '.9router/db/data.sqlite')),
  syncTimeoutMs: num('ORCH_SYNC_TIMEOUT_MS', 10000),
  maxBodyBytes: num('ORCH_MAX_BODY_BYTES', 25 * 1024 * 1024),
  adminMaxBytes: num('ORCH_ADMIN_MAX_BYTES', 1 * 1024 * 1024),
};

const upstreamUrl = new URL(CFG.upstream);
const isHttps = upstreamUrl.protocol === 'https:';
const transport = isHttps ? https : http;
const agent = new (isHttps ? https.Agent : http.Agent)({ keepAlive: true, maxSockets: 64 });

function resolve9RouterApiKey(incomingAuth) {
  if (CFG.router9ApiKey) return `Bearer ${CFG.router9ApiKey.replace(/^Bearer\s+/i, '')}`;
  if (incomingAuth && /^Bearer\s+\S+/i.test(incomingAuth)) return incomingAuth;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(CFG.router9SqlitePath, { readOnly: true });
    try {
      const row = db.prepare('SELECT key FROM apiKeys WHERE isActive=1 LIMIT 1').get();
      if (row && row.key) return `Bearer ${row.key}`;
    } finally {
      db.close();
    }
  } catch (_) {}
  return '';
}

function guessFamily(modelId) {
  const s = String(modelId || '').toLowerCase();
  if (s.includes('claude') || s.includes('sonnet') || s.includes('opus') || s.includes('haiku')) return 'claude';
  if (s.includes('gemini') || s.includes('argon')) return 'gemini';
  if (s.includes('gpt') || /\bo[134]\b/.test(s) || s.includes('codex')) return 'gpt';
  if (s.includes('glm')) return 'glm';
  if (s.includes('qwen')) return 'qwen';
  if (s.includes('deepseek')) return 'deepseek';
  if (s.includes('kimi') || s.includes('moonshot')) return 'kimi';
  if (s.includes('llama')) return 'llama';
  if (s.includes('mistral') || s.includes('codestral')) return 'mistral';
  if (s.includes('muse')) return 'muse';
  return null;
}

module.exports = {
  env,
  num,
  flag,
  CFG,
  VALID_ROLES,
  VALID_TIERS,
  VALID_REWRITE_MODES,
  DEFAULT_SETTINGS,
  upstreamUrl,
  isHttps,
  transport,
  agent,
  resolve9RouterApiKey,
  guessFamily,
};
