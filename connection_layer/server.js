'use strict';
const http = require('http');
const { CFG } = require('./config');
const { sendJson } = require('./utils');
const { handle } = require('./handler');

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error(`[handler error] ${req.method} ${req.url}: ${err.stack || err.message}`);
    sendJson(res, 500, { error: { message: err.message, type: 'proxy_error' } });
  });
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

function start() {
  try { require('../storage_layer').ensureSchema(); } catch (_) {}
  server.listen(CFG.port, '127.0.0.1', () => {
    console.log(`[9router Server Proxy] Listening on http://127.0.0.1:${CFG.port} -> ${CFG.target}`);
    console.log(`[config] retries=${CFG.retries} dedup=${CFG.dedupTtlMs}ms logs=${CFG.logBodies ? CFG.logDir : 'off'} pg=${require('../storage_layer').isEnabled() ? 'on' : 'off'}`);
  });
}

function shutdown() {
  console.log('[9router Server Proxy] shutting down, draining requests…');
  try { require('../storage_layer').close(); } catch (_) {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { server, start, shutdown };
