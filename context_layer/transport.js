'use strict';
const { stats } = require('./config');
const { repairJson } = require('./compact');

function sendJson(res, status, obj) {
  if (res.writableEnded || res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  const body = Buffer.from(JSON.stringify(obj, null, 2));
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0, tooBig = false;
    req.on('data', c => { n += c.length; if (n > limit) { tooBig = true; return; } chunks.push(c); });
    req.on('end', () => tooBig ? reject(Object.assign(new Error('request body too large'), { status: 413 })) : resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function collect(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    stream.on('aborted', () => reject(new Error('upstream aborted')));
  });
}

function repairResponse(buf) {
  let j;
  try { j = JSON.parse(buf.toString('utf8')); } catch (_) { return buf; }
  let changed = false;
  const fix = obj => {
    if (obj && typeof obj.arguments === 'string') {
      const fixed = repairJson(obj.arguments);
      if (fixed !== null && fixed !== obj.arguments) {
        obj.arguments = fixed;
        changed = true;
        stats.repairedResponseTools++;
      }
    }
  };
  for (const c of j.choices || []) for (const tc of (c.message && c.message.tool_calls) || []) fix(tc.function);
  for (const item of j.output || []) if (item && item.type === 'function_call') fix(item);
  return changed ? Buffer.from(JSON.stringify(j)) : buf;
}

module.exports = { sendJson, readBody, collect, repairResponse };
