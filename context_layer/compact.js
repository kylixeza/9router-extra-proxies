'use strict';
const crypto = require('crypto');
const fs = require('fs');
const pathMod = require('path');
const { CFG, stats } = require('./config');
const { getCharsPerToken, estimateStringTokens, estimateMessageTokens } = require('./tokens');
const { extractText } = require('./conversation');

const ANSI_RE = /\[[0-?]*[ -/]*[@-~]/g;

function losslessCleanString(str) {
  if (typeof str !== 'string' || str.length < 200) return str;
  let s = str.replace(ANSI_RE, '');
  if (CFG.normalizeLineEndings) s = s.replace(/\r\n/g, '\n');

  if (CFG.minifyJson) {
    const trimmed = s.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return JSON.stringify(JSON.parse(trimmed)); } catch (_) {}
    }
  }

  if (CFG.collapseRepeatedLines) {
    const lines = s.split('\n');
    if (lines.length >= 5) {
      const out = [];
      for (let i = 0; i < lines.length;) {
        let j = i;
        while (j + 1 < lines.length && lines[j + 1] === lines[i]) j++;
        const run = j - i + 1;
        if (run >= 5 && lines[i].trim().length > 0) out.push(`${lines[i]} [repeated ${run}x]`);
        else for (let k = i; k <= j; k++) out.push(lines[k]);
        i = j + 1;
      }
      s = out.join('\n');
    }
  }
  return s;
}

const sha1 = x => crypto.createHash('sha1').update(x).digest('hex');
// Hashes of tool outputs that were already offloaded. Remembered so the same message is offloaded the same way on every later turn.
const offloadedHashes = new Set();

function deduplicateIdenticalToolOutputs(msgs) {
  const nameById = new Map();
  for (const m of msgs) {
    if (m && m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) if (tc && tc.id && tc.function) nameById.set(tc.id, tc.function.name || 'tool');
    }
  }
  const first = new Map();
  const referenced = new Set();
  let count = 0;
  const list = msgs.map((m, idx) => {
    if (!m || m.role !== 'tool' || typeof m.content !== 'string' || m.content.length < CFG.dedupMinChars) return m;
    const h = sha1(m.content);
    if (offloadedHashes.has(h)) return m;
    const f = first.get(h);
    if (!f) { first.set(h, { idx, id: m.tool_call_id, name: nameById.get(m.tool_call_id) }); return m; }
    referenced.add(f.idx);
    count++;
    stats.dedupedToolOutputs++;
    const where = f.id ? `tool call ${f.id}${f.name ? ` ("${f.name}")` : ''}` : `message #${f.idx + 1}`;
    return { ...m, content: `[This output is byte-for-byte identical (${m.content.length} chars) to the result of ${where} earlier in this conversation. Refer to that result.]` };
  });
  return { list, referenced, count };
}

function saveSpillFile(content) {
  if (!CFG.spillToDisk) return null;
  try {
    fs.mkdirSync(CFG.spillDir, { recursive: true });
    const hash = crypto.createHash('sha1').update(content).digest('hex').slice(0, 16);
    const filePath = pathMod.join(CFG.spillDir, `tool-${hash}.txt`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, 'utf8');
      stats.spilledFilesWritten++;
      fs.promises.readdir(CFG.spillDir).then(async files => {
        const txt = files.filter(f => f.startsWith('tool-') && f.endsWith('.txt'));
        if (txt.length <= CFG.spillKeepFiles) return;
        const info = await Promise.all(txt.map(async f => {
          try { return { f, t: (await fs.promises.stat(pathMod.join(CFG.spillDir, f))).mtimeMs }; } catch (_) { return { f, t: Date.now() }; }
        }));
        info.sort((a, b) => a.t - b.t);
        const cutoff = Date.now() - CFG.spillMinAgeMs;
        for (const { f, t } of info.slice(0, info.length - CFG.spillKeepFiles)) {
          if (t < cutoff) await fs.promises.unlink(pathMod.join(CFG.spillDir, f)).catch(() => {});
        }
      }).catch(() => {});
    }
    return filePath;
  } catch (_) {
    return null;
  }
}

const HIGHLIGHT_RE = /\b(error|exception|fail|failed|fatal|panic|traceback|syntaxerror|typeerror|referenceerror|todo|fixme|warning)\b|^(export\s+|function\s+|class\s+|def\s+|interface\s+|type\s+)/i;

function smartCompactToolOutput(text, maxChars) {
  const headChars = Math.floor(maxChars * 0.55);
  const tailChars = Math.floor(maxChars * 0.25);
  const highlightBudget = Math.max(200, maxChars - headChars - tailChars);

  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  const middle = text.slice(headChars, text.length - tailChars);

  const midLines = middle.split('\n');
  const highlights = [];
  let hlLen = 0;
  for (const line of midLines) {
    const trimmed = line.trim();
    if (trimmed && HIGHLIGHT_RE.test(trimmed)) {
      if (hlLen + trimmed.length > highlightBudget) break;
      highlights.push(trimmed.slice(0, 200));
      hlLen += trimmed.length + 1;
    }
  }

  const spillPath = saveSpillFile(text);
  const totalLines = text.split('\n').length;
  const spillNote = spillPath
    ? `Full untruncated output (${totalLines} lines, ${text.length} chars) saved to: ${spillPath} (you can read/grep this file if needed).`
    : `${text.length - maxChars} middle chars compacted.`;

  const hlBlock = highlights.length
    ? `\nKey lines extracted from middle:\n  • ${highlights.join('\n  • ')}\n`
    : '\n';

  return `${head}\n\n…[context-proxy: ${spillNote}]…${hlBlock}\n${tail}`;
}

function buildActionLedger(foldedMsgs) {
  const userPrompts = [];
  const actions = [];

  for (const m of foldedMsgs) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'user') {
      const clean = extractText(m.content).trim();
      if (!clean) continue;
      userPrompts.push(clean.length > 1500 ? clean.slice(0, 1500) + ' …[truncated]' : clean);
    } else if (m.role === 'assistant') {
      const text = extractText(m.content).trim();
      const calls = Array.isArray(m.tool_calls)
        ? m.tool_calls.map(tc => {
            const fn = (tc && tc.function && tc.function.name) || 'tool';
            const args = (tc && tc.function && tc.function.arguments) || '';
            const shortArgs = args.length > 140 ? args.slice(0, 140) + '…' : args;
            return `${fn}(${shortArgs})`;
          }).join(', ')
        : '';
      if (text || calls) {
        const summary = [text ? text.slice(0, 300) + (text.length > 300 ? '…' : '') : '', calls ? `[Tools: ${calls}]` : '']
          .filter(Boolean).join(' ');
        actions.push(`- Assistant: ${summary}`);
      }
    } else if (m.role === 'tool') {
      const body = extractText(m.content);
      const firstLine = body.trim().split('\n')[0].slice(0, 180);
      actions.push(`  -> Tool result (${body.length} chars): ${firstLine}${body.length > 180 ? '…' : ''}`);
    }
  }

  const sections = [
    `[Context Memory Ledger — ${foldedMsgs.length} earlier messages compacted without losing user requirements or action history]`,
  ];
  if (CFG.preserveUserMessages && userPrompts.length) {
    sections.push(`### Earlier User Instructions (Preserved Verbatim):\n${userPrompts.map((u, i) => `${i + 1}.${u}`).join('\n\n')}`);
  }
  if (actions.length) {
    sections.push(`### Earlier Agent Action & Tool Trace:\n${actions.slice(-40).join('\n')}`);
  }
  return sections.join('\n\n');
}

function stripSchema(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripSchema);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === '$schema') continue;
    if (k === 'format' && typeof v === 'string' && ['int32', 'int64', 'float', 'double'].includes(v)) continue;
    out[k] = stripSchema(v);
  }
  return out;
}

function repairJson(s) {
  if (typeof s !== 'string') return s;
  const t = s.trim();
  if (t === '') return '{}';
  try { JSON.parse(t); return s; } catch (_) {}
  let x = t.replace(/^```(?:json)?\s*|\s*```$/g, '').replace(/,\s*([}\]])/g, '$1');
  try { JSON.parse(x); return x; } catch (_) {}
  const stack = [];
  let inStr = false, esc = false;
  for (const ch of x) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let y = x + (inStr ? '"' : '');
  y = y.replace(/[,:]\s*$/, '') + stack.reverse().join('');
  try { JSON.parse(y); return y; } catch (_) { return null; }
}

function fixId(id) {
  if (typeof id !== 'string' || /^[a-zA-Z0-9_-]{1,40}$/.test(id)) return id;
  return 'call_' + crypto.createHash('sha1').update(id).digest('hex').slice(0, 24);
}

function normalizeMessages(msgs) {
  const out = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (!m || typeof m !== 'object') { out.push(m); continue; }
    let msg = { ...m };

    const isLastTurn = i >= msgs.length - 2;
    if (CFG.stripOldReasoning && !isLastTurn && msg.role === 'assistant') {
      delete msg.reasoning_content;
      delete msg.thinking;
    }

    if (CFG.losslessCleanup && msg.role === 'tool' && typeof msg.content === 'string') {
      msg.content = losslessCleanString(msg.content);
    }

    if (msg.tool_call_id) msg.tool_call_id = fixId(msg.tool_call_id);
    if (Array.isArray(msg.tool_calls)) {
      msg.tool_calls = msg.tool_calls.map(tc => {
        const next = { ...tc, id: fixId(tc.id) };
        if (tc.function) {
          next.function = { ...tc.function };
          if (CFG.repairToolCalls && typeof tc.function.arguments === 'string') {
            const fixed = repairJson(tc.function.arguments);
            if (fixed !== tc.function.arguments) stats.repairedRequestTools++;
            next.function.arguments = fixed ?? '{}';
          }
        }
        return next;
      });
    }

    const hasCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    if (typeof msg.content === 'string' && msg.content.trim() === '' && !hasCalls && msg.role !== 'tool') continue;

    const prev = out[out.length - 1];
    if (prev && prev.role === msg.role && ['user', 'assistant', 'system'].includes(msg.role)
        && !hasCalls && !(prev.tool_calls && prev.tool_calls.length)
        && typeof prev.content === 'string' && typeof msg.content === 'string') {
      out[out.length - 1] = { ...prev, content: prev.content + '\n\n' + msg.content };
      continue;
    }
    out.push(msg);
  }
  return out.length ? out : msgs;
}

function compactContextByTokens(msgs, toolTokens, model) {
  const cpt = getCharsPerToken(model);
  const budget = CFG.modelContextTokens[model] || CFG.maxContextTokens;
  const rawMsgTokens = msgs.reduce((n, m) => n + estimateMessageTokens(m, cpt), 0);
  const rawTotalTokens = toolTokens + rawMsgTokens;
  const changes = { deduped: 0, offloaded: 0, huge: 0, folded: 0 };

  let list = msgs;
  let referenced = new Set();
  if (CFG.dedupOldTools) {
    const d = deduplicateIdenticalToolOutputs(msgs);
    list = d.list; referenced = d.referenced; changes.deduped = d.count;
  }

  const pressure = budget > 0 ? rawTotalTokens / budget : 0;
  const boundary = Math.floor(Math.max(0, list.length - CFG.recentToolWindow) / CFG.offloadStep) * CFG.offloadStep;
  list = list.map((m, idx) => {
    if (!m || m.role !== 'tool' || typeof m.content !== 'string') return m;
    const tokens = estimateStringTokens(m.content, cpt);
    if (tokens > CFG.hugeToolTokens) {
      changes.huge++; stats.hugeToolOutputs++;
      return { ...m, content: smartCompactToolOutput(m.content, Math.floor(CFG.hugeKeepTokens * cpt)) };
    }
    if (!CFG.offloadOldTools || tokens < CFG.offloadMinTokens || referenced.has(idx)) return m;
    const h = sha1(m.content);
    if (offloadedHashes.has(h) || (idx < boundary && pressure >= CFG.offloadStartRatio)) {
      offloadedHashes.add(h);
      if (offloadedHashes.size > 20000) offloadedHashes.delete(offloadedHashes.values().next().value);
      changes.offloaded++; stats.offloadedToolOutputs++;
      return { ...m, content: smartCompactToolOutput(m.content, Math.floor(CFG.offloadKeepTokens * cpt)) };
    }
    return m;
  });

  let msgTokens = list.reduce((n, m) => n + estimateMessageTokens(m, cpt), 0);
  let totalInputTokens = toolTokens + msgTokens;
  let overBudget = false;

  if (budget > 0 && totalInputTokens > budget) {
    if (!CFG.foldMessages) {
      overBudget = true;
    } else {
      const isSys = m => m && (m.role === 'system' || m.role === 'developer');
      const sys = list.filter(isSys);
      const rest = list.filter(m => !isSys(m));
      const targetTotal = Math.floor(budget * CFG.trimTargetRatio);
      const folded = [];
      const pinIdx = rest.findIndex(m => m && m.role === 'user');
      const pinned = pinIdx >= 0 ? rest.splice(pinIdx, 1)[0] : null;
      while (rest.length > CFG.keepLastMessages && totalInputTokens > targetTotal) {
        totalInputTokens -= estimateMessageTokens(rest[0], cpt);
        folded.push(rest.shift());
      }
      const live = new Set();
      for (const m of rest) if (m && m.role === 'assistant' && Array.isArray(m.tool_calls)) m.tool_calls.forEach(tc => tc && tc.id && live.add(tc.id));
      for (let i = rest.length - 1; i >= 0; i--) {
        if (rest[i] && rest[i].role === 'tool' && !live.has(rest[i].tool_call_id)) folded.push(rest.splice(i, 1)[0]);
      }
      if (folded.length) {
        stats.foldedMessages += folded.length;
        changes.folded = folded.length;
        sys.push({ role: 'system', content: buildActionLedger(folded) });
        list = [...sys, ...(pinned ? [pinned] : []), ...rest];
        msgTokens = list.reduce((n, m) => n + estimateMessageTokens(m, cpt), 0);
        totalInputTokens = toolTokens + msgTokens;
      }
    }
  }

  const savedTokens = Math.max(0, rawMsgTokens - msgTokens);
  stats.losslessSavedTokensEst += savedTokens;

  return { messages: list, msgTokens, toolTokens, totalInputTokens, rawTotalTokens, savedTokens, budget, changes, overBudget };
}

module.exports = { losslessCleanString, deduplicateIdenticalToolOutputs, saveSpillFile, smartCompactToolOutput, buildActionLedger, stripSchema, repairJson, fixId, normalizeMessages, compactContextByTokens };
