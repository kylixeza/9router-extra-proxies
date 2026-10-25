'use strict';
const { modelCalibration, stats } = require('./config');

function getCharsPerToken(model) {
  const cal = model && modelCalibration[model];
  return cal ? cal.charsPerToken : 3.6;
}

function estimateStringTokens(str, cpt = 3.6) {
  if (!str || typeof str !== 'string') return 0;
  return Math.ceil(str.length / cpt);
}

function estimateMessageTokens(m, cpt = 3.6) {
  if (!m || typeof m !== 'object') return 0;
  let tokens = 4;
  if (typeof m.content === 'string') {
    tokens += estimateStringTokens(m.content, cpt);
  } else if (Array.isArray(m.content)) {
    for (const part of m.content) {
      if (!part) continue;
      if (typeof part.text === 'string') tokens += estimateStringTokens(part.text, cpt);
      else if (part.type === 'image_url' || part.type === 'image') tokens += 1000;
      else tokens += estimateStringTokens(JSON.stringify(part), cpt);
    }
  }
  if (Array.isArray(m.tool_calls)) {
    for (const tc of m.tool_calls) {
      tokens += 8;
      if (tc.function) {
        tokens += estimateStringTokens(tc.function.name || '', cpt);
        tokens += estimateStringTokens(tc.function.arguments || '', cpt);
      }
    }
  }
  if (typeof m.reasoning_content === 'string') tokens += estimateStringTokens(m.reasoning_content, cpt);
  if (typeof m.thinking === 'string') tokens += estimateStringTokens(m.thinking, cpt);
  return tokens;
}

function estimateToolsTokens(tools, cpt = 3.6) {
  if (!Array.isArray(tools) || !tools.length) return 0;
  return estimateStringTokens(JSON.stringify(tools), cpt) + tools.length * 12;
}

function calibrateModel(model, rawChars, estTokens, actualPromptTokens) {
  if (!model || !actualPromptTokens || actualPromptTokens <= 0 || rawChars <= 0) return;
  const observedCpt = Math.max(1.5, Math.min(6.0, rawChars / actualPromptTokens));
  const cur = modelCalibration[model] || { charsPerToken: 3.6, samples: 0, lastActualPromptTokens: 0, lastEstTokens: 0 };
  cur.charsPerToken = Number((cur.samples === 0 ? observedCpt : cur.charsPerToken * 0.8 + observedCpt * 0.2).toFixed(3));
  cur.samples++;
  cur.lastActualPromptTokens = actualPromptTokens;
  cur.lastEstTokens = estTokens;
  modelCalibration[model] = cur;
  stats.currentAgentContext.lastActualPromptTokens = actualPromptTokens;
}

module.exports = { getCharsPerToken, estimateStringTokens, estimateMessageTokens, estimateToolsTokens, calibrateModel };
