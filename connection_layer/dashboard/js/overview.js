'use strict';

let S = null;
let lastGoodOverviewAt = null;

async function reload() {
  const errBox = document.getElementById('overviewError');
  try {
    const r = await fetch('/api/conn/index');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    S = await r.json();
    lastGoodOverviewAt = new Date();
    if (errBox) { errBox.className = 'hidden'; errBox.innerHTML = ''; }
    renderOverview();
    if (typeof renderModels === 'function') renderModels();
  } catch (e) {
    if (errBox) {
      const last = lastGoodOverviewAt ? ` Last updated ${fmtDate(lastGoodOverviewAt.toISOString()).slice(11)}.` : '';
      errBox.className = 'error-inline';
      errBox.innerHTML = `<span>Could not load gateway snapshot (${esc(e.message)}).${esc(last)}</span><button type="button" onclick="reload()" class="btn-pill btn-sm">Retry</button>`;
    }
    const dot = document.getElementById('hdot');
    if (dot) dot.classList.add('bad');
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
  const dot = document.getElementById('hdot');
  if (dot) dot.classList.toggle('bad', !h.ok);

  const tot = s.requests || 0;
  const errs = (s.upstreamErrors || 0) + (s.clientAborts || 0);
  const rate = tot ? (errs / tot * 100) : 0;
  const overBudget = rate > 5;
  const sub = document.getElementById('titleSub');
  if (sub && (!window.CUR_VIEW || window.CUR_VIEW === 'overview')) {
    sub.textContent = tot
      ? `${num(tot)} requests since boot · ${rate.toFixed(1)}% error rate (${overBudget ? 'above 5.0% SLO budget' : 'within 5.0% SLO budget'})`
      : 'Live LLM request gateway · 0 requests since last restart';
  }

  const by = s.byStatus || {};
  const ok = (by['200'] || 0);
  const errColor = overBudget ? 'var(--negative)' : 'var(--text)';
  const totalTokAllTime = (S.models || []).reduce((acc, m) => acc + (Number(m.promptTokens) || 0) + (Number(m.completionTokens) || 0), 0);

  const cardsEl = document.getElementById('cards');
  if (cardsEl) {
    cardsEl.innerHTML =
      card('Requests since boot', esc(num(s.requests)), `started ${esc((s.startedAt || '').slice(11, 19) || '-')}`, true) +
      card('Error rate', `<span style="color:${errColor}">${rate.toFixed(1)}%</span>`, 'vs 5.0% SLO budget') +
      card('200 OK', esc(num(ok)), `${tot ? Math.round(ok / tot * 100) : 0}% of session`) +
      card('Retries / fallbacks', esc(num((s.retries || 0) + (s.fallbacks || 0))), `${num(s.retries)} retries · ${num(s.fallbacks)} fallbacks`) +
      card('Dedup / inflight', esc(num(s.dedupHits)), `${num(s.coalesced)} coalesced · ${num(s.inflight)} inflight`);
  }

  const trafficEl = document.getElementById('traffic');
  if (trafficEl) {
    const pairs = Object.entries(by).map(([k, v]) => `${k}: ${num(v)}`).join(' · ');
    trafficEl.textContent = pairs ? `HTTP ${pairs}` : 'HTTP: 0 requests';
  }

  const resilEl = document.getElementById('resil');
  if (resilEl) {
    const mc = S.modelsCache || {};
    resilEl.innerHTML =
      kvRow('Inflight requests', esc(num(s.inflight))) +
      kvRow('Upstream errors', `<span style="color:${(s.upstreamErrors || 0) > 0 ? 'var(--negative)' : 'var(--text)'}">${esc(num(s.upstreamErrors))}</span>`) +
      kvRow('Client aborts', esc(num(s.clientAborts))) +
      kvRow('Dedup cache', `${esc(num(s.dedupEntries))} / ${esc(num(S.config?.dedupMax || 0))} (${esc(num(S.config?.dedupTtlMs || 0))} ms)`) +
      kvRow('Upstream TTFB timeout', `${esc(num(S.config?.ttfbMs || 0))} ms`) +
      kvRow('Max retry attempts', esc(num(S.config?.retries || 0))) +
      kvRow('Models cache', mc.cached ? `${esc(num(mc.modelCount ?? 0))} models (${Math.round((mc.ageMs || 0) / 1000)}s old)` : 'cold') +
      kvRow('Recorded tokens', fmtTok(totalTokAllTime));
  }

  const cfgEl = document.getElementById('cfg');
  if (cfgEl && S.config) {
    const c = S.config;
    const portLab = document.getElementById('cfgPortLabel');
    if (portLab) portLab.textContent = String(c.port || 20129);
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
