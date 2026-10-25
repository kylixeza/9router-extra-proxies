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

function renderOverview() {
  if (!S) return;
  const s = S.stats || {};
  const h = S.health || {};

  const hup = document.getElementById('hup');
  if (hup) hup.textContent = `up ${num(h.uptimeSec)}s · :${S.config?.port || 20129} → ${S.config?.target || ''}`;

  const hbadge = document.getElementById('hbadge');
  if (hbadge) {
    hbadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>Leon · :${S.config?.port || 20129}`;
  }

  const by = s.byStatus || {};
  const ok = (by['200'] || 0);

  const cardsEl = document.getElementById('cards');
  if (cardsEl) {
    cardsEl.innerHTML =
      card('requests', num(s.requests)) +
      card('ok 200', num(ok)) +
      card('upstream err', num(s.upstreamErrors)) +
      card('client abort', num(s.clientAborts)) +
      card('retries', num(s.retries)) +
      card('fallbacks', num(s.fallbacks));
  }

  const tot = s.requests || 1;
  const trafficEl = document.getElementById('traffic');
  if (trafficEl) {
    trafficEl.innerHTML = `byStatus: ${Object.entries(by).map(([k, v]) => `${k}=${v}`).join(' ') || '-'}<br>err rate: ${(((s.upstreamErrors || 0) + (s.clientAborts || 0)) / tot * 100).toFixed(1)}%<br>started: ${esc(s.startedAt || '-')}`;
  }

  const resilEl = document.getElementById('resil');
  if (resilEl) {
    resilEl.innerHTML = `retries=${num(s.retries)} fallbacks=${num(s.fallbacks)}<br>dedupHits=${num(s.dedupHits)} coalesced=${num(s.coalesced)}<br>inflight=${num(s.inflight)} dedupEntries=${num(s.dedupEntries)}<br>dedup ttl=${num(S.config?.dedupTtlMs)}ms max=${num(S.config?.dedupMax)}${S.config?.dedupDeterministicOnly ? ' det-only' : ''}`;
  }

  const cfgEl = document.getElementById('cfg');
  if (cfgEl && S.config) {
    const c = S.config;
    cfgEl.textContent = `target ${c.target}\nretries ${c.retries} ttfb ${c.ttfbMs}ms modelsTtl ${c.modelsTtlMs}ms\nlogBodies ${c.logBodies} logKeep ${c.logKeep}\naliases ${JSON.stringify(c.aliases || {})}\nfallbacks ${JSON.stringify(c.fallbacks || {})}\ndefaults ${JSON.stringify(c.defaults || {})}\ndropParams ${JSON.stringify(c.dropParams || {})}`;
  }

  const mcEl = document.getElementById('mc');
  if (mcEl) {
    const mc = S.modelsCache || {};
    mcEl.textContent = mc.cached
      ? `cached yes · age ${mc.ageMs}ms / ttl ${mc.ttlMs}ms · refreshing=${mc.refreshing} · models=${mc.modelCount ?? '-'}`
      : 'not cached yet · hit /v1/models once';
  }

  if (window.lucide) lucide.createIcons();
}
