'use strict';
const { CFG } = require('./config');
const state = require('./state');
const { callUpstream, collect, sendBuffered, sendJson, upstreamHeaders } = require('./utils');

async function fetchModels(headers) {
  const r = await callUpstream(new URL('/v1/models', CFG.target), { method: 'GET', headers }, null);
  const buf = await collect(r);
  if (r.statusCode === 200) state.modelsCache = { buf, at: Date.now() };
  return { status: r.statusCode, headers: r.headers, buf };
}

async function handleModels(req, res) {
  const headers = upstreamHeaders(req, null);
  const json = { 'content-type': 'application/json' };
  const age = state.modelsCache ? Date.now() - state.modelsCache.at : Infinity;

  if (age < CFG.modelsTtlMs) return sendBuffered(res, 200, json, state.modelsCache.buf, { 'x-cache': 'hit' });

  if (state.modelsCache && age < CFG.modelsTtlMs * 10) {
    sendBuffered(res, 200, json, state.modelsCache.buf, { 'x-cache': 'stale' });
    if (!state.modelsRefreshing) {
      state.modelsRefreshing = true;
      fetchModels(headers).catch(() => {}).finally(() => { state.modelsRefreshing = false; });
    }
    return;
  }
  try {
    const m = await fetchModels(headers);
    if (m.status === 200) return sendBuffered(res, 200, json, m.buf, { 'x-cache': 'miss' });
    if (state.modelsCache) return sendBuffered(res, 200, json, state.modelsCache.buf, { 'x-cache': 'stale-if-error' });
    return sendBuffered(res, m.status, m.headers, m.buf);
  } catch (err) {
    if (state.modelsCache) return sendBuffered(res, 200, json, state.modelsCache.buf, { 'x-cache': 'stale-if-error' });
    return sendJson(res, 502, { error: { message: err.message, type: 'proxy_error' } });
  }
}

module.exports = { fetchModels, handleModels };
