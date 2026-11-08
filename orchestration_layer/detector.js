'use strict';

const SUBAGENT_MARKER_RX = /\[\[ORCH v=1 plan=([\w.-]+) task=(T\d+) role=(worker|fixer) agent=(\S+) attempt=(\d+)\]\]/;
const IDE_CLOSE_TAG = '</ide-context>';

function extractUserText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      if (typeof part.text === 'string' && part.type !== 'output_text') parts.push(part.text);
      else if (typeof part.text === 'string') parts.push(part.text);
    }
    return parts.join('\n');
  }
  return '';
}

function stripIdeContext(text) {
  if (typeof text !== 'string' || !text) return '';
  let s = text;
  const idx = s.lastIndexOf(IDE_CLOSE_TAG);
  if (idx >= 0) s = s.slice(idx + IDE_CLOSE_TAG.length);
  s = s.trim();
  if (s.startsWith('<user-query>')) {
    s = s.slice('<user-query>'.length);
    if (s.endsWith('</user-query>')) s = s.slice(0, -'</user-query>'.length);
    s = s.trim();
  }
  return s;
}

function startsWithCommand(cleanedText, cmd) {
  if (!cmd || !cleanedText.startsWith(cmd)) return false;
  const next = cleanedText.charAt(cmd.length);
  return next === '' || /\s/.test(next);
}

// Parse optional inline model selector right after trigger command:
//   `/orch-plan @ag/claude-sonnet-5-5-high build feature`
//   `/orch-plan model=zd/gpt-6.1-sol build feature`
//   `/orch-plan ag/claude-sonnet-5-5-high build feature` (when token contains `/`)
function parseTriggerOrchestrator(cleanedText, cmd) {
  const rest = cleanedText.slice(cmd.length).replace(/^[ \t]+/, '');
  if (!rest || rest.startsWith('\n')) return null;
  const firstToken = rest.split(/\s+/)[0];
  if (!firstToken) return null;
  if (firstToken.startsWith('@') && firstToken.length > 1) return firstToken.slice(1);
  if (/^model=\S+/i.test(firstToken)) return firstToken.slice(6);
  if (/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(firstToken)) return firstToken;
  return null;
}

function normalizeInputItems(body) {
  if (!body || typeof body !== 'object') return [];
  if (typeof body.input === 'string') return [{ role: 'user', content: body.input }];
  if (Array.isArray(body.input)) return body.input;
  return [];
}

function scanNeeds(body, items) {
  let needsVision = false;
  let needsPdf = false;
  const needsTools = Array.isArray(body && body.tools) && body.tools.length > 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'input_image' || item.type === 'image_url') needsVision = true;
    if (item.type === 'input_file') needsPdf = true;
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (!part || typeof part !== 'object') continue;
        if (part.type === 'input_image' || part.type === 'image_url') needsVision = true;
        if (part.type === 'input_file' || (typeof part.mime_type === 'string' && part.mime_type.includes('pdf'))
          || (typeof part.filename === 'string' && /\.pdf$/i.test(part.filename))) {
          needsPdf = true;
        }
      }
    }
  }
  return { needsVision, needsPdf, needsTools };
}

function isCompletedSetPlanState(item) {
  if (!item || item.type !== 'function_call' || item.name !== 'set_plan_state') return false;
  if (typeof item.arguments !== 'string') return false;
  try {
    const parsed = JSON.parse(item.arguments);
    return Boolean(parsed && parsed.state === 'COMPLETED');
  } catch (_) {
    return false;
  }
}

function detectRequest(body, settings = {}) {
  const items = normalizeInputItems(body);
  const needs = scanNeeds(body, items);

  if (settings.enabled === false) {
    return { kind: 'PASSTHROUGH', marker: null, needs, reason: 'disabled' };
  }

  const triggerCmd = String(settings.trigger_command || '/orch-plan').trim();
  const offCmd = String(settings.off_command || '/orch-off').trim();

  // 1. SUBAGENT: check ONLY first 3 role === 'user' items in body.input
  let userSeen = 0;
  for (let i = 0; i < items.length && userSeen < 3; i++) {
    const it = items[i];
    if (!it || it.role !== 'user' || it.type === 'function_call' || it.type === 'function_call_output') continue;
    userSeen++;
    const cleaned = stripIdeContext(extractUserText(it.content));
    const m = SUBAGENT_MARKER_RX.exec(cleaned);
    if (m) {
      return {
        kind: 'SUBAGENT',
        marker: {
          planId: m[1],
          taskKey: m[2],
          role: m[3],
          agent: m[4],
          attempt: Number(m[5]),
        },
        needs,
        reason: 'subagent_marker',
      };
    }
  }

  // 2. ORCH: walk items in order for last trigger_command vs last closer (set_plan_state COMPLETED or off_command)
  let lastTriggerIndex = -1;
  let lastTriggerModel = null;
  let lastCloserIndex = -1;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== 'object') continue;
    if (isCompletedSetPlanState(it)) {
      lastCloserIndex = i;
      continue;
    }
    if (it.role === 'user' && it.type !== 'function_call' && it.type !== 'function_call_output') {
      const cleaned = stripIdeContext(extractUserText(it.content));
      if (startsWithCommand(cleaned, offCmd)) {
        lastCloserIndex = i;
      } else if (startsWithCommand(cleaned, triggerCmd)) {
        lastTriggerIndex = i;
        lastTriggerModel = parseTriggerOrchestrator(cleaned, triggerCmd);
      }
    }
  }

  if (lastTriggerIndex >= 0 && lastCloserIndex < lastTriggerIndex) {
    const clientModel = body && typeof body.model === 'string' ? body.model : null;
    return { kind: 'ORCH', marker: null, requestedOrchestrator: lastTriggerModel, clientModel, needs, reason: 'trigger_active' };
  }

  return { kind: 'PASSTHROUGH', marker: null, needs, reason: 'normal' };
}

module.exports = {
  SUBAGENT_MARKER_RX,
  extractUserText,
  stripIdeContext,
  startsWithCommand,
  parseTriggerOrchestrator,
  scanNeeds,
  detectRequest,
};
