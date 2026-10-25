'use strict';
const http = require('http');
const { CFG } = require('./config');
const { handle } = require('./handler');
const { sendJson } = require('./transport');

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error(`[context-proxy error] ${err.stack || err.message}`);
    sendJson(res, 500, { error: { message: err.message, type: 'context_proxy_error' } });
  });
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;

function start() {
  server.listen(CFG.port, '127.0.0.1', () => {
    console.log(`[Context Proxy] Listening on http://127.0.0.1:${CFG.port} -> Server Proxy ${CFG.target}`);
  });
}

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { server, start, shutdown };
