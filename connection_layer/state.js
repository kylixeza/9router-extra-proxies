'use strict';

const state = {
  dedupCache: new Map(),
  inflight: new Map(),
  modelsCache: null,
  modelsRefreshing: false,
  stats: {
    startedAt: new Date().toISOString(),
    requests: 0, byStatus: {}, dedupHits: 0, coalesced: 0, retries: 0, fallbacks: 0,
    upstreamErrors: 0, clientAborts: 0,
    models: {},
  },
};

module.exports = state;
