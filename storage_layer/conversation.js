'use strict';
// ponytail: heuristic hash on project + system prefix + first user query when client omits session ID.
// Upgrade to native session IDs when IDE clients send x-session-id or prompt_cache_key.
const crypto = require('crypto');
const { extractProjectName } = require('./project');

function headerVal(headers, name) {
  if (!headers || typeof headers !== 'object') return null;
  if (headers[name]) return String(headers[name]).trim() || null;
  const target = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === target && headers[k]) return String(headers[k]).trim() || null;
  }
  return null;
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(p => (typeof p === 'string' ? p : (p && typeof p.text === 'string' ? p.text : '')))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function stripIdeContext(text) {
  const s = String(text || '');
  const endTag = '</ide-context>';
  const idx = s.lastIndexOf(endTag);
  if (idx >= 0) {
    const after = s.slice(idx + endTag.length).trim();
    if (after) return after;
  }
  return s.trim();
}

function extractConversationId(headers, body) {
  const explicitHeader = headerVal(headers, 'x-conversation-id')
    || headerVal(headers, 'x-session-id')
    || headerVal(headers, 'x-proxy-conversation-id');
  if (explicitHeader) return explicitHeader;

  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const explicitBody = body.conversation_id || body.session_id
    || (body.metadata && body.metadata.session_id)
    || body.prompt_cache_key;
  if (explicitBody) return String(explicitBody).trim() || null;

  const items = Array.isArray(body.input)
    ? body.input
    : (Array.isArray(body.messages)
      ? body.messages
      : (typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : null));
  if (!items) return null;

  let sysText = typeof body.instructions === 'string' ? body.instructions : '';
  if (!sysText) {
    const firstSys = items.find(m => m && (m.role === 'system' || m.role === 'developer'));
    if (firstSys) sysText = extractText(firstSys.content);
  }

  const firstUser = items.find(m => m && m.role === 'user');
  const userText = firstUser ? stripIdeContext(extractText(firstUser.content)) : '';

  if (!sysText && !userText) return null;

  const project = extractProjectName(headers, body) || '';
  const seed = [
    project,
    sysText.slice(0, 400),
    userText.slice(0, 600),
  ].join('||');

  return 'conv_' + crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

module.exports = { extractConversationId, extractText, stripIdeContext };
