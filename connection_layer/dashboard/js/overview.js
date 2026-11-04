'use strict';

let S = null;

async function reload() {
  try {
    const r = await fetch('/api/conn/index');
    S = await r.json();
    renderOverview();
    if (typeof renderModels === 'function') renderModels();
  } catch (e) {
    toast(e.message, true);
  }
}

function kvRow(k, v) {
  return `<div class="kv-row"><span class="kv-k">${esc(k)}</span><span class="kv-v num">${v}</span></div>`;
}

function renderOverview() {
  if (!S) return;
  const s = S.stats || {};
  const h = S.health || {};

  const hup = document.getElementById('hup');
  if (hup) hup.textContent = `up ${num(h.uptimeSec)}s`;
  const hbadge = document.getElementById('hbadge');
  if (hbadge) hbadge.textContent = `:${S.config?.port || 20129}`;

  const tot = s.requests || 0;
  const errs = (s.upstreamErrors || 0) + (s.clientAborts || 0);
  const rate = tot ? (errs / tot * 100) : 0;
  const overBudget = rate > 5;
  const sub = document.getElementById('titleSub');
  if (sub && (!window.CUR_VIEW || window.CUR_VIEW === 'overview')) {
    sub.textContent = tot
      ? `${num(tot)} requests handled · ${rate.toFixed(1)}% error rate (${overBudget ? 'above 5.0% SLO budget' : 'within 5.0% SLO budget'})`
      : 'live LLM request gateway · token flow, error rate, model latency';
  }

  const by = s.byStatus || {};
  const ok = (by['200'] || 0);
  const errColor = overBudget ? 'var(--negative)' : 'var(--text)';

  const cardsEl = document.getElementById('cards');
  if (cardsEl) {
    cardsEl.innerHTML =
      card('Total requests', esc(num(s.requests)), `since ${esc((s.startedAt || '').slice(11, 19) || 'boot')}`, true) +
      card('Error rate', `<span style="color:${errColor}">${rate.toFixed(1)}%</span>`, 'vs 5.0% budget') +
      card('200 OK', esc(num(ok)), `${tot ? Math.round(ok / tot * 100) : 0}% of total`) +
      card('Upstream errors', `<span style="color:${(s.upstreamErrors || 0) > 0 ? 'var(--negative)' : 'var(--text)'}">${esc(num(s.upstreamErrors))}</span>`, `${num(s.clientAborts)} client aborts`) +
      card('Retries', esc(num(s.retries)), `${num(s.fallbacks)} model fallbacks`) +
      card('Dedup hits', esc(num(s.dedupHits)), `${num(s.coalesced)} coalesced`);
  }

  const trafficEl = document.getElementById('traffic');
  if (trafficEl) {
    const pairs = Object.entries(by).map(([k, v]) => `${k}: ${num(v)}`).join(' · ');
    trafficEl.textContent = pairs ? `HTTP ${pairs}` : 'HTTP status: 0 requests';
  }

  const resilEl = document.getElementById('resil');
  if (resilEl) {
    const mc = S.modelsCache || {};
    resilEl.innerHTML =
      kvRow('Inflight requests', esc(num(s.inflight))) +
      kvRow('Dedup cache entries', `${esc(num(s.dedupEntries))} / ${esc(num(S.config?.dedupMax || 0))}`) +
      kvRow('Dedup TTL window', `${esc(num(S.config?.dedupTtlMs || 0))} ms`) +
      kvRow('Upstream TTFB timeout', `${esc(num(S.config?.ttfbMs || 0))} ms`) +
      kvRow('Max retry attempts', esc(num(S.config?.retries || 0))) +
      kvRow('Models cache', mc.cached ? `${esc(num(mc.modelCount ?? 0))} models (${Math.round((mc.ageMs || 0) / 1000)}s old)` : 'cold');
  }

  const cfgEl = document.getElementById('cfg');
  if (cfgEl && S.config) {
    const c = S.config;
    cfgEl.textContent = `target          ${c.target}\nport            ${c.port}\nretries         ${c.retries}\nttfbMs          ${c.ttfbMs} ms\nmodelsTtlMs     ${c.modelsTtlMs} ms\ndedupTtlMs      ${c.dedupTtlMs} ms\ndedupMax        ${c.dedupMax}\nlogBodies       ${c.logBodies}\nlogKeep         ${c.logKeep}\naliases         ${JSON.stringify(c.aliases || {}, null, 2)}\nfallbacks       ${JSON.stringify(c.fallbacks || {}, null, 2)}\ndefaults        ${JSON.stringify(c.defaults || {}, null, 2)}\ndropParams      ${JSON.stringify(c.dropParams || [])}`;
  }

  const mcEl = document.getElementById('mc');
  if (mcEl) {
    const mc = S.modelsCache || {};
    mcEl.textContent = mc.cached
      ? `cached: yes · age ${num(mc.ageMs)} ms / ttl ${num(mc.ttlMs)} ms · refreshing: ${mc.refreshing} · models: ${mc.modelCount ?? '-'}`
      : 'not cached yet · hit /v1/models once';
  }
}
