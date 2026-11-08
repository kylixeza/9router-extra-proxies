'use strict';
const crypto = require('crypto');

const fmtCap = v => (v === true ? 'yes' : v === false ? 'no' : '?');

function isUsableWithRole(m, role) {
  return Boolean(m && m.isActive && m.available && Array.isArray(m.roles) && m.roles.includes(role) && m.capTools !== false);
}

function buildRoster(store, opts = {}) {
  const settings = store.getSettings();
  const activeModels = store.listCachedModels().filter(m => m.isActive && m.available);

  const orchestrators = activeModels.filter(m => isUsableWithRole(m, 'orchestrator'));
  const workers = activeModels.filter(m => isUsableWithRole(m, 'worker'));
  const fixers = activeModels.filter(m => isUsableWithRole(m, 'fixer'));
  const spreadLoad = settings.spread_load !== false;

  const activeOrch = opts.activeOrchestrator
    || settings.orchestrator_model
    || (orchestrators.length ? `chosen_at_plan (${orchestrators.map(m => m.id).join(', ')})` : 'none');

  const lines = [
    `orchestrator: ${activeOrch}`,
  ];

  if (spreadLoad) {
    lines.push('assignment_policy: spread_across_workers (distribute tasks across different active workers by tier, capability, and load — do NOT send every task to one model)');
  } else {
    let defaultWorker = 'none';
    const flaggedDefault = workers.find(m => m.isDefaultWorker);
    if (flaggedDefault) {
      defaultWorker = flaggedDefault.id;
    } else {
      for (const id of settings.worker_fallback_chain || []) {
        const m = store.getModel(id);
        if (isUsableWithRole(m, 'worker')) { defaultWorker = m.id; break; }
      }
      if (defaultWorker === 'none' && workers.length) defaultWorker = workers[0].id;
    }
    lines.push(`default_worker: ${defaultWorker}`);
  }

  lines.push('workers:');
  if (workers.length) {
    for (const m of workers) {
      const ctx = m.contextWindow || m.contextLength || '?';
      const maxOut = m.maxOutput || m.maxCompletionTokens || '?';
      let line = `- id: ${m.id} | family: ${m.family || '?'} | tier: ${m.tier || '?'} | tools: ${fmtCap(m.capTools)} | vision: ${fmtCap(m.capVision)} | pdf: ${fmtCap(m.capPdf)} | context: ${ctx} | maxOutput: ${maxOut}`;
      if (m.notes) line += ` | notes: ${m.notes}`;
      lines.push(line);
    }
  } else {
    lines.push('- (none)');
  }

  lines.push('fixers:');
  if (fixers.length) {
    for (const m of fixers) {
      const ctx = m.contextWindow || m.contextLength || '?';
      let line = `- id: ${m.id} | family: ${m.family || '?'} | tier: ${m.tier || '?'} | tools: ${fmtCap(m.capTools)} | context: ${ctx}`;
      if (m.notes) line += ` | notes: ${m.notes}`;
      lines.push(line);
    }
  } else {
    lines.push('- (none)');
  }

  lines.push(`limits: max_attempts=${settings.max_attempts ?? 3}, max_parallel=${settings.max_parallel ?? 3}`);

  const bodyText = lines.join('\n');
  const hash = crypto.createHash('sha1').update(bodyText).digest('hex').slice(0, 6);
  const text = `<orch-roster v="${hash}">\n${bodyText}\n</orch-roster>`;
  const tokensEst = Math.ceil(text.length / 3.6);

  return { text, hash, tokensEst };
}

function injectRosterIntoBody(body, rosterText) {
  if (!body || typeof body !== 'object' || !rosterText) return false;

  if (typeof body.input === 'string') {
    if (body.input.includes('<orch-roster')) return false;
    body.input = `${body.input}\n\n${rosterText}`;
    return true;
  }

  if (!Array.isArray(body.input) || !body.input.length) return false;

  let lastUser = null;
  for (let i = body.input.length - 1; i >= 0; i--) {
    const it = body.input[i];
    if (it && it.role === 'user' && it.type !== 'function_call' && it.type !== 'function_call_output') {
      lastUser = it;
      break;
    }
  }
  if (!lastUser) return false;

  if (typeof lastUser.content === 'string') {
    if (lastUser.content.includes('<orch-roster')) return false;
    lastUser.content = `${lastUser.content}\n\n${rosterText}`;
    return true;
  }

  if (Array.isArray(lastUser.content)) {
    for (const part of lastUser.content) {
      if (part && typeof part.text === 'string' && part.text.includes('<orch-roster')) return false;
    }
    for (let j = lastUser.content.length - 1; j >= 0; j--) {
      const part = lastUser.content[j];
      if (part && part.type === 'input_text' && typeof part.text === 'string') {
        part.text = `${part.text}\n\n${rosterText}`;
        return true;
      }
    }
    lastUser.content.push({ type: 'input_text', text: `\n\n${rosterText}` });
    return true;
  }

  return false;
}

module.exports = { buildRoster, injectRosterIntoBody };
