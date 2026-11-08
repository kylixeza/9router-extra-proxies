'use strict';
const { CFG, modelCalibration, sessionDecisions, stats } = require('./config');
const { extractText } = require('./conversation');
const { getCharsPerToken, estimateStringTokens, estimateToolsTokens } = require('./tokens');
const { normalizeMessages, compactContextByTokens, stripSchema } = require('./compact');
const toolIndex = require('./tool_index');

const STOP_WORDS = new Set(['com', 'org', 'io', 'net', 'mcp', 'server', 'app', 'the']);
const escapeRx = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const toolName = t => (t && ((t.function && t.function.name) || t.name)) || '';

function conversationItems(body) {
  if (Array.isArray(body.input)) return body.input;
  if (Array.isArray(body.messages)) return body.messages;
  if (typeof body.input === 'string') return [{ role: 'user', content: body.input }];
  return [];
}

function userQuestionTexts(body) {
  const out = [];
  for (const it of conversationItems(body)) {
    if (!it || it.role !== 'user') continue;
    let txt = extractText(it.content);
    const k = txt.lastIndexOf('</ide-context>');
    txt = k >= 0 ? txt.slice(k + '</ide-context>'.length) : txt.slice(-4000);
    out.push(txt);
  }
  return out;
}

function calledToolNames(body) {
  const names = new Set();
  for (const it of conversationItems(body)) {
    if (!it) continue;
    if (it.type === 'function_call' && it.name) names.add(it.name);
    if (it.role === 'assistant' && Array.isArray(it.tool_calls)) {
      for (const tc of it.tool_calls) if (tc && tc.function && tc.function.name) names.add(tc.function.name);
    }
  }
  const tc = body.tool_choice;
  if (tc && typeof tc === 'object') { const n = tc.name || (tc.function && tc.function.name); if (n) names.add(n); }
  return names;
}

function groupOfTool(name) {
  for (const g of CFG.toolGroups) if (new RegExp(g.match).test(name)) return g.name;
  if (CFG.autoMcpGroups) { const m = /^mcp__(.+?)__/.exec(name); if (m) return m[1]; }
  return null;
}

function groupWords(group) {
  const explicit = CFG.toolGroups.find(g => g.name === group);
  if (explicit && explicit.keywords) return explicit.keywords;
  const base = [...new Set(group.split(/[^a-z0-9]+/i).map(w => w.toLowerCase()).filter(w => w.length > 2 && !STOP_WORDS.has(w)))];
  const extra = [];
  for (const w of base) extra.push(...(CFG.groupKeywords[w] || []));
  return [...base, ...extra];
}

const groupLabel = g => groupWords(g)[0] || g;

const kwCache = new Map();
function keywordRegex(words) {
  const key = words.join('|');
  let rx = kwCache.get(key);
  if (!rx) { rx = new RegExp('(?:^|[^a-z0-9])(?:' + words.map(escapeRx).join('|') + ')s?(?![a-z0-9])', 'i'); kwCache.set(key, rx); }
  return rx;
}

function getInstructionText(body) {
  if (typeof body.instructions === 'string') return body.instructions;
  if (Array.isArray(body.messages)) {
    const m = body.messages.find(x => x && (x.role === 'system' || x.role === 'developer') && typeof x.content === 'string');
    return m ? m.content : null;
  }
  return null;
}

function setInstructionText(body, text) {
  if (typeof body.instructions === 'string') { body.instructions = text; return; }
  if (Array.isArray(body.messages)) {
    const m = body.messages.find(x => x && (x.role === 'system' || x.role === 'developer') && typeof x.content === 'string');
    if (m) m.content = text;
  }
}

function appendToInstructions(body, text) {
  const cur = getInstructionText(body);
  if (cur !== null) { setInstructionText(body, cur + '\n\n' + text); return; }
  if (Array.isArray(body.messages)) body.messages = [{ role: 'system', content: text }, ...body.messages];
  else if (body.instructions === undefined) body.instructions = text;
}

function gateTools(body) {
  const result = { removed: 0, unloaded: [] };
  if (!CFG.toolGating || !Array.isArray(body.tools) || !body.tools.length) return result;

  const questions = userQuestionTexts(body).join('\n');
  const called = [...calledToolNames(body)];
  const force = /#tools:all\b/i.test(questions);
  const counts = new Map();
  for (const t of body.tools) { const g = groupOfTool(toolName(t)); if (g) counts.set(g, (counts.get(g) || 0) + 1); }

  // Indexed providers (PG-backed): prompt -> provider names. Raw group mapped via groupToProvider.
  let indexedProviders = new Set();
  try { if (toolIndex.hasIndex()) indexedProviders = toolIndex.matchedGroupsForPrompt(questions); } catch (_) {}
  const providerOf = g => { try { return toolIndex.groupToProvider(g); } catch (_) { return g; } };

  const enabled = new Map();
  for (const g of counts.keys()) {
    enabled.set(g, force
      || CFG.alwaysLoadGroups.includes(g)
      || indexedProviders.has(providerOf(g))
      || called.some(n => groupOfTool(n) === g)
      || keywordRegex(groupWords(g)).test(questions)
      || new RegExp('#tools:' + escapeRx(groupLabel(g)) + '\\b', 'i').test(questions));
  }

  const kept = body.tools.filter(t => { const g = groupOfTool(toolName(t)); return !g || enabled.get(g); });
  if (kept.length === body.tools.length) return result;

  result.removed = body.tools.length - kept.length;
  result.unloaded = [...counts].filter(([g]) => !enabled.get(g)).map(([g, n]) => ({ label: groupLabel(g), n, words: groupWords(g).slice(0, 4) }));
  body.tools = kept;
  stats.toolsGatedOut += result.removed;

  if (CFG.tellModelAboutUnloaded) {
    const list = result.unloaded.map(u => `${u.label} (${u.n} tools)`).join(', ');
    const hints = [...new Set(result.unloaded.flatMap(u => u.words))].slice(0, 6).map(w => `"${w}"`).join(', ');
    appendToInstructions(body, `<tool_availability>
To save context, these tool groups are not loaded in this request: ${list}.
They load automatically when the user's message mentions them (for example ${hints}), or when the user writes ${result.unloaded.map(u => '#tools:' + u.label).join(' / ')} or #tools:all.
If the task needs one of them, tell the user to mention it in their next message instead of assuming the tool does not exist.
</tool_availability>`);
  }
  return result;
}

const DART_RX = /\.dart\b|pubspec\.ya?ml|\bflutter\b|\bdart\b/i;
const NATIVE_RX = /\.(?:kt|kts|java)\b|build\.gradle|AndroidManifest\.xml|\bkotlin\b/i;

function detectFramework(body) {
  let dart = false, native = false;
  const feed = str => { if (!str) return; if (DART_RX.test(str)) dart = true; if (NATIVE_RX.test(str)) native = true; };
  for (const it of conversationItems(body)) {
    if (!it) continue;
    if (it.role === 'user') {
      for (const m of extractText(it.content).matchAll(/Active document:\s*(\S+)/g)) feed(m[1]);
    }
    if (it.type === 'function_call') feed(String(it.arguments || '').slice(0, 2000));
    if (it.role === 'assistant' && Array.isArray(it.tool_calls)) {
      for (const tc of it.tool_calls) feed(String((tc && tc.function && tc.function.arguments) || '').slice(0, 2000));
    }
  }
  for (const q of userQuestionTexts(body)) feed(q);
  if (dart && native) return 'hybrid';
  return dart ? 'flutter' : 'default';
}

function dropAndroidSkills(text, keep) {
  let removed = 0;
  const out = text.replace(/<skill>\s*<name>[\s\S]*?<\/skill>\s*/g, entry => {
    const name = ((entry.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '').trim();
    const pth = (entry.match(/<path>([\s\S]*?)<\/path>/) || [])[1] || '';
    if (keep && keep.has(name)) return entry;
    if (CFG.dropSkillPathRx.test(pth) && !CFG.keepSkillNames.includes(name)) { removed++; return ''; }
    return entry;
  });
  const open = (out.match(/<skill>/g) || []).length, close = (out.match(/<\/skill>/g) || []).length;
  if (open !== close) return { text, removed: 0 };
  return { text: out, removed };
}

function dbInstruction() {
  try { return require('../storage_layer/instructions').getActive(); } catch (_) { return null; }
}

// ponytail: single-row DB instruction wins. Incoming discarded except matched skill blocks.
function applyDbInstructions(body, keepSkills) {
  const dbText = dbInstruction();
  if (!dbText || !String(dbText).trim()) return { usedDb: false };
  const original = getInstructionText(body);
  const blocks = toolIndex.extractSkillBlocks ? toolIndex.extractSkillBlocks(original, keepSkills) : '';
  const combined = blocks ? String(dbText).trim() + '\n\n' + blocks : String(dbText).trim();
  setInstructionText(body, combined);
  return { usedDb: true, skillsKept: keepSkills ? keepSkills.size : 0 };
}

function applyInstructionProfile(body, keepSkills) {
  const res = { profile: 'default', skillsRemoved: 0, skillsKept: 0 };
  if (!CFG.instructionProfiles) return res;
  const profile = detectFramework(body);
  res.profile = profile;
  const P = CFG.profileText[profile];
  const original = getInstructionText(body);
  if (!P || !original) return res;

  let text = original
    .replace(/You are an expert Android developer assisting a user within the Android Studio IDE\./, () => P.persona)
    .replace(/You should consider every request as coming from an Android app developer needing help with Android development\./, () => P.requests)
    .replace(/You are a general agent helping with development of Android apps and libraries\./, () => P.general)
    .replace(/## Android Best Practice[\s\S]*?(?=<\/system_prompt>)/, () => P.bestPractice + '\n');

  if (profile === 'flutter') {
    const d = dropAndroidSkills(text, keepSkills);
    text = d.text; res.skillsRemoved = d.removed; stats.skillsDropped += d.removed;
    if (keepSkills && keepSkills.size) res.skillsKept = [...keepSkills].filter(n => text.includes(n)).length;
  } else if (keepSkills && keepSkills.size) {
    res.skillsKept = keepSkills.size;
  }
  if (text !== original) setInstructionText(body, text);
  return res;
}

function responsesFieldsTokens(body, cpt) {
  if (Array.isArray(body.messages)) return 0;
  let n = 0;
  if (typeof body.instructions === 'string') n += estimateStringTokens(body.instructions, cpt);
  if (body.input != null) n += estimateStringTokens(typeof body.input === 'string' ? body.input : JSON.stringify(body.input), cpt);
  return n;
}

function shapeRequest(body, p, convId, opts = {}) {
  const model = body.model || 'default';
  const cpt = getCharsPerToken(model);
  const isStream = body.stream === true;
  const orchBudget = opts && Number.isFinite(opts.orchBudget) && opts.orchBudget > 0 ? opts.orchBudget : null;
  const hasOrchModel = Boolean(opts && opts.hasOrchModel);

  const rawToolTokens = estimateToolsTokens(body.tools, cpt);
  const rawExtraTokens = responsesFieldsTokens(body, cpt);
  // 1. Index command: #9r-sync (aliases: #9router-sync, "index 9router proxy") -> upsert providers+items+skills, no filtering.
  // ponytail: hash/plain words only; slash cmds get swallowed by skill router.
  // 4. After index, attach summary and ask model which keywords match the context.
  let indexed = null;
  try {
    const q = userQuestionTexts(body).join('\n');
    if (toolIndex.INDEX_CMD_RX.test(q)) {
      const incoming = getInstructionText(body);
      indexed = toolIndex.indexCurrentRequest(body, incoming);
      // ponytail: capture full incoming instructions as template for dashboard generate-from-template.
      try { require('../storage_layer/instructions').saveTemplate(incoming); } catch (_) {}
      console.log(`[tool-index] indexed tools=${indexed.tools} skills=${indexed.skills} providers=${indexed.providers.length}`);
      const provLines = indexed.providers.map(p => `- ${p.provider} (${p.tools} tools): ${p.keywords.join(', ')}`).join('\n');
      const skillLines = indexed.skillNames.slice(0, 40).join(', ');
      appendToInstructions(body, `<tool_index>
Indexed ${indexed.tools} MCP tools into ${indexed.providers.length} providers, and ${indexed.skills} skills.
Providers and sample keywords:
${provLines}
Skills: ${skillLines}
\nReview the user's request below. Reply with a single line listing the keywords that match the task context, in this exact format:
KEYWORDS: kw1, kw2, kw3
Only use keywords from the lists above. If none match, reply with: KEYWORDS: none
</tool_index>`);
    }
  } catch (e) { console.error('[tool-index] index failed:', e.message); }
  // 8. Prompt keyword match -> keep tools (gateTools) + keep skills (DB base or profile).
  let keepSkills = new Set();
  try {
    const q = userQuestionTexts(body).join('\n');
    if (toolIndex.hasIndex()) keepSkills = toolIndex.matchedSkillsForPrompt(q);
  } catch (_) {}
  let dbRes = { usedDb: false };
  try { dbRes = applyDbInstructions(body, keepSkills); } catch (_) {}
  const gate = gateTools(body);
  const prof = dbRes.usedDb
    ? { profile: 'db', skillsRemoved: 0, skillsKept: dbRes.skillsKept || 0 }
    : applyInstructionProfile(body, keepSkills);

  if (Array.isArray(body.tools)) {
    const nameOf = t => (t && ((t.function && t.function.name) || t.name)) || '';
    const seen = new Set();
    let tools = stripSchema(body.tools).filter(t => {
      const n = `${t && t.type}:${nameOf(t)}`;
      if (nameOf(t) && seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    if (CFG.sortTools) tools = tools.sort((a, b) => `${a.type}:${nameOf(a)}`.localeCompare(`${b.type}:${nameOf(b)}`));
    body.tools = tools;
  }
  if (body.response_format) body.response_format = stripSchema(body.response_format);

  const toolTokens = estimateToolsTokens(body.tools, cpt);
  const extraTokens = responsesFieldsTokens(body, cpt);
  const effectiveBudget = orchBudget || CFG.modelContextTokens[model] || CFG.maxContextTokens;
  let ctxInfo = {
    msgTokens: extraTokens,
    toolTokens,
    totalInputTokens: toolTokens + extraTokens,
    rawTotalTokens: toolTokens + extraTokens,
    savedTokens: 0,
    budget: effectiveBudget,
    changes: {},
    overBudget: effectiveBudget > 0 && (toolTokens + extraTokens) > effectiveBudget,
  };

  if (Array.isArray(body.messages)) {
    if (CFG.normalize) body.messages = normalizeMessages(body.messages);
    const res = compactContextByTokens(body.messages, toolTokens, model);
    body.messages = res.messages;
    ctxInfo = res;
    if (orchBudget) {
      ctxInfo.budget = orchBudget;
      ctxInfo.overBudget = ctxInfo.totalInputTokens > orchBudget;
    }
    if (!hasOrchModel && ctxInfo.overBudget && CFG.longContextModel && body.model !== CFG.longContextModel) {
      console.log(`[context] ~${res.totalInputTokens} tokens exceeds ${model}'s budget (${ctxInfo.budget}); routing to ${CFG.longContextModel}`);
      body.model = CFG.longContextModel;
      stats.routedToLongContext++;
      ctxInfo.budget = CFG.modelContextTokens[CFG.longContextModel] || ctxInfo.budget;
      ctxInfo.overBudget = ctxInfo.totalInputTokens > ctxInfo.budget;
    }
  }

  {
    const delta = (rawToolTokens - toolTokens) + (rawExtraTokens - extraTokens);
    ctxInfo.rawTotalTokens += delta;
    ctxInfo.savedTokens = (ctxInfo.savedTokens || 0) + delta;
    ctxInfo.changes = { ...ctxInfo.changes, toolsRemoved: gate.removed, skillsRemoved: prof.skillsRemoved, instructionSource: dbRes.usedDb ? 'db' : 'incoming' };
    if (indexed) { ctxInfo.changes.indexedTools = indexed.tools; ctxInfo.changes.indexedSkills = indexed.skills; }
    if (prof.skillsKept) ctxInfo.changes.skillsKept = prof.skillsKept;
  }

  if (isStream && CFG.injectStreamUsage && /\/chat\/completions$/.test(p) && !body.stream_options) {
    body.stream_options = { include_usage: true };
  }

  const rawPromptChars = (Array.isArray(body.messages) ? JSON.stringify(body.messages).length : 0)
    + (Array.isArray(body.tools) ? JSON.stringify(body.tools).length : 0)
    + (typeof body.instructions === 'string' ? body.instructions.length : 0)
    + (body.input != null && !Array.isArray(body.messages) ? JSON.stringify(body.input).length : 0);

  const pct = ctxInfo.budget > 0 ? Number(((ctxInfo.totalInputTokens / ctxInfo.budget) * 100).toFixed(1)) : 0;
  const effectiveTokens = ctxInfo.totalInputTokens;

  stats.currentAgentContext = {
    updatedAt: new Date().toISOString(),
    conversationId: convId,
    decisionStatus: sessionDecisions.get(convId) || 'none',
    model,
    messageCount: Array.isArray(body.messages) ? body.messages.length : 0,
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
    toolTokensEst: ctxInfo.toolTokens,
    messageTokensEst: ctxInfo.msgTokens,
    totalInputTokensEst: ctxInfo.totalInputTokens,
    rawInputTokensEst: ctxInfo.rawTotalTokens,
    lastActualPromptTokens: (modelCalibration[model] && modelCalibration[model].lastActualPromptTokens) || null,
    tokenAlertThreshold: CFG.tokenAlertThreshold,
    tokenBudget: ctxInfo.budget,
    utilizationPct: pct,
  };

  return {
    model,
    isStream,
    rawPromptChars,
    estTokens: ctxInfo.totalInputTokens,
    rawTokens: ctxInfo.rawTotalTokens,
    effectiveTokens,
    msgCount: stats.currentAgentContext.messageCount,
    budget: ctxInfo.budget,
    pct,
    changes: ctxInfo.changes || {},
    overBudget: !!ctxInfo.overBudget,
    unloaded: gate.unloaded.map(u => `${u.label}(${u.n})`),
    profile: prof.profile,
    indexed,
  };
}

module.exports = { conversationItems, userQuestionTexts, calledToolNames, groupOfTool, groupWords, groupLabel, keywordRegex, getInstructionText, setInstructionText, appendToInstructions, gateTools, detectFramework, dropAndroidSkills, applyInstructionProfile, responsesFieldsTokens, shapeRequest };
