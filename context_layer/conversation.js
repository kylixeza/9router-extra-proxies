'use strict';
const { execFile } = require('child_process');
const crypto = require('crypto');
const { CFG, PAUSE_MARKER, sessionDecisions, pendingDialogs, stats } = require('./config');

function rememberDecision(convId, decision) {
  sessionDecisions.set(convId, decision);
  while (sessionDecisions.size > 200) {
    sessionDecisions.delete(sessionDecisions.keys().next().value);
  }
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('\n');
  }
  return '';
}

function usageFromJson(j) {
  const u = j && (j.usage || (j.response && j.response.usage));
  if (!u) return null;
  return { prompt: u.prompt_tokens ?? u.input_tokens ?? 0, completion: u.completion_tokens ?? u.output_tokens ?? 0 };
}

function usageFromSseTail(tail) {
  for (const line of tail.split('\n').reverse()) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try { const u = usageFromJson(JSON.parse(data)); if (u) return u; } catch (_) {}
  }
  return null;
}

function getConversationId(body, req) {
  const explicit = req.headers['x-session-id'] || req.headers['x-conversation-id']
    || body.conversation_id || body.session_id || (body.metadata && body.metadata.session_id);
  if (explicit) return String(explicit);

  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const firstSys = msgs.find(m => m && (m.role === 'system' || m.role === 'developer'));
  const firstUser = msgs.find(m => m && m.role === 'user');

  const seed = [
    firstSys ? extractText(firstSys.content).slice(0, 400) : '',
    firstUser ? extractText(firstUser.content).slice(0, 600) : 'default-session',
  ].join('||');

  return 'conv_' + crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

function checkAndCleanChatConfirmation(body, convId) {
  if (!Array.isArray(body.messages) || !body.messages.length) return;
  const msgs = body.messages;

  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i] && msgs[i].role === 'user') { lastUserIdx = i; break; }
  }
  if (lastUserIdx === -1) return;

  const userText = extractText(msgs[lastUserIdx].content).trim();
  const status = sessionDecisions.get(convId);

  if (status === 'awaiting_chat') {
    if (/^(continue|yes|y|proceed|go ahead|resume|ok|okay)$/i.test(userText)) {
      rememberDecision(convId, 'continue');
      stats.conversationsContinued++;
      body.messages = msgs.filter((m, idx) => {
        if (idx === lastUserIdx) return false;
        if (m && m.role === 'assistant' && extractText(m.content).includes(PAUSE_MARKER)) return false;
        return true;
      });
    } else {
      rememberDecision(convId, 'stop');
      stats.conversationsStopped++;
    }
  } else if (status === 'stop' && /^(continue|resume|proceed)$/i.test(userText)) {
    rememberDecision(convId, 'continue');
    stats.conversationsContinued++;
  }
}

function promptMacUserConfirmation(convId, model, tokens, msgCount) {
  if (pendingDialogs.has(convId)) return pendingDialogs.get(convId);

  const pr = new Promise(resolve => {
    const tokenStr = tokens.toLocaleString('en-US');
    const limitStr = CFG.tokenAlertThreshold.toLocaleString('en-US');

    const appleScript = `
      display notification "Agent input reached ${tokenStr} tokens (>${limitStr}). Paused waiting for confirmation." with title "9router Context Proxy" subtitle "Model: ${model}" sound name "Glass"
      set msgText to "⚠️ High Input Token Alert\\n\\nAgent input context has reached ${tokenStr} tokens (threshold: ${limitStr}).\\n\\n• Model: ${model}\\n• Messages: ${msgCount}\\n\\nChoose Continue to proceed without asking again, or Stop Conversation to halt immediately."
      try
        tell application "System Events"
          activate
          set r to display dialog msgText with title "9router Context Proxy — Paused" buttons {"Stop Conversation", "Continue"} default button "Continue" with icon caution giving up after ${CFG.dialogTimeoutSec}
          if gave up of r then return "TIMEOUT"
          return button returned of r
        end tell
      on error
        set r to display dialog msgText with title "9router Context Proxy — Paused" buttons {"Stop Conversation", "Continue"} default button "Continue" with icon caution giving up after ${CFG.dialogTimeoutSec}
        if gave up of r then return "TIMEOUT"
        return button returned of r
      end try
    `;

    execFile('/usr/bin/osascript', ['-e', appleScript], { timeout: (CFG.dialogTimeoutSec + 5) * 1000 }, (err, stdout) => {
      pendingDialogs.delete(convId);
      if (err) return resolve('timeout');
      const out = String(stdout || '').trim();
      if (out === 'Continue') return resolve('continue');
      if (out === 'Stop Conversation') return resolve('stop');
      return resolve('timeout');
    });
  });

  pendingDialogs.set(convId, pr);
  return pr;
}

function sendSyntheticAssistantReply(res, bodyObj, text) {
  if (res.writableEnded || res.destroyed) return;
  const id = 'chatcmpl-proxy-' + crypto.randomBytes(6).toString('hex');
  const created = Math.floor(Date.now() / 1000);
  const model = (bodyObj && bodyObj.model) || 'context-proxy';
  const isStream = Boolean(bodyObj && bodyObj.stream);

  if (isStream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    });
    const chunk1 = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    };
    const chunk2 = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
    res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
    res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
    res.end('data: [DONE]\n\n');
    return;
  }

  const payload = Buffer.from(JSON.stringify({
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: text },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }));
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': payload.length });
  res.end(payload);
}

module.exports = { rememberDecision, extractText, usageFromJson, usageFromSseTail, getConversationId, checkAndCleanChatConfirmation, promptMacUserConfirmation, sendSyntheticAssistantReply };
