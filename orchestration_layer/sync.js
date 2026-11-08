'use strict';
const http = require('http');
const https = require('https');
const { CFG, resolve9RouterApiKey } = require('./config');

function fetch9RouterModels(opts = {}) {
  const baseUrl = opts.router9Url || CFG.router9Url;
  const timeoutMs = opts.timeoutMs || CFG.syncTimeoutMs;
  const auth = resolve9RouterApiKey(opts.authorization);
  const url = new URL('/v1/models', baseUrl);
  const lib = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const headers = { accept: 'application/json' };
    if (auth) headers.authorization = auth;

    const req = lib.request(url, { method: 'GET', headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(Object.assign(
            new Error(`9router tidak terjangkau (HTTP ${res.statusCode}): ${raw.slice(0, 200)}`),
            { status: 502 }
          ));
        }
        try {
          const parsed = JSON.parse(raw);
          const list = Array.isArray(parsed)
            ? parsed
            : (parsed && Array.isArray(parsed.data) ? parsed.data : null);
          if (!list) {
            return reject(Object.assign(new Error('Format respons /v1/models 9router tidak dikenali'), { status: 502 }));
          }
          resolve(list);
        } catch (err) {
          reject(Object.assign(new Error(`Respons /v1/models bukan JSON valid: ${err.message}`), { status: 502 }));
        }
      });
      res.on('error', err => reject(Object.assign(new Error(`9router tidak terjangkau: ${err.message}`), { status: 502 })));
    });

    const timer = setTimeout(() => {
      req.destroy(Object.assign(new Error(`9router tidak terjangkau (timeout ${timeoutMs}ms)`), { status: 502 }));
    }, timeoutMs);

    req.once('response', () => clearTimeout(timer));
    req.once('close', () => clearTimeout(timer));
    req.on('error', err => {
      clearTimeout(timer);
      reject(Object.assign(new Error(err.status === 502 ? err.message : `9router tidak terjangkau: ${err.message}`), { status: 502 }));
    });
    req.end();
  });
}

async function syncModelsFrom9Router(store, opts = {}) {
  const list = await fetch9RouterModels(opts);
  return store.applySyncPayload(list);
}

function check9RouterHealth(opts = {}) {
  const baseUrl = opts.router9Url || CFG.router9Url;
  const auth = resolve9RouterApiKey(opts.authorization);
  const url = new URL('/v1/models', baseUrl);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise(resolve => {
    const headers = {};
    if (auth) headers.authorization = auth;
    const req = lib.request(url, { method: 'GET', headers }, res => {
      res.resume();
      resolve({ reachable: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode });
    });
    const timer = setTimeout(() => { req.destroy(); resolve({ reachable: false, status: null }); }, 2000);
    req.once('response', () => clearTimeout(timer));
    req.on('error', () => { clearTimeout(timer); resolve({ reachable: false, status: null }); });
    req.end();
  });
}

module.exports = { fetch9RouterModels, syncModelsFrom9Router, check9RouterHealth };
