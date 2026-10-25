'use strict';
const http = require('http');
const https = require('https');
const pathMod = require('path');

const env = (k, d) => process.env[k] ?? d;
const num = (k, d) => { const v = parseInt(process.env[k] ?? '', 10); return Number.isFinite(v) ? v : d; };
const flag = (k, d) => { const v = process.env[k]; return v === undefined ? d : /^(1|true|yes|on)$/i.test(v); };
const jsonEnv = (k, d) => {
  if (!process.env[k]) return d;
  try { return JSON.parse(process.env[k]); } catch { console.error(`[config] invalid JSON in ${k}, ignoring`); return d; }
};

const CFG = {
  target: env('TARGET_URL', 'http://127.0.0.1:20128'),
  port: num('PORT', 20129),
  maxBodyBytes: num('MAX_BODY_BYTES', 25 * 1024 * 1024),
  retries: num('MAX_RETRIES', 2),
  ttfbMs: num('TTFB_TIMEOUT_MS', 300000),
  modelsTtlMs: num('MODELS_TTL_MS', 60000),
  dedupTtlMs: num('DEDUP_TTL_MS', 8000),
  dedupMax: num('DEDUP_MAX_ENTRIES', 20),
  dedupDeterministicOnly: flag('DEDUP_DETERMINISTIC_ONLY', false),
  aliases: jsonEnv('MODEL_ALIASES', {}),
  fallbacks: jsonEnv('MODEL_FALLBACKS', {}),
  defaults: jsonEnv('REQUEST_DEFAULTS', {}),
  dropParams: jsonEnv('DROP_PARAMS', {}),
  logDir: env('LOG_DIR', pathMod.join(__dirname, '..', 'logs')),
  logKeep: num('LOG_KEEP', 50),
  logBodies: flag('LOG_BODIES', true),
};

const RETRYABLE = new Set([429, 502, 503, 504, 529]);
const targetUrl = new URL(CFG.target);
const isHttps = targetUrl.protocol === 'https:';
const transport = isHttps ? https : http;
const agent = new (isHttps ? https.Agent : http.Agent)({ keepAlive: true, maxSockets: 64 });

module.exports = { env, num, flag, jsonEnv, CFG, RETRYABLE, targetUrl, isHttps, transport, agent };
